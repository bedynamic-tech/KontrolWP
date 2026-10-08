import { decryptSetting, encryptSetting } from "./sites/secrets.ts";

/**
 * A Google service account, used for Google Analytics 4 and Search Console.
 * The owner pastes the account's JSON key into Settings (stored encrypted)
 * and grants its email address read access in Analytics and Search Console,
 * so no OAuth consent screen is involved. Access tokens come from signing a
 * short-lived JWT with the key (https://developers.google.com/identity/protocols/oauth2/service-account).
 */

const SETTING = "google";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TIMEOUT_MS = 15_000;

export const GOOGLE_SCOPES = {
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
  searchConsole: "https://www.googleapis.com/auth/webmasters.readonly",
} as const;

export interface GoogleKey {
  client_email: string;
  private_key: string;
}

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

export async function loadGoogleKey(env: Env): Promise<GoogleKey | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = ?").bind(SETTING).first<{ value: string }>();
  if (!row) return null;
  const stored = JSON.parse(row.value) as { key: string };
  return parseGoogleKey(await decryptSetting(env.SITE_SECRETS_KEY, SETTING, stored.key));
}

export async function saveGoogleKey(env: Env, key: GoogleKey): Promise<void> {
  const value = JSON.stringify({ key: await encryptSetting(env.SITE_SECRETS_KEY, SETTING, JSON.stringify(key)) });
  await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES (?, ?)").bind(SETTING, value).run();
}

export async function deleteGoogleKey(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE name = ?").bind(SETTING).run();
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

/** Forget saved tokens, after the key changes. */
export function forgetGoogleTokens(): void {
  tokens.clear();
}

/** An access token for the scope, from a JWT signed with the service account's key. */
export async function googleAccessToken(key: GoogleKey, scope: string, now = Date.now()): Promise<string> {
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

/** Call a Google API with the service account's token and read the JSON answer. */
export async function googleCall<T>(
  token: string,
  url: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
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
      throw new GoogleError(`${detail.split(/\s+Enable it|\s+If you enabled/)[0]} Enable the API in the Google Cloud project that owns the service account.`, 400);
    }
    if (res.status === 403 || res.status === 401) {
      throw new GoogleError("The service account cannot read this. Add its email address as a viewer in Google Analytics or Search Console.", 400);
    }
    throw new GoogleError(`Google answered ${res.status}${detail ? `: ${detail}` : ""}.`, res.status === 400 ? 400 : 502);
  }
  return body as T;
}
