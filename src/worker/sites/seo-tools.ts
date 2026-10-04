import { REST_NAMESPACE } from "../../shared/protocol.ts";
import { compareVersions, SEO_TOOLS_SINCE } from "../../shared/plugin-version.ts";
import type { SeoTools, SeoToolsSettings, SiteSummary } from "../../shared/types.ts";
import { callSite, SiteRequestError, type SiteCredentials } from "./client.ts";
import { SeoError } from "./seo.ts";

function requireSupported(site: SiteSummary, credentials: SiteCredentials | null): SiteCredentials {
  if (site.kind === "static" || !credentials)
    throw new SeoError("These tools need a WordPress site with KontrolWP Connect.", 400);
  if (!site.plugin_version || compareVersions(site.plugin_version, SEO_TOOLS_SINCE) < 0) {
    throw new SeoError(
      `These tools need KontrolWP Connect ${SEO_TOOLS_SINCE} or later. It updates automatically; select Sync now to check.`,
      400,
    );
  }
  return credentials;
}

async function call<T>(credentials: SiteCredentials, path: string, body: unknown): Promise<T> {
  try {
    return await callSite<T>(credentials, "POST", `${REST_NAMESPACE}${path}`, body);
  } catch (error) {
    if (error instanceof SiteRequestError) throw new SeoError(error.message, 502);
    throw error;
  }
}

/** The site's verification codes, robots.txt and llms.txt settings. Not cached: the previews must match the site. */
export async function siteSeoTools(site: SiteSummary, credentials: SiteCredentials | null): Promise<SeoTools> {
  return call<SeoTools>(requireSupported(site, credentials), "/seo/tools", {});
}

export async function saveSeoTools(
  site: SiteSummary,
  credentials: SiteCredentials | null,
  settings: SeoToolsSettings,
): Promise<SeoTools> {
  return call<SeoTools>(requireSupported(site, credentials), "/seo/tools/save", settings);
}
