import { REST_NAMESPACE } from "../../shared/protocol.ts";
import {
  compareVersions,
  SEO_AUTO_REDIRECTS_SINCE,
  SEO_MIGRATE_SINCE,
  SEO_REDIRECTS_SINCE,
} from "../../shared/plugin-version.ts";
import type {
  AutoRedirectSettings,
  NotFoundLog,
  RedirectImportResult,
  RedirectInput,
  RedirectSettingsChange,
  SeoMigrationParts,
  SeoMigrationPreview,
  SeoMigrationResult,
  SeoMigrationSource,
  SiteRedirects,
  SiteSummary,
} from "../../shared/types.ts";
import { clearContentCache } from "../content-cache.ts";
import { callSite, SiteRequestError, type SiteCredentials } from "./client.ts";
import { SeoError } from "./seo.ts";

/**
 * Redirects live in tables on the site and change with every visit, so none of
 * these answers are cached: each read asks the site.
 */
function requireSupported(site: SiteSummary, credentials: SiteCredentials | null): SiteCredentials {
  if (site.kind === "static" || !credentials)
    throw new SeoError("Redirects need a WordPress site with KontrolWP Connect.", 400);
  if (!site.plugin_version || compareVersions(site.plugin_version, SEO_REDIRECTS_SINCE) < 0) {
    throw new SeoError(
      `Redirects need KontrolWP Connect ${SEO_REDIRECTS_SINCE} or later. It updates automatically; select Sync now to check.`,
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

export interface RedirectQuery {
  page: number;
  search: string;
  per_page?: number;
  export?: boolean;
  auto?: boolean;
}

export async function listRedirects(site: SiteSummary, credentials: SiteCredentials | null, query: RedirectQuery) {
  return call<SiteRedirects>(requireSupported(site, credentials), "/seo/redirects", query);
}

/** Add a rule, or change the one with this id. */
export async function saveRedirect(
  site: SiteSummary,
  credentials: SiteCredentials | null,
  id: number | null,
  rule: RedirectInput,
): Promise<void> {
  await call(requireSupported(site, credentials), "/seo/redirect", { ...(id ? { id } : {}), ...rule });
}

export async function bulkRedirects(
  site: SiteSummary,
  credentials: SiteCredentials | null,
  action: "enable" | "disable" | "delete",
  ids: number[],
): Promise<void> {
  await call(requireSupported(site, credentials), "/seo/redirects/bulk", { action, ids });
}

export async function importRedirects(
  site: SiteSummary,
  credentials: SiteCredentials | null,
  rows: Partial<RedirectInput>[],
) {
  return call<RedirectImportResult>(requireSupported(site, credentials), "/seo/redirects/import", { rows });
}

export async function setRedirectSettings(
  site: SiteSummary,
  credentials: SiteCredentials | null,
  change: RedirectSettingsChange,
) {
  const creds = requireSupported(site, credentials);
  if (
    (change.auto_enabled !== undefined || change.on_delete !== undefined || change.delete_target !== undefined) &&
    (!site.plugin_version || compareVersions(site.plugin_version, SEO_AUTO_REDIRECTS_SINCE) < 0)
  ) {
    throw new SeoError(
      `Automatic redirects need KontrolWP Connect ${SEO_AUTO_REDIRECTS_SINCE} or later. It updates automatically; select Sync now to check.`,
      400,
    );
  }
  return call<{ log_404: boolean; auto?: AutoRedirectSettings }>(creds, "/seo/redirects/settings", change);
}

export async function listNotFound(site: SiteSummary, credentials: SiteCredentials | null, page: number) {
  return call<NotFoundLog>(requireSupported(site, credentials), "/seo/404s", { page });
}

export async function clearNotFound(site: SiteSummary, credentials: SiteCredentials | null): Promise<void> {
  await call(requireSupported(site, credentials), "/seo/404s/clear", {});
}

/* ---- Importing from another SEO plugin ---- */

function requireMigrate(site: SiteSummary, credentials: SiteCredentials | null): SiteCredentials {
  if (site.kind === "static" || !credentials)
    throw new SeoError("Importing needs a WordPress site with KontrolWP Connect.", 400);
  if (!site.plugin_version || compareVersions(site.plugin_version, SEO_MIGRATE_SINCE) < 0) {
    throw new SeoError(
      `Importing from another SEO plugin needs KontrolWP Connect ${SEO_MIGRATE_SINCE} or later. It updates automatically; select Sync now to check.`,
      400,
    );
  }
  return credentials;
}

/** SEO plugins installed on the site, active or not. */
export async function listMigrationSources(site: SiteSummary, credentials: SiteCredentials | null) {
  return call<{ sources: SeoMigrationSource[] }>(requireMigrate(site, credentials), "/seo/migrate", {});
}

/** What importing from a plugin would bring in. Changes nothing. */
export async function previewMigration(site: SiteSummary, credentials: SiteCredentials | null, source: string) {
  return call<SeoMigrationPreview>(requireMigrate(site, credentials), "/seo/migrate/preview", { source });
}

/** Bring the chosen parts in. Only adds, so it is safe to run again. Clears anything cached for the site. */
export async function runMigration(
  env: Env,
  site: SiteSummary,
  credentials: SiteCredentials | null,
  source: string,
  parts: SeoMigrationParts,
) {
  const result = await call<SeoMigrationResult>(requireMigrate(site, credentials), "/seo/migrate/run", {
    source,
    ...parts,
  });
  await clearContentCache(env.DB, site.id);
  return result;
}

/** Deactivate the other plugin. The caller has confirmed; the plugin and its data are kept. */
export async function deactivateMigrationSource(
  env: Env,
  site: SiteSummary,
  credentials: SiteCredentials | null,
  source: string,
) {
  const result = await call<{ name: string; deactivated: string[] }>(
    requireMigrate(site, credentials),
    "/seo/migrate/deactivate",
    { source },
  );
  await clearContentCache(env.DB, site.id);
  return result;
}
