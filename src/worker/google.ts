import { decryptSetting, encryptSetting } from "./sites/secrets.ts";

/**
 * Google access for Google Analytics 4 and Search Console, read-only.
 *
 * The owner signs in with "Connect to Google" (OAuth): the Worker keeps the
 * refresh token encrypted and trades it for short-lived access tokens. The
 * OAuth client (id and secret) is the owner's own, created once in Google
 * Cloud, because each deployment has its own address.
 *
 * Connections made earlier with a service account's JSON key keep working:
 * their access tokens come from signing a short-lived JWT with the key
 * (https://developers.google.com/identity/protocols/oauth2/service-account).
 */

const SETTING = "google";
const CLIENT_SETTING = "google_client";
const STATE_SETTING = "google_oauth_state";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const STATE_TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 15_000;

export const GOOGLE_SCOPES = {
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
  searchConsole: "https://www.googleapis.com/auth/webmasters.readonly",
  /** Add a site to Search Console and submit its sitemap; asked for only when the owner sets a site up. */
  manage: "https://www.googleapis.com/auth/webmasters",
  /** Prove ownership of a site, without being able to list or change anything else. */
  verify: "https://www.googleapis.com/auth/siteverification.verify_only",
} as const;

/** A service account's key, from before "Connect to Google". */
export interface GoogleKey {
  client_email: string;
  private_key: string;
}

/** The Google account that signed in with "Connect to Google". */
export interface GoogleOAuthAccount {
  kind: "oauth";
  email: string;
  refresh_token: string;
  /** The scopes the owner allowed; absent on sign-ins made before they were recorded. */
  scopes?: string[];
}

export type GoogleCredential = (GoogleKey & { kind?: "service_account" }) | GoogleOAuthAccount;

/** The owner's OAuth client, created in Google Cloud. */
export interface GoogleClient {
  client_id: string;
  client_secret: string;
}

/** The address Google sends the owner back to; it has to be listed on the OAuth client. */
export const googleRedirectUri = (origin: string) => `${origin}/api/google/callback`;

/** Whether the sign-in allows adding a site to Search Console and verifying it. */
export const googleCanSetUpSites = (credential: GoogleCredential): boolean =>
  credential.kind === "oauth" &&
  !!credential.scopes?.includes(GOOGLE_SCOPES.manage) &&
  !!credential.scopes.includes(GOOGLE_SCOPES.verify);

/** The email address behind a credential, for Settings. */
export const googleAccount = (credential: GoogleCredential): string =>
  credential.kind === "oauth" ? credential.email : credential.client_email;

export class GoogleError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/** Read the key file Google gives for a service account; throws a message for the owner when it is not one. */
export function parseGoogleKey(text: string): GoogleKey {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new GoogleError("Paste the whole JSON key file for the service account.", 400);
  }
  const { client_email: email, private_key: key, type } = parsed;
  if (type !== "service_account" || typeof email !== "string" || typeof key !== "string" || !key.includes("PRIVATE KEY")) {
    throw new GoogleError("That is not a service account JSON key. Create a key of type JSON for a service account.", 400);
  }
  return { client_email: email, private_key: key };
}

export async function loadGoogleCredential(env: Env): Promise<GoogleCredential | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = ?").bind(SETTING).first<{ value: string }>();
  if (!row) return null;
  const stored = JSON.parse(row.value) as { key: string };
  const text = await decryptSetting(env.SITE_SECRETS_KEY, SETTING, stored.key);
  // A service account is saved as just its email and key, without the "type" Google's key file carries.
  return JSON.parse(text) as GoogleCredential;
}

export async function saveGoogleCredential(env: Env, credential: GoogleCredential): Promise<void> {
  const value = JSON.stringify({ key: await encryptSetting(env.SITE_SECRETS_KEY, SETTING, JSON.stringify(credential)) });
  await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES (?, ?)").bind(SETTING, value).run();
}

export async function deleteGoogleCredential(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE name = ?").bind(SETTING).run();
  forgetGoogleTokens();
}

export async function loadGoogleClient(env: Env): Promise<GoogleClient | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = ?").bind(CLIENT_SETTING).first<{ value: string }>();
  if (!row) return null;
  const stored = JSON.parse(row.value) as { client_id: string; secret: string };
  return { client_id: stored.client_id, client_secret: await decryptSetting(env.SITE_SECRETS_KEY, CLIENT_SETTING, stored.secret) };
}

export async function saveGoogleClient(env: Env, client: GoogleClient): Promise<void> {
  const value = JSON.stringify({
    client_id: client.client_id,
    secret: await encryptSetting(env.SITE_SECRETS_KEY, CLIENT_SETTING, client.client_secret),
  });
  await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES (?, ?)").bind(CLIENT_SETTING, value).run();
}

export async function deleteGoogleClient(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE name = ?").bind(CLIENT_SETTING).run();
}

/** Start a sign-in: remember a one-time state for ten minutes and return the Google page to send the owner to. */
export async function startGoogleSignIn(
  env: Env,
  client: GoogleClient,
  redirectUri: string,
  options: { setup?: boolean; returnTo?: string } = {},
  now = Date.now(),
): Promise<string> {
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES (?, ?)")
    .bind(STATE_SETTING, JSON.stringify({ state, expires: now + STATE_TTL_MS, returnTo: options.returnTo ?? "" }))
    .run();
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    // Setting a site up needs to write to Search Console, which replaces the read-only scope.
    scope: [
      "openid",
      "email",
      GOOGLE_SCOPES.analytics,
      ...(options.setup ? [GOOGLE_SCOPES.manage, GOOGLE_SCOPES.verify] : [GOOGLE_SCOPES.searchConsole]),
    ].join(" "),
    // Offline access gives the refresh token; consent makes Google send it again on a reconnect.
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

/** The page to return to if the state Google sent back is the one just issued and still fresh; it is used up either way. */
async function takeGoogleState(env: Env, state: string, now: number): Promise<{ returnTo: string } | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = ?").bind(STATE_SETTING).first<{ value: string }>();
  await env.DB.prepare("DELETE FROM settings WHERE name = ?").bind(STATE_SETTING).run();
  if (!row || !state) return null;
  const saved = JSON.parse(row.value) as { state: string; expires: number; returnTo?: string };
  return saved.state === state && saved.expires > now ? { returnTo: saved.returnTo ?? "" } : null;
}

async function tokenRequest(params: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string }> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new GoogleError("Google could not be reached.");
  }
  return (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string };
}

/**
 * Finish a sign-in: check the state, trade the code for tokens and read the
 * account's email. Returns the account to save.
 */
export async function finishGoogleSignIn(
  env: Env,
  client: GoogleClient,
  redirectUri: string,
  code: string,
  state: string,
  now = Date.now(),
): Promise<{ account: GoogleOAuthAccount; returnTo: string }> {
  const taken = await takeGoogleState(env, state, now);
  if (!taken) {
    throw new GoogleError("That sign-in expired or did not start here. Choose Connect to Google again.", 400);
  }
  const body = await tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: redirectUri,
  });
  if (!body.access_token) {
    const reason = body.error === "invalid_client" ? "Google did not accept the client ID and secret." : body.error_description ?? "Google did not accept the sign-in.";
    throw new GoogleError(reason, 400);
  }
  if (!body.refresh_token) {
    throw new GoogleError("Google did not allow access to be kept. Remove KontrolWP under your Google account's third-party access and connect again.", 400);
  }
  let email = "";
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${body.access_token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    email = ((await res.json().catch(() => ({}))) as { email?: string }).email ?? "";
  } catch {
    // The email is only a label; the connection works without it.
  }
  return {
    account: {
      kind: "oauth",
      email: email || "Google account",
      refresh_token: body.refresh_token,
      scopes: body.scope?.split(" ").filter(Boolean),
    },
    returnTo: taken.returnTo,
  };
}

const b64url = (bytes: ArrayBuffer | Uint8Array | string): string => {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function signingKey(pem: string): Promise<CryptoKey> {
  const base64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** Tokens are good for an hour; one is reused for 50 minutes per key and scope. */
const tokens = new Map<string, { token: string; expires: number }>();

/** Forget saved tokens, after the connection changes. */
export function forgetGoogleTokens(): void {
  tokens.clear();
}

/** An access token for the scope: refreshed for a signed-in account, or from a JWT signed with a service account's key. */
export async function googleAccessToken(credential: GoogleCredential, scope: string, now = Date.now(), client?: GoogleClient | null): Promise<string> {
  if (credential.kind === "oauth") return oauthAccessToken(credential, client, now);
  const key = credential;
  const cacheKey = `${key.client_email}|${scope}`;
  const cached = tokens.get(cacheKey);
  if (cached && cached.expires > now) return cached.token;
  const seconds = Math.floor(now / 1000);
  const claims = { iss: key.client_email, scope, aud: TOKEN_URL, iat: seconds, exp: seconds + 3600 };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  let signature: ArrayBuffer;
  try {
    signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await signingKey(key.private_key), new TextEncoder().encode(unsigned));
  } catch {
    throw new GoogleError("The service account's private key could not be read. Paste the JSON key file again.", 400);
  }
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${b64url(signature)}`,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new GoogleError("Google could not be reached.");
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new GoogleError(`Google did not accept that service account key${body.error_description ? `: ${body.error_description}` : ""}.`, 400);
  }
  tokens.set(cacheKey, { token: body.access_token, expires: now + 50 * 60_000 });
  return body.access_token;
}

/** The access token for a signed-in account; one token covers every scope the owner allowed. */
async function oauthAccessToken(account: GoogleOAuthAccount, client: GoogleClient | null | undefined, now: number): Promise<string> {
  const cacheKey = `oauth|${account.refresh_token.slice(-16)}`;
  const cached = tokens.get(cacheKey);
  if (cached && cached.expires > now) return cached.token;
  if (!client) throw new GoogleError("The Google client ID and secret are missing. Add them in Settings and connect again.", 400);
  const body = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: account.refresh_token,
    client_id: client.client_id,
    client_secret: client.client_secret,
  });
  if (!body.access_token) {
    if (body.error === "invalid_grant") {
      throw new GoogleError("Google no longer lets KontrolWP read this account. Connect to Google again in Settings.", 400);
    }
    throw new GoogleError(`Google did not accept the saved sign-in${body.error_description ? `: ${body.error_description}` : ""}. Connect to Google again in Settings.`, 400);
  }
  tokens.set(cacheKey, { token: body.access_token, expires: now + 50 * 60_000 });
  return body.access_token;
}

/** Call a Google API with the service account's token and read the JSON answer. */
export async function googleCall<T>(
  token: string,
  url: string,
  init: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "did not answer in time" : "could not be reached";
    throw new GoogleError(`Google ${reason}.`);
  }
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; status?: string } } | null;
  if (res.status === 429) throw new GoogleError("Google is rate limiting requests. Try again in a moment.");
  if (!res.ok) {
    const detail = body?.error?.message ?? "";
    if (res.status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(detail)) {
      // Google's message ends with the page that enables the API; keep it so the owner can open it.
      const enableAt = /https:\/\/console\.(?:developers|cloud)\.google\.com\/[^\s"')]+/.exec(detail)?.[0];
      throw new GoogleError(
        `${detail.split(/\s+Enable it|\s+If you enabled/)[0]} Enable the API in the Google Cloud project that owns the OAuth client or service account.${enableAt ? ` Enable it at ${enableAt}` : ""}`,
        400,
      );
    }
    if (res.status === 403 || res.status === 401) {
      throw new GoogleError("Google would not let the connected account read this. It needs to be able to view the property in Google Analytics or Search Console.", 400);
    }
    throw new GoogleError(`Google answered ${res.status}${detail ? `: ${detail}` : ""}.`, res.status === 400 ? 400 : 502);
  }
  return body as T;
}
