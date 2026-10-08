import { googleCall, GoogleError } from "./google.ts";

/**
 * Setting a WordPress site up in Search Console: ask Google for the HTML tag
 * that proves ownership, let KontrolWP Connect print it, have Google check
 * for it, add the site and hand over its sitemap. This needs a "Connect to
 * Google" sign-in that allowed it (see GOOGLE_SCOPES.manage and .verify).
 */

const SEARCH_API = "https://www.googleapis.com/webmasters/v3";
const VERIFY_API = "https://www.googleapis.com/siteVerification/v1";

/** The URL-prefix property for a site: its address with a trailing slash. */
export function propertyUrl(siteUrl: string): string {
  const url = new URL(siteUrl);
  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${path}`;
}

/** The code inside the meta tag Google wants on the home page. */
export async function verificationCode(token: string, property: string): Promise<string> {
  const body = await googleCall<{ token?: string }>(token, `${VERIFY_API}/token`, {
    method: "POST",
    body: { site: { type: "SITE", identifier: property }, verificationMethod: "META" },
  });
  const code = /content=["']([^"']+)["']/.exec(body.token ?? "")?.[1];
  if (!code) throw new GoogleError("Google did not give a verification tag for this site.");
  return code;
}

/** Ask Google to look for the tag; it may take a moment for a cached home page to show it. */
export async function verifyProperty(token: string, property: string, attempts = 3, wait = 2500): Promise<void> {
  let last: GoogleError | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      await googleCall(token, `${VERIFY_API}/webResource?verificationMethod=META`, {
        method: "POST",
        body: { site: { type: "SITE", identifier: property } },
      });
      return;
    } catch (error) {
      if (!(error instanceof GoogleError) || error.status !== 400) throw error;
      last = error;
    }
  }
  throw new GoogleError(
    `Google could not find the verification tag on ${property}. A page cache may still be serving the old home page; clear it and try again.${last ? ` (${last.message})` : ""}`,
    400,
  );
}

export async function addProperty(token: string, property: string): Promise<void> {
  await googleCall(token, `${SEARCH_API}/sites/${encodeURIComponent(property)}`, { method: "PUT" });
}

/** A property that was only just added may not accept requests for a moment, so a refusal is retried briefly. */
export async function submitSitemap(token: string, property: string, sitemap: string, attempts = 3, wait = 3000): Promise<void> {
  const url = `${SEARCH_API}/sites/${encodeURIComponent(property)}/sitemaps/${encodeURIComponent(sitemap)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      await googleCall(token, url, { method: "PUT" });
      return;
    } catch (error) {
      if (!(error instanceof GoogleError) || error.status !== 400 || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}
