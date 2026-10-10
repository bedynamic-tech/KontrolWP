import { REST_NAMESPACE } from "../../shared/protocol.ts";
import { compareVersions, DATABASE_CLEANUP_SINCE } from "../../shared/plugin-version.ts";
import type { DatabaseCleanup, DatabaseCleanupResult, DatabaseReport, SiteSummary } from "../../shared/types.ts";
import { clearContentCache } from "../content-cache.ts";
import { callSite, SiteRequestError, type SiteCredentials } from "./client.ts";
import { SeoError } from "./seo.ts";

function requireSupported(site: SiteSummary, credentials: SiteCredentials | null): SiteCredentials {
  if (site.kind === "static" || !credentials)
    throw new SeoError("Database cleanup needs a WordPress site with KontrolWP Connect.", 400);
  if (!site.plugin_version || compareVersions(site.plugin_version, DATABASE_CLEANUP_SINCE) < 0) {
    throw new SeoError(
      `Database cleanup needs KontrolWP Connect ${DATABASE_CLEANUP_SINCE} or later. It updates automatically; select Sync now to check.`,
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

/** The site's database size and what can be cleaned. Read live, since it changes as the site is used. */
export async function siteDatabase(site: SiteSummary, credentials: SiteCredentials | null): Promise<DatabaseReport> {
  return call<DatabaseReport>(requireSupported(site, credentials), "/database", {});
}

/** Deletes the chosen leftovers and optionally optimizes the tables, then reports the database again. */
export async function cleanDatabase(
  env: Env,
  site: SiteSummary,
  credentials: SiteCredentials | null,
  cleanup: DatabaseCleanup,
): Promise<DatabaseCleanupResult> {
  const result = await call<DatabaseCleanupResult>(requireSupported(site, credentials), "/database/clean", cleanup);
  // Trashed posts and comments may be gone, so the Posts and pages list is read again.
  await clearContentCache(env.DB, site.id);
  return result;
}
