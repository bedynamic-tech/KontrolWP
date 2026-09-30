import { restUrl, signedHeaders } from "../../shared/protocol.ts";

export interface SiteCredentials {
  id: number;
  url: string;
  secret: string;
}

/** A failure talking to a site, phrased for the person reading the dashboard. */
export class SiteRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const TIMEOUT_MS = 20_000;
// Plugin and theme updates download and unpack a package on the site.
const ACTION_TIMEOUT_MS = 120_000;

/** Send one signed request to Presser Connect and return its JSON body. */
export async function callSite<T>(
  site: SiteCredentials,
  method: "GET" | "POST",
  route: string,
  payload?: unknown,
): Promise<T> {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const headers = await signedHeaders({ siteId: site.id, secret: site.secret, method, route, body });
  let response: Response;
  try {
    response = await fetch(restUrl(site.url, route), {
      method,
      headers: {
        ...headers,
        Accept: "application/json",
        "User-Agent": "Presser",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body || undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(method === "POST" ? ACTION_TIMEOUT_MS : TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    throw new SiteRequestError(timedOut ? "The site did not respond in time" : "Could not reach the site");
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
        ? "The site did not return JSON. Is Presser Connect active?"
        : `The site returned HTTP ${response.status}`,
      response.status,
    );
  }
  if (!response.ok) {
    const code = (json as { code?: string }).code;
    if (code === "rest_no_route") {
      throw new SiteRequestError("Presser Connect is not installed or not active on this site", 404);
    }
    const message = (json as { message?: string }).message;
    throw new SiteRequestError(message || `The site returned HTTP ${response.status}`, response.status);
  }
  return json as T;
}
