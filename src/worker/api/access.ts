import type { MiddlewareHandler } from "hono";
import { createLocalJWKSet, decodeJwt, errors, jwtVerify, type JSONWebKeySet } from "jose";

export interface WebAccessEnv {
  WEB_ACCESS_TEAM_DOMAIN?: string;
  WEB_ACCESS_AUD?: string;
}

export interface AccessIdentity {
  email: string;
  sub: string;
}

/**
 * Machine-readable reasons the web app uses to show its setup guide:
 * - `access_not_configured`: WEB_ACCESS_* variables are missing or invalid.
 * - `access_missing`: no Access assertion, so Access is not in front of this Worker.
 * - `access_invalid`: the assertion does not match the configured application.
 */
export type AccessFailureCode =
  | "access_not_configured"
  | "access_missing"
  | "access_invalid"
  | "access_forbidden"
  | "access_unavailable";

/** Unverified issuer/audience from the request's own assertion, shown to help setup. */
export interface AccessHint {
  team_domain: string;
  aud: string;
}

export type AccessResult =
  | { ok: true; identity: AccessIdentity }
  | { ok: false; status: 401 | 403 | 503; code: AccessFailureCode; error: string; hint?: AccessHint };

/** How long fetched Access signing keys are reused before fetching them again. */
const KEYS_TTL_MS = 10 * 60_000;

const keySets = new Map<string, { keys: ReturnType<typeof createLocalJWKSet>; fetchedAt: number }>();

/**
 * The team's Access signing keys. Each request that needs them fetches them
 * itself and only the finished result is shared: a Worker cannot settle a
 * promise begun by a request that has since ended, so sharing an in-flight
 * fetch (as jose's remote key set does) can leave every later request in the
 * instance waiting forever.
 */
async function accessKeys(issuer: string, refresh = false): Promise<ReturnType<typeof createLocalJWKSet>> {
  const cached = keySets.get(issuer);
  if (cached && !refresh && Date.now() - cached.fetchedAt < KEYS_TTL_MS) return cached.keys;
  try {
    const response = await fetch(`${issuer}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const keys = createLocalJWKSet((await response.json()) as JSONWebKeySet);
    keySets.set(issuer, { keys, fetchedAt: Date.now() });
    return keys;
  } catch (error) {
    // Keys that are only stale still verify; a missing set means Access is unreachable.
    if (cached) return cached.keys;
    throw new TypeError(`Access signing keys unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Verify Access's signed assertion, even if a public route misses edge protection. */
export async function verifyWebAccess(
  token: string | null | undefined,
  env: WebAccessEnv,
): Promise<AccessResult> {
  const issuer = accessIssuer(env.WEB_ACCESS_TEAM_DOMAIN);
  const audience = env.WEB_ACCESS_AUD?.trim();
  if (!issuer || !audience) {
    return failure(503, "access_not_configured", "Web authentication is not configured", token);
  }
  if (!token) return failure(401, "access_missing", "Authentication required");

  const verify = async (refresh: boolean) =>
    jwtVerify(token, await accessKeys(issuer, refresh), {
      issuer,
      audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "sub", "email", "type"],
    });
  try {
    // Access rotates its keys, so a token signed with an unknown key refetches them once.
    const { payload } = await verify(false).catch((error) => {
      if (error instanceof errors.JWKSNoMatchingKey) return verify(true);
      throw error;
    });
    if (
      payload.type !== "app" ||
      typeof payload.sub !== "string" || !payload.sub.trim() ||
      typeof payload.email !== "string" || !payload.email.trim()
    ) {
      return failure(403, "access_forbidden", "An Access user identity is required");
    }
    return { ok: true, identity: { email: payload.email, sub: payload.sub } };
  } catch (error) {
    if (error instanceof TypeError || error instanceof errors.JWKSTimeout ||
        (error instanceof errors.JOSEError && error.code === "ERR_JOSE_GENERIC")) {
      return failure(503, "access_unavailable", "Authentication service unavailable");
    }
    return failure(401, "access_invalid", "Invalid or expired Access assertion", token);
  }
}

export const requireWebAccess: MiddlewareHandler<{ Bindings: WebAccessEnv }> = async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  const result = await verifyWebAccess(c.req.header("Cf-Access-Jwt-Assertion"), c.env);
  if (!result.ok) {
    const { status, code, error, hint } = result;
    return c.json({ error, code, ...(hint ? { hint } : {}) }, status);
  }
  await next();
};

function failure(
  status: 401 | 403 | 503,
  code: AccessFailureCode,
  error: string,
  token?: string | null,
): AccessResult {
  const hint = token ? accessHint(token) : undefined;
  return { ok: false, status, code, error, ...(hint ? { hint } : {}) };
}

function accessHint(token: string): AccessHint | undefined {
  try {
    const { iss, aud } = decodeJwt(token);
    const teamDomain = accessIssuer(iss);
    const audience = Array.isArray(aud) ? aud[0] : aud;
    if (!teamDomain || typeof audience !== "string" || !/^[a-f0-9]{64}$/.test(audience)) {
      return undefined;
    }
    return { team_domain: teamDomain, aud: audience };
  } catch {
    return undefined;
  }
}

function accessIssuer(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(url.hostname) ||
      url.port || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/"
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}
