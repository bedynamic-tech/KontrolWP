import { restUrl, signedHeaders } from "../../shared/protocol.ts";

export interface SiteCredentials {
  id: number;
  url: string;
  keyId: string;
  secret: string;
}

/** A failure talking to a site, phrased for the person reading the dashboard. */
export class SiteRequestError extends Error {
  readonly status?: number;
  /** The WP_Error code KontrolWP Connect returned, when there is one. */
  readonly code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The code of the error for a site whose database WordPress could not reach. */
export const DATABASE_DOWN_CODE = "database_connection";
const DATABASE_DOWN =
  "The site's database is not answering, so WordPress could not load. This usually means the host is overloaded or restarting. KontrolWP will try again at the next sync.";

/** WordPress's own maintenance page, shown while it installs an update. */
export const MAINTENANCE_CODE = "maintenance";
const MAINTENANCE =
  "The site is in maintenance mode, which WordPress uses while it installs an update. KontrolWP will try again at the next sync. If this stays, the update did not finish: delete the .maintenance file in the site's main folder.";

const TIMEOUT_MS = 20_000;
// Updates download and unpack a package on the site; core also upgrades the
// database, so give actions longer than reads.
const ACTION_TIMEOUT_MS = 180_000;

/** What the common Cloudflare error codes mean for the site's owner. */
const CLOUDFLARE_ERRORS: Record<string, string> = {
  "1000": "its DNS record points at an address Cloudflare does not allow",
  "1001": "Cloudflare could not resolve the DNS record for the site's origin server",
  "1014": "its DNS record points at a host owned by another Cloudflare account",
  "1016": "Cloudflare cannot find the origin server: the site's DNS record points at a name that does not resolve",
  "1033": "its Cloudflare Tunnel is not connected, so the tunnel service on the server may be stopped",
};

/**
 * A readable message for an HTML or plain-text error from Cloudflare (HTTP
 * 52x, 530), or null when the response does not come from Cloudflare's edge.
 * The page names a Cloudflare error code such as "Error 1016".
 */
export function cloudflareErrorMessage(status: number, body: string): string | null {
  const edge = status === 530 || (status >= 520 && status <= 527);
  const code = /error code:?\s*(\d{4})/i.exec(body)?.[1] ?? /\bError\s+(1\d{3})\b/.exec(body)?.[1];
  if (!edge && !(code && /cloudflare/i.test(body))) return null;
  const reason = code ? CLOUDFLARE_ERRORS[code] : undefined;
  if (reason) {
    return `Cloudflare answered HTTP ${status} (error ${code}): ${reason}. The site's server is not reachable, so check the site's DNS and hosting in Cloudflare.`;
  }
  const detail = code ? ` (error ${code})` : "";
  return status === 530
    ? `Cloudflare answered HTTP 530${detail} instead of the site: it could not reach the site's server. Check that the site's DNS record in Cloudflare is correct and that the server is running.`
    : `Cloudflare answered HTTP ${status}${detail} instead of the site: it could not get a working reply from the site's server. Check that the server is running.`;
}

/** Send one signed request to KontrolWP Connect and return its JSON body. */
export async function callSite<T>(
  site: SiteCredentials,
  method: "GET" | "POST",
  route: string,
  payload?: unknown,
): Promise<T> {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const headers = await signedHeaders({ keyId: site.keyId, secret: site.secret, method, route, body });
  let response: Response;
  try {
    // A unique query string keeps page caches and CDNs in front of the site
    // from answering with a stored copy (the signature covers the route only).
    const url = new URL(restUrl(site.url, route));
    url.searchParams.set("kontrolwp_nonce", headers["X-KontrolWP-Nonce"]);
    response = await fetch(url, {
      method,
      headers: {
        ...headers,
        Accept: "application/json",
        "User-Agent": "KontrolWP",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body || undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(method === "POST" ? ACTION_TIMEOUT_MS : TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    if (!timedOut) throw new SiteRequestError("Could not reach the site");
    throw new SiteRequestError(
      method === "POST"
        ? "The site did not answer in time. It may still be finishing; sync in a minute to check."
        : "The site did not respond in time",
    );
  }

  if (response.status >= 300 && response.status < 400) {
    throw new SiteRequestError(
      `The site redirected to ${response.headers.get("Location") ?? "another address"}. Update the site URL to match.`,
      response.status,
    );
  }
  let json: unknown;
  let raw = "";
  try {
    raw = await response.text();
    json = JSON.parse(raw);
  } catch {
    throw new SiteRequestError(
      response.ok
        ? "The site did not return JSON. Is KontrolWP Connect active?"
        : (cloudflareErrorMessage(response.status, raw) ?? `The site returned HTTP ${response.status}`),
      response.status,
    );
  }
  if (!response.ok) {
    const code = (json as { code?: string }).code;
    if (code === "rest_no_route") {
      throw new SiteRequestError("KontrolWP Connect is not installed or not active on this site", 404);
    }
    const message = (json as { message?: string }).message;
    // WordPress's own page for a database it cannot reach comes back as the message, with its HTML.
    if (message && /error establishing a database connection/i.test(message)) {
      throw new SiteRequestError(DATABASE_DOWN, response.status, DATABASE_DOWN_CODE);
    }
    if (message && /briefly unavailable for scheduled maintenance/i.test(message)) {
      throw new SiteRequestError(MAINTENANCE, response.status, MAINTENANCE_CODE);
    }
    throw new SiteRequestError(
      message
        ? message
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
        : `The site returned HTTP ${response.status}`,
      response.status,
      code,
    );
  }
  return json as T;
}
