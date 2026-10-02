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

const TIMEOUT_MS = 20_000;
// Updates download and unpack a package on the site; core also upgrades the
// database, so give actions longer than reads.
const ACTION_TIMEOUT_MS = 180_000;

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
  try {
    json = await response.json();
  } catch {
    throw new SiteRequestError(
      response.ok
        ? "The site did not return JSON. Is KontrolWP Connect active?"
        : `The site returned HTTP ${response.status}`,
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
