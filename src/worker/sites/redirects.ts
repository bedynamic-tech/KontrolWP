import { REST_NAMESPACE } from "../../shared/protocol.ts";
import { compareVersions, SEO_REDIRECTS_SINCE } from "../../shared/plugin-version.ts";
import type {
  NotFoundLog,
  RedirectImportResult,
  RedirectInput,
  SiteRedirects,
  SiteSummary,
} from "../../shared/types.ts";
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

export async function setRedirectSettings(site: SiteSummary, credentials: SiteCredentials | null, log404: boolean) {
  return call<{ log_404: boolean }>(requireSupported(site, credentials), "/seo/redirects/settings", {
    log_404: log404,
  });
}

export async function listNotFound(site: SiteSummary, credentials: SiteCredentials | null, page: number) {
  return call<NotFoundLog>(requireSupported(site, credentials), "/seo/404s", { page });
}

export async function clearNotFound(site: SiteSummary, credentials: SiteCredentials | null): Promise<void> {
  await call(requireSupported(site, credentials), "/seo/404s/clear", {});
}
