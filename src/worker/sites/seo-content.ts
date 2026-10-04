import { REST_NAMESPACE } from "../../shared/protocol.ts";
import { compareVersions, SEO_CONTENT_SINCE } from "../../shared/plugin-version.ts";
import type { SeoContent, SeoContentSettings, SiteSummary } from "../../shared/types.ts";
import { callSite, SiteRequestError, type SiteCredentials } from "./client.ts";
import { SeoError } from "./seo.ts";

function requireSupported(site: SiteSummary, credentials: SiteCredentials | null): SiteCredentials {
  if (site.kind === "static" || !credentials)
    throw new SeoError("These settings need a WordPress site with KontrolWP Connect.", 400);
  if (!site.plugin_version || compareVersions(site.plugin_version, SEO_CONTENT_SINCE) < 0) {
    throw new SeoError(
      `These settings need KontrolWP Connect ${SEO_CONTENT_SINCE} or later. It updates automatically; select Sync now to check.`,
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

export async function siteSeoContent(site: SiteSummary, credentials: SiteCredentials | null): Promise<SeoContent> {
  return call<SeoContent>(requireSupported(site, credentials), "/seo/content", {});
}

export async function saveSeoContent(
  site: SiteSummary,
  credentials: SiteCredentials | null,
  settings: SeoContentSettings,
): Promise<SeoContent> {
  return call<SeoContent>(requireSupported(site, credentials), "/seo/content/save", settings);
}
