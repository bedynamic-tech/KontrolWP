/**
 * The Presser Connect protocol: how the dashboard signs requests to a site.
 *
 * Every request carries four headers. The plugin rebuilds the same canonical
 * string, checks the HMAC with the site's secret, rejects timestamps outside
 * a five minute window and refuses a nonce it has already seen. The secret
 * never travels after the owner pastes the Connection Key into WordPress.
 *
 * plugin/presser-connect/includes/class-presser-connect-auth.php is the other
 * half of this file; change both together.
 */

export const PROTOCOL_VERSION = "presser-v1";
export const REST_NAMESPACE = "/presser/v1";
export const MAX_CLOCK_SKEW_SECONDS = 300;

export const HEADERS = {
  site: "X-Presser-Site",
  timestamp: "X-Presser-Timestamp",
  nonce: "X-Presser-Nonce",
  signature: "X-Presser-Signature",
} as const;

const encoder = new TextEncoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomToken(bytes: number): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256Hex(body: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(body)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The exact string both sides sign. `route` is the REST route, such as `/presser/v1/status`. */
export async function canonicalRequest(input: {
  method: string;
  route: string;
  timestamp: number;
  nonce: string;
  body: string;
}): Promise<string> {
  return [
    PROTOCOL_VERSION,
    input.method.toUpperCase(),
    input.route,
    String(input.timestamp),
    input.nonce,
    await sha256Hex(input.body),
  ].join("\n");
}

export async function sign(secret: string, canonical: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base64UrlDecode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(canonical));
  return base64UrlEncode(new Uint8Array(mac));
}

/** Headers for one signed request from the dashboard to a site. */
export async function signedHeaders(input: {
  siteId: number;
  secret: string;
  method: string;
  route: string;
  body: string;
  now?: number;
  nonce?: string;
}): Promise<Record<string, string>> {
  const timestamp = input.now ?? Math.floor(Date.now() / 1000);
  const nonce = input.nonce ?? randomToken(16);
  const canonical = await canonicalRequest({ ...input, timestamp, nonce });
  return {
    [HEADERS.site]: String(input.siteId),
    [HEADERS.timestamp]: String(timestamp),
    [HEADERS.nonce]: nonce,
    [HEADERS.signature]: await sign(input.secret, canonical),
  };
}

/**
 * The REST URL for a route. `?rest_route=` works on every WordPress install,
 * with or without pretty permalinks, so the dashboard never has to guess.
 */
export function restUrl(siteUrl: string, route: string): string {
  const url = new URL(siteUrl);
  url.pathname = url.pathname.replace(/\/*$/, "/");
  url.search = "";
  url.hash = "";
  url.searchParams.set("rest_route", route);
  return url.toString();
}

/**
 * What the owner pastes into Presser Connect. It carries the site's id and
 * secret, plus the dashboard address so the plugin can show where it is
 * connected. Treat it like a password.
 */
export interface ConnectionKey {
  siteId: number;
  secret: string;
  dashboard: string;
}

const CONNECTION_KEY_PREFIX = "presser1.";

export function encodeConnectionKey(key: ConnectionKey): string {
  const json = JSON.stringify({ s: key.siteId, k: key.secret, d: key.dashboard });
  return CONNECTION_KEY_PREFIX + base64UrlEncode(encoder.encode(json));
}

export function decodeConnectionKey(value: string): ConnectionKey | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith(CONNECTION_KEY_PREFIX)) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(base64UrlDecode(trimmed.slice(CONNECTION_KEY_PREFIX.length))));
    if (!Number.isInteger(json.s) || typeof json.k !== "string" || typeof json.d !== "string") return null;
    return { siteId: json.s, secret: json.k, dashboard: json.d };
  } catch {
    return null;
  }
}

/** Accept only public https URLs for sites; returns the normalized home URL or null. */
export function normalizeSiteUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname;
  if (host === "localhost" || /^[\d.]+$/.test(host) || host.startsWith("[") || !host.includes(".")) return null;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}
