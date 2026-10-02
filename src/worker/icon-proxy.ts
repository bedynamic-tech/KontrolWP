/**
 * Icons come from the managed sites and WordPress.org. The dashboard loads
 * them through the Worker so a slow site is only waited on once: the browser
 * and Cloudflare keep the answer for a week.
 */

const MAX_BYTES = 512 * 1024;
export const ICON_MAX_AGE = 7 * 24 * 3600;

/** An https address on the default port that names a host, not an IP address or a local name. */
export function isProxyableIconUrl(value: string | undefined): URL | null {
  if (!value || value.length > 2048 || !URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
  const host = url.hostname;
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^[\d.]+$/.test(host) || host.includes(":")) return null;
  return url;
}

/** The icon as a cacheable response, or a 404 when it cannot be fetched or is not a small image. */
export async function fetchIcon(url: URL): Promise<Response> {
  const missing = new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=3600" } });
  try {
    const upstream = await fetch(url, {
      headers: { Accept: "image/*", "User-Agent": "KontrolWP" },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    const type = (upstream.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
    if (!upstream.ok || !type.startsWith("image/")) return missing;
    const body = await upstream.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return missing;
    return new Response(body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": `public, max-age=${ICON_MAX_AGE}, stale-while-revalidate=${ICON_MAX_AGE}`,
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return missing;
  }
}
