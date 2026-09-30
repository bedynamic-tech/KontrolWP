import type {
  CommentAction,
  Overview,
  SiteDetail,
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
  return error instanceof ApiError && error.code && ACCESS_SETUP_CODES.includes(error.code)
    ? error
    : null;
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api${path}`, {
    ...rest,
    ...(json === undefined
      ? {}
      : { body: JSON.stringify(json), headers: { "Content-Type": "application/json" } }),
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

export const createSite = (input: { url: string; connection_key: string }) =>
  request<SiteSummary>("/sites", { method: "POST", json: input });

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
