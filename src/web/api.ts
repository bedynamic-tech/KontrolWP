import type {
  BuildLog,
  CloudflareSettings,
  CloudflareWorker,
  SiteDeployments,
  BulkPluginResult,
  BulkUserResult,
  FleetUsers,
  NewUser,
  SiteUsers,
  UserAction,
  CommentAction,
  CoreAutoUpdate,
  AnalyticsRange,
  FleetPlugins,
  LayoutSettings,
  SyncSettings,
  SiteAnalytics,
  SiteAnalyticsDetails,
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

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api${path}`, {
    ...rest,
    ...(json === undefined ? {} : { body: JSON.stringify(json), headers: { "Content-Type": "application/json" } }),
  });
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
  | { kind: "static"; url: string; name?: string; cf_account_id?: string; cf_worker?: string };

export const createSite = (input: NewSite) => request<SiteSummary>("/sites", { method: "POST", json: input });

export const updateSiteUrl = (id: number, url: string) =>
  request<SiteSummary>(`/sites/${id}`, { method: "PATCH", json: { url } });

export const deleteSite = (id: number) => request<{ ok: true }>(`/sites/${id}`, { method: "DELETE" });

export const replaceConnectionKey = (id: number, connectionKey: string) =>
  request<SiteSummary>(`/sites/${id}/connection-key`, {
    method: "POST",
    json: { connection_key: connectionKey },
  });

export const syncSite = (id: number) => request<{ ok: true }>(`/sites/${id}/sync`, { method: "POST" });

export const moderateComment = (siteId: number, commentId: number, action: CommentAction) =>
  request<{ ok: true }>(`/sites/${siteId}/comments/${commentId}`, { method: "POST", json: { action } });

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

export const bulkCoreAutoUpdate = (siteIds: number[], mode: CoreAutoUpdate) =>
  request<{ results: BulkPluginResult[] }>("/core-auto-update", { method: "POST", json: { mode, site_ids: siteIds } });

export const fetchUmamiSettings = () => request<UmamiSettings>("/settings/umami");

export type UmamiInput =
  | { mode: "cloud"; secret?: string }
  | { mode: "self-hosted"; url: string; username: string; secret?: string };

export const saveUmamiSettings = (input: UmamiInput) =>
  request<UmamiSettings & { websites: number }>("/settings/umami", { method: "PUT", json: input });

export const deleteUmamiSettings = () => request<UmamiSettings>("/settings/umami", { method: "DELETE" });

export const fetchUmamiWebsites = () => request<{ websites: UmamiWebsite[] }>("/umami/websites");

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

export const fetchLayoutSettings = () => request<LayoutSettings>("/settings/layout");

export const saveLayoutSettings = (layout: LayoutSettings) =>
  request<LayoutSettings>("/settings/layout", { method: "PUT", json: layout });

export const fetchDomain = (siteId: number) => request<SiteDomain>(`/sites/${siteId}/domain`);
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

export const setSiteWorker = (siteId: number, worker: { account_id: string; worker: string } | null) =>
  request<SiteSummary>(`/sites/${siteId}/cloudflare`, { method: "PUT", json: worker });

export const fetchSiteDeployments = (siteId: number) => request<SiteDeployments>(`/sites/${siteId}/deployments`);

export const fetchBuildLog = (siteId: number, buildId: string, cursor?: string | null) =>
  request<BuildLog>(
    `/sites/${siteId}/builds/${encodeURIComponent(buildId)}/logs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
