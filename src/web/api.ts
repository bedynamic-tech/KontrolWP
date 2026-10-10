import type {
  DatabaseCleanup,
  DatabaseCleanupResult,
  DatabaseReport,
  BuildLog,
  CloudflareSettings,
  CloudflareWorker,
  SiteDeployments,
  BulkPluginResult,
  BulkUserResult,
  FleetUsers,
  NewUser,
  SiteContent,
  SecurityFix,
  GlobalUpdatePolicy,
  GlobalUpdatePolicyView,
  AutoRedirectSettings,
  NotFoundLog,
  RedirectSettingsChange,
  RedirectImportResult,
  RedirectInput,
  SeoMigrationParts,
  SeoMigrationPreview,
  SeoMigrationResult,
  SeoMigrationSource,
  SeoContent,
  SeoContentSettings,
  SeoPageChange,
  SeoTools,
  Snippets,
  SnippetsSettings,
  UpdateEmails,
  Maintenance,
  MaintenanceSave,
  LoginLogo,
  LoginLogoSave,
  LoginUrl,
  LoginUrlSettings,
  SeoToolsSettings,
  SeoPages,
  SeoScore,
  SeoSettings,
  SiteAccessibility,
  SitePerformance,
  SiteUptime,
  SiteSeoAudit,
  SiteRedirects,
  SiteSeo,
  SiteUpdatePolicy,
  SiteUpdatePolicyView,
  SiteSecurity,
  SiteSitemap,
  SiteUsers,
  UserAction,
  CommentAction,
  CoreAutoUpdate,
  AnalyticsRange,
  FleetPlugins,
  SyncSettings,
  SiteAnalytics,
  SiteAnalyticsDetails,
  AnalyticsProvider,
  GoogleSettings,
  SearchConsoleRange,
  SearchConsoleSetup,
  SiteSearchConsole,
  UmamiSettings,
  UmamiWebsite,
  Overview,
  PluginAction,
  SiteAdmin,
  SitePlugins,
  SiteDetail,
  SiteDomain,
  LinkScanSchedule,
  LinkScanSettings,
  LinkUnlinkResult,
  SiteLinks,
  SiteSummary,
  SiteRollback,
  SiteUpdate,
} from "../shared/types";

export interface AccessHint {
  team_domain: string;
  aud: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly hint?: AccessHint,
    /** The existing record's id when a create conflicts with one (409). */
    readonly existingId?: number,
  ) {
    super(message);
  }
}

const ACCESS_SETUP_CODES = ["access_not_configured", "access_missing", "access_invalid"];

/** The Worker has no SITE_SECRETS_KEY yet. */
export function secretsKeyMissing(error: unknown): boolean {
  return error instanceof ApiError && error.code === "secrets_key_missing";
}

/** The API rejected the request because Cloudflare Access is not set up correctly. */
export function accessSetupError(error: unknown): ApiError | null {
  return error instanceof ApiError && error.code && ACCESS_SETUP_CODES.includes(error.code) ? error : null;
}

const SIGN_IN_RELOAD_KEY = "kontrolwp:sign-in-reload";

/**
 * Sends the browser back through Cloudflare Access by reloading the page, at
 * most once a minute so a sign-in that keeps failing cannot loop.
 */
function signInAgain(): boolean {
  try {
    const last = Number(sessionStorage.getItem(SIGN_IN_RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(SIGN_IN_RELOAD_KEY, String(Date.now()));
  } catch {
    // Without storage there is no loop guard, so leave reloading to the user.
    return false;
  }
  window.location.reload();
  return true;
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      // The API never redirects. A redirect is Cloudflare Access sending an
      // expired sign-in to its login page on another origin, which a followed
      // fetch reports as a dropped connection.
      redirect: "manual",
      ...rest,
      ...(json === undefined ? {} : { body: JSON.stringify(json), headers: { "Content-Type": "application/json" } }),
    });
  } catch (error) {
    // The browser's own text for a dropped connection ("Failed to fetch", "Load failed") says nothing useful.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("KontrolWP could not be reached. Check your connection and try again.", 0);
  }
  if (res.type === "opaqueredirect") {
    const reloading = signInAgain();
    throw new ApiError(
      reloading ? "Your sign-in has expired. Signing you in again." : "Your sign-in has expired. Reload the page to sign in again.",
      401,
      "signed_out",
    );
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let body: { error?: string; code?: string; hint?: AccessHint; id?: number } = {};
    try {
      body = await res.json();
      if (body.error) message = body.error;
    } catch {
      // Keep the status-based fallback for non-JSON responses.
    }
    throw new ApiError(message, res.status, body.code, body.hint, body.id);
  }
  return res.json() as Promise<T>;
}

export const fetchOverview = () => request<Overview>("/overview");
export const fetchSite = (id: number) => request<SiteDetail>(`/sites/${id}`);

export type NewSite =
  | { url: string; connection_key: string }
  | { kind: "static"; url: string; name?: string; cloudflare?: boolean; cf_account_id?: string; cf_worker?: string };

export const fetchStaticSiteName = (url: string) =>
  request<{ name: string }>(`/static-site-name?url=${encodeURIComponent(url)}`);
export const createSite = (input: NewSite) => request<SiteSummary>("/sites", { method: "POST", json: input });

export const updateSiteUrl = (id: number, url: string) =>
  request<SiteSummary>(`/sites/${id}`, { method: "PATCH", json: { url } });

/** Rename a site, or pass null to restore its default name. */
export const setSiteName = (id: number, name: string | null) =>
  request<SiteSummary>(`/sites/${id}/name`, { method: "PUT", json: { name } });

export const deleteSite = (id: number) => request<{ ok: true }>(`/sites/${id}`, { method: "DELETE" });

export const replaceConnectionKey = (id: number, connectionKey: string) =>
  request<SiteSummary>(`/sites/${id}/connection-key`, {
    method: "POST",
    json: { connection_key: connectionKey },
  });

export const syncSite = (id: number) => request<{ ok: true }>(`/sites/${id}/sync`, { method: "POST" });

export const moderateComment = (siteId: number, commentId: number, action: CommentAction) =>
  request<{ ok: true }>(`/sites/${siteId}/comments/${commentId}`, { method: "POST", json: { action } });

export const revertUpdate = (siteId: number, item: Pick<SiteRollback, "kind" | "slug">) =>
  request<{ ok: true }>(`/sites/${siteId}/rollbacks`, { method: "POST", json: { kind: item.kind, slug: item.slug } });

export const applyUpdate = (siteId: number, update: Pick<SiteUpdate, "kind" | "slug" | "new_version">) =>
  request<{ ok: true }>(`/sites/${siteId}/updates`, {
    method: "POST",
    json: {
      kind: update.kind,
      slug: update.slug,
      ...(update.kind === "core" ? { version: update.new_version } : {}),
    },
  });

export const fetchAdmins = (siteId: number) => request<{ admins: SiteAdmin[] }>(`/sites/${siteId}/admins`);

export const setMagicLoginUser = (siteId: number, userId: number | null) =>
  request<SiteSummary>(`/sites/${siteId}/magic-login`, { method: "PUT", json: { user_id: userId } });

/** A one-time sign-in link; with postId it opens that post's editor. */
export const createMagicLogin = (siteId: number, postId?: number) =>
  request<{ url: string }>(`/sites/${siteId}/magic-login`, { method: "POST", json: postId ? { post_id: postId } : {} });

export const setUpdatesExcluded = (siteId: number, excluded: boolean) =>
  request<SiteSummary>(`/sites/${siteId}/updates-excluded`, { method: "PUT", json: { excluded } });

export interface ContentFilter {
  type: string;
  status: "all" | "publish" | "future" | "draft" | "pending" | "private";
  search: string;
  page: number;
}

export const fetchContent = (siteId: number, filter: ContentFilter) => {
  const query = new URLSearchParams({ ...filter, page: String(filter.page) });
  return request<SiteContent>(`/sites/${siteId}/content?${query}`);
};

export const setLinksExcluded = (siteId: number, excluded: boolean) =>
  request<SiteSummary>(`/sites/${siteId}/links-excluded`, { method: "PUT", json: { excluded } });

export type SiteFeature = "analytics" | "security" | "accessibility" | "performance" | "uptime";

export const setFeatureExcluded = (siteId: number, feature: SiteFeature, excluded: boolean) =>
  request<SiteSummary>(`/sites/${siteId}/feature-excluded`, { method: "PUT", json: { feature, excluded } });

export const fetchSitePages = (siteId: number) => request<SiteSitemap>(`/sites/${siteId}/pages`);

export const fetchPlugins = (siteId: number) => request<SitePlugins>(`/sites/${siteId}/plugins`);

export const managePlugin = (siteId: number, plugin: string, action: PluginAction) =>
  request<{ ok: true }>(`/sites/${siteId}/plugins`, { method: "POST", json: { plugin, action } });

export type PluginInstall =
  | { source: "wordpress.org"; slug: string; activate: boolean }
  | { source: "url"; url: string; activate: boolean }
  | { source: "zip"; file: File; activate: boolean };

export function installPlugin(siteId: number, install: PluginInstall) {
  const path = `/sites/${siteId}/plugins/install`;
  if (install.source !== "zip") return request<{ ok: true; plugin: string }>(path, { method: "POST", json: install });
  const form = new FormData();
  form.set("file", install.file);
  form.set("activate", String(install.activate));
  return request<{ ok: true; plugin: string }>(path, { method: "POST", body: form });
}

export const fetchFleetPlugins = () => request<FleetPlugins>("/plugins");

export const bulkPluginAction = (plugin: string, action: PluginAction, siteIds: number[]) =>
  request<{ results: BulkPluginResult[] }>("/plugins/bulk", {
    method: "POST",
    json: { plugin, action, site_ids: siteIds },
  });

export function installPluginOnSites(siteIds: number[], install: PluginInstall) {
  const path = "/plugins/install";
  if (install.source !== "zip") {
    return request<{ results: BulkPluginResult[] }>(path, { method: "POST", json: { ...install, site_ids: siteIds } });
  }
  const form = new FormData();
  form.set("file", install.file);
  form.set("activate", String(install.activate));
  form.set("site_ids", siteIds.join(","));
  return request<{ results: BulkPluginResult[] }>(path, { method: "POST", body: form });
}

export const setCoreAutoUpdate = (siteId: number, mode: CoreAutoUpdate) =>
  request<SiteSummary>(`/sites/${siteId}/core-auto-update`, { method: "PUT", json: { mode } });

export const fetchUmamiSettings = () => request<UmamiSettings>("/settings/umami");

export type UmamiInput =
  | { mode: "cloud"; secret?: string }
  | { mode: "self-hosted"; url: string; username: string; secret?: string };

export const saveUmamiSettings = (input: UmamiInput) =>
  request<UmamiSettings & { websites: number }>("/settings/umami", { method: "PUT", json: input });

export const deleteUmamiSettings = () => request<UmamiSettings>("/settings/umami", { method: "DELETE" });

export const fetchUmamiWebsites = () => request<{ websites: UmamiWebsite[] }>("/umami/websites");

export const fetchGoogleSettings = () => request<GoogleSettings>("/settings/google");
export const saveGoogleClient = (client_id: string, client_secret: string) =>
  request<GoogleSettings>("/settings/google/client", { method: "PUT", json: { client_id, client_secret } });
export const deleteGoogleClient = () => request<GoogleSettings>("/settings/google/client", { method: "DELETE" });
/** The address of Google's sign-in page, which the browser then opens. */
export const startGoogleConnect = (options: { setup?: boolean; return_to?: string } = {}) =>
  request<{ url: string }>("/google/connect", { method: "POST", json: options });
export const setUpSearchConsole = (siteId: number) =>
  request<SearchConsoleSetup>(`/sites/${siteId}/search-console/setup`, { method: "POST" });
export const deleteGoogleSettings = () => request<GoogleSettings>("/settings/google", { method: "DELETE" });
export const fetchGa4Properties = () => request<{ websites: UmamiWebsite[] }>("/google/analytics/properties");

export const fetchSearchConsole = (siteId: number, range: SearchConsoleRange) =>
  request<SiteSearchConsole>(`/sites/${siteId}/search-console?range=${range}`);
export const fetchSearchConsoleProperties = () =>
  request<{ websites: UmamiWebsite[] }>("/google/search-console/properties");
export const setSiteSearchConsoleProperty = (siteId: number, property: string | null) =>
  request<{ ok: true }>(`/sites/${siteId}/search-console`, { method: "PUT", json: { property } });


export const setSiteAnalyticsProvider = (siteId: number, provider: AnalyticsProvider) =>
  request<{ ok: true }>(`/sites/${siteId}/analytics-provider`, { method: "PUT", json: { provider } });

export const setSiteAnalyticsSource = (siteId: number, ref: string | null) =>
  request<{ ok: true }>(`/sites/${siteId}/analytics-source`, { method: "PUT", json: { ref } });

export const setSiteUmamiWebsite = (siteId: number, websiteId: string | null) =>
  request<{ ok: true }>(`/sites/${siteId}/umami`, { method: "PUT", json: { website_id: websiteId } });

export const fetchSiteAnalyticsDetails = (siteId: number, range: AnalyticsRange) => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return request<SiteAnalyticsDetails>(
    `/sites/${siteId}/analytics/details?range=${range}&tz=${encodeURIComponent(tz)}`,
  );
};
export const fetchSiteAnalytics = (siteId: number, range: AnalyticsRange) => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return request<SiteAnalytics>(`/sites/${siteId}/analytics?range=${range}&tz=${encodeURIComponent(tz)}`);
};

export const fetchLinkScanSettings = () => request<LinkScanSchedule>("/settings/links");
export const saveLinkScanSettings = (settings: Partial<LinkScanSettings>) =>
  request<LinkScanSchedule>("/settings/links", { method: "PUT", json: settings });
export const fetchSyncSettings = () => request<SyncSettings>("/settings/sync");
export const saveSyncSettings = (settings: SyncSettings) =>
  request<SyncSettings>("/settings/sync", { method: "PUT", json: settings });

export const fetchDomain = (siteId: number, refresh = false) =>
  request<SiteDomain>(`/sites/${siteId}/domain${refresh ? "?refresh=1" : ""}`);
export const fetchLinks = (siteId: number) => request<SiteLinks>(`/sites/${siteId}/links`);
export const scanLinks = (siteId: number) => request<SiteLinks>(`/sites/${siteId}/links/scan`, { method: "POST" });
export const recheckLink = (siteId: number, url: string) =>
  request<SiteLinks>(`/sites/${siteId}/links/recheck`, { method: "POST", json: { url } });
export const unlinkLinks = (siteId: number, urls: string[]) =>
  request<{ result: LinkUnlinkResult; links: SiteLinks }>(`/sites/${siteId}/links/unlink`, {
    method: "POST",
    json: { urls },
  });
export const ignoreLink = (siteId: number, url: string, ignored: boolean) =>
  request<SiteLinks>(`/sites/${siteId}/links/ignore`, { method: "POST", json: { url, ignored } });
export const fetchUsers = (siteId: number) => request<SiteUsers>(`/sites/${siteId}/users`);

export const createUser = (siteId: number, user: NewUser) =>
  request<{ ok: true; user_id: number }>(`/sites/${siteId}/users`, { method: "POST", json: user });

export const manageUser = (siteId: number, userId: number, action: UserAction, role?: string) =>
  request<{ ok: true }>(`/sites/${siteId}/users/manage`, { method: "POST", json: { user_id: userId, action, role } });

export const fetchFleetUsers = () => request<FleetUsers>("/users");

export const bulkUserAction = (action: UserAction, targets: { site_id: number; user_id: number }[], role?: string) =>
  request<{ results: BulkUserResult[] }>("/users/bulk", { method: "POST", json: { action, role, targets } });

export const createUserOnSites = (siteIds: number[], user: NewUser) =>
  request<{ results: BulkPluginResult[] }>("/users", { method: "POST", json: { ...user, site_ids: siteIds } });

export const fetchCloudflareSettings = () => request<CloudflareSettings>("/settings/cloudflare");

export const saveCloudflareSettings = (token: string) =>
  request<CloudflareSettings & { workers: number }>("/settings/cloudflare", { method: "PUT", json: { token } });

export const deleteCloudflareSettings = () => request<CloudflareSettings>("/settings/cloudflare", { method: "DELETE" });

export const fetchCloudflareWorkers = () => request<{ workers: CloudflareWorker[] }>("/cloudflare/workers");

/** Whether a static site is hosted on Cloudflare Workers and, if so, from which Worker. */
export const setSiteCloudflare = (siteId: number, input: { hosted: boolean; account_id?: string; worker?: string }) =>
  request<SiteSummary>(`/sites/${siteId}/cloudflare`, { method: "PUT", json: input });

export const fetchSiteDeployments = (siteId: number) => request<SiteDeployments>(`/sites/${siteId}/deployments`);

export const fetchBuildLog = (siteId: number, buildId: string, cursor?: string | null) =>
  request<BuildLog>(
    `/sites/${siteId}/builds/${encodeURIComponent(buildId)}/logs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
  );

export const fetchSecurity = (siteId: number) => request<SiteSecurity>(`/sites/${siteId}/security`);


export const setSecurityFixes = (siteId: number, ids: string[], enabled: boolean) =>
  request<{ fixes: SecurityFix[] }>(`/sites/${siteId}/security/fixes`, { method: "PUT", json: { ids, enabled } });

export const fetchPerformance = (siteId: number) => request<SitePerformance>(`/sites/${siteId}/performance`);
export const runPerformance = (siteId: number) =>
  request<SitePerformance>(`/sites/${siteId}/performance/run`, { method: "POST" });
export const fetchUptime = (siteId: number) => request<SiteUptime>(`/sites/${siteId}/uptime`);
export const checkUptime = (siteId: number) =>
  request<SiteUptime>(`/sites/${siteId}/uptime/check`, { method: "POST" });
export const fetchPagespeedSettings = () => request<{ configured: boolean }>("/settings/pagespeed");
export const savePagespeedKey = (key: string) =>
  request<{ configured: boolean }>("/settings/pagespeed", { method: "PUT", json: { key } });
export const deletePagespeedKey = () => request<{ configured: boolean }>("/settings/pagespeed", { method: "DELETE" });
export const fetchAccessibility = (siteId: number) => request<SiteAccessibility>(`/sites/${siteId}/accessibility`);
export const scanAccessibility = (siteId: number) =>
  request<SiteAccessibility>(`/sites/${siteId}/accessibility/scan`, { method: "POST" });
export const setAccessibilityFixes = (siteId: number, ids: string[], enabled: boolean) =>
  request<SiteAccessibility>(`/sites/${siteId}/accessibility/fixes`, { method: "PUT", json: { ids, enabled } });

export const fetchGlobalUpdatePolicy = () => request<GlobalUpdatePolicyView>("/settings/updates");
export const saveGlobalUpdatePolicy = (policy: GlobalUpdatePolicy) =>
  request<GlobalUpdatePolicyView>("/settings/updates", { method: "PUT", json: policy });
export const fetchSiteUpdatePolicy = (siteId: number) =>
  request<SiteUpdatePolicyView>(`/sites/${siteId}/update-policy`);
export const saveSiteUpdatePolicy = (siteId: number, policy: SiteUpdatePolicy) =>
  request<SiteUpdatePolicyView>(`/sites/${siteId}/update-policy`, { method: "PUT", json: policy });

export const fetchWordfenceSettings = () => request<{ configured: boolean }>("/settings/wordfence");

export const saveWordfenceKey = (key: string) =>
  request<{ configured: boolean; updated_at: number | null }>("/settings/wordfence", { method: "PUT", json: { key } });

export const deleteWordfenceKey = () => request<{ configured: boolean }>("/settings/wordfence", { method: "DELETE" });

export const fetchSeo = (siteId: number) => request<SiteSeo>(`/sites/${siteId}/seo`);
export const saveSeo = (siteId: number, settings: SeoSettings) =>
  request<SiteSeo>(`/sites/${siteId}/seo`, { method: "PUT", json: settings });
export const fetchSeoPages = (siteId: number, page: number, search: string) =>
  request<SeoPages>(`/sites/${siteId}/seo/pages`, { method: "POST", json: { page, search } });
export const fetchRedirects = (
  siteId: number,
  query: { page: number; search: string; per_page?: number; export?: boolean; auto?: boolean },
) => request<SiteRedirects>(`/sites/${siteId}/seo/redirects`, { method: "POST", json: query });
export const createRedirect = (siteId: number, rule: RedirectInput) =>
  request<{ ok: true }>(`/sites/${siteId}/seo/redirect`, { method: "POST", json: rule });
export const updateRedirect = (siteId: number, id: number, rule: RedirectInput) =>
  request<{ ok: true }>(`/sites/${siteId}/seo/redirects/${id}`, { method: "PUT", json: rule });
export const bulkRedirects = (siteId: number, action: "enable" | "disable" | "delete", ids: number[]) =>
  request<{ ok: true }>(`/sites/${siteId}/seo/redirects/bulk`, { method: "POST", json: { action, ids } });
export const importRedirects = (siteId: number, rows: Partial<RedirectInput>[]) =>
  request<RedirectImportResult>(`/sites/${siteId}/seo/redirects/import`, { method: "POST", json: { rows } });
export const setRedirectSettings = (siteId: number, change: RedirectSettingsChange) =>
  request<{ log_404: boolean; auto?: AutoRedirectSettings }>(`/sites/${siteId}/seo/redirects-settings`, {
    method: "PUT",
    json: change,
  });
export const fetchNotFound = (siteId: number, page: number) =>
  request<NotFoundLog>(`/sites/${siteId}/seo/404s`, { method: "POST", json: { page } });
export const clearNotFound = (siteId: number) =>
  request<{ ok: true }>(`/sites/${siteId}/seo/404s/clear`, { method: "POST", json: {} });
export const fetchMigrationSources = (siteId: number) =>
  request<{ sources: SeoMigrationSource[] }>(`/sites/${siteId}/seo/migrate`);
export const previewMigration = (siteId: number, source: string) =>
  request<SeoMigrationPreview>(`/sites/${siteId}/seo/migrate/preview`, { method: "POST", json: { source } });
export const runMigration = (siteId: number, source: string, parts: SeoMigrationParts) =>
  request<SeoMigrationResult>(`/sites/${siteId}/seo/migrate/run`, { method: "POST", json: { source, ...parts } });
export const deactivateMigrationSource = (siteId: number, source: string) =>
  request<{ name: string; deactivated: string[] }>(`/sites/${siteId}/seo/migrate/deactivate`, {
    method: "POST",
    json: { source, confirm: true },
  });
export const fetchMaintenance = (siteId: number) => request<Maintenance>(`/sites/${siteId}/maintenance`);
export const saveMaintenance = (siteId: number, settings: MaintenanceSave) =>
  request<Maintenance>(`/sites/${siteId}/maintenance`, { method: "PUT", json: settings });
export const fetchUpdateEmails = (siteId: number) => request<UpdateEmails>(`/sites/${siteId}/update-emails`);
export const saveUpdateEmails = (siteId: number, disabled: boolean) =>
  request<UpdateEmails>(`/sites/${siteId}/update-emails`, { method: "PUT", json: { disabled } });
export const fetchLoginUrl = (siteId: number) => request<LoginUrl>(`/sites/${siteId}/login-url`);
export const saveLoginUrl = (siteId: number, settings: LoginUrlSettings) =>
  request<LoginUrl>(`/sites/${siteId}/login-url`, { method: "PUT", json: settings });

export const fetchLoginLogo = (siteId: number) => request<LoginLogo>(`/sites/${siteId}/login-logo`);
export const saveLoginLogo = (siteId: number, settings: LoginLogoSave) =>
  request<LoginLogo>(`/sites/${siteId}/login-logo`, { method: "PUT", json: settings });
export const fetchDatabase = (siteId: number) => request<DatabaseReport>(`/sites/${siteId}/database`);
export const cleanDatabase = (siteId: number, cleanup: DatabaseCleanup) =>
  request<DatabaseCleanupResult>(`/sites/${siteId}/database/clean`, { method: "POST", json: cleanup });
export const fetchSnippets = (siteId: number) => request<Snippets>(`/sites/${siteId}/snippets`);
export const saveSnippets = (siteId: number, settings: SnippetsSettings) =>
  request<Snippets>(`/sites/${siteId}/snippets`, { method: "PUT", json: settings });
export const fetchSeoTools = (siteId: number) => request<SeoTools>(`/sites/${siteId}/seo/tools`);
export const saveSeoTools = (siteId: number, settings: SeoToolsSettings) =>
  request<SeoTools>(`/sites/${siteId}/seo/tools`, { method: "PUT", json: settings });
export const fetchSeoContent = (siteId: number) => request<SeoContent>(`/sites/${siteId}/seo/content`);
export const saveSeoContent = (siteId: number, settings: SeoContentSettings) =>
  request<SeoContent>(`/sites/${siteId}/seo/content`, { method: "PUT", json: settings });
export const saveSeoPage = (siteId: number, pageId: number, change: SeoPageChange) =>
  request<{ ok: true }>(`/sites/${siteId}/seo/pages/${pageId}`, { method: "PUT", json: change });
export const fetchSeoScore = (
  siteId: number,
  pageId: number,
  draft: { seo_title: string; description: string; keyword: string },
) => request<SeoScore>(`/sites/${siteId}/seo/pages/${pageId}/score`, { method: "POST", json: draft });

export const fetchSeoAudit = (siteId: number) => request<SiteSeoAudit>(`/sites/${siteId}/seo-audit`);
export const scanSeoAudit = (siteId: number) =>
  request<SiteSeoAudit>(`/sites/${siteId}/seo-audit/scan`, { method: "POST" });
