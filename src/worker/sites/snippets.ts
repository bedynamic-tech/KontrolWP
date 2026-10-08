import { REST_NAMESPACE } from "../../shared/protocol.ts";
import { compareVersions, SNIPPETS_SINCE } from "../../shared/plugin-version.ts";
import type { Snippets, SnippetsSettings, SiteSummary } from "../../shared/types.ts";
import { cachedRead, clearContentCache } from "../content-cache.ts";
import { callSite, SiteRequestError, type SiteCredentials } from "./client.ts";
import { SeoError } from "./seo.ts";

function requireSupported(site: SiteSummary, credentials: SiteCredentials | null): SiteCredentials {
  if (site.kind === "static" || !credentials)
    throw new SeoError("Code snippets need a WordPress site with KontrolWP Connect.", 400);
  if (!site.plugin_version || compareVersions(site.plugin_version, SNIPPETS_SINCE) < 0) {
    throw new SeoError(
      `Code snippets need KontrolWP Connect ${SNIPPETS_SINCE} or later. It updates automatically; select Sync now to check.`,
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

/** The site's code snippets, kept like the other modules' and cleared by a sync or a save. */
export async function siteSnippets(env: Env, site: SiteSummary, credentials: SiteCredentials | null): Promise<Snippets> {
  const creds = requireSupported(site, credentials);
  return cachedRead(env.DB, site.id, "seo", "snippets", () => call<Snippets>(creds, "/snippets", {}));
}

export async function saveSnippets(
  env: Env,
  site: SiteSummary,
  credentials: SiteCredentials | null,
  settings: SnippetsSettings,
): Promise<Snippets> {
  const saved = await call<Snippets>(requireSupported(site, credentials), "/snippets/save", settings);
  await clearContentCache(env.DB, site.id);
  return saved;
}
