import type { BuildLog, CloudflareWorker, DeploymentStatus, SiteDeployment } from "../shared/types.ts";
import { decryptSetting, encryptSetting } from "./sites/secrets.ts";

/**
 * Cloudflare's API (https://developers.cloudflare.com/api), read only: which
 * Workers an account has, the deployments of one Worker, and its Workers
 * Builds runs and logs. The Builds API needs a user API token with the
 * "Workers Builds Configuration" permission; the others need "Workers Scripts"
 * and "Account Settings", read access each.
 */

const API = "https://api.cloudflare.com/client/v4";
const SETTING = "cloudflare";
const TIMEOUT_MS = 15_000;
/** How many deployments and builds a site keeps. */
export const HISTORY_LIMIT = 20;

export class CloudflareError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/** The saved API token, or null when none is. */
export async function loadCloudflareToken(env: Env): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = ?")
    .bind(SETTING)
    .first<{ value: string }>();
  if (!row) return null;
  const stored = JSON.parse(row.value) as { token: string };
  return decryptSetting(env.SITE_SECRETS_KEY, SETTING, stored.token);
}

export async function saveCloudflareToken(env: Env, token: string): Promise<void> {
  const value = JSON.stringify({ token: await encryptSetting(env.SITE_SECRETS_KEY, SETTING, token) });
  await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES (?, ?)").bind(SETTING, value).run();
}

export async function deleteCloudflareToken(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE name = ?").bind(SETTING).run();
}

interface Envelope<T> {
  success?: boolean;
  result?: T;
  errors?: { code?: number; message?: string }[];
}

export async function call<T>(token: string, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  const url = `${API}${path}${query.size ? `?${query}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError" ? "did not answer in time" : "could not be reached";
    throw new CloudflareError(`Cloudflare ${reason}.`);
  }
  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    // Handled below with the status.
  }
  if (res.status === 401) throw new CloudflareError("Cloudflare did not accept that API token.", 400);
  if (res.status === 403) {
    throw new CloudflareError(
      `The Cloudflare API token cannot read ${path.split("/").slice(3, 5).join(" ")}. Give it read access to Workers Scripts, Account Settings and Workers Builds Configuration.`,
      400,
    );
  }
  if (res.status === 429) throw new CloudflareError("Cloudflare is rate limiting requests. Try again in a moment.");
  if (!res.ok || !body || body.success === false) {
    const detail = body?.errors?.[0]?.message;
    throw new CloudflareError(
      `Cloudflare answered ${res.status}${detail ? `: ${detail}` : ""}.`,
      res.status === 404 ? 404 : 502,
    );
  }
  return body.result as T;
}

/** Every Worker the token can see, across its accounts. */
export async function listWorkers(token: string): Promise<CloudflareWorker[]> {
  const accounts = (await call<{ id: string; name: string }[]>(token, "/accounts", { per_page: 20 })) ?? [];
  if (!accounts.length) throw new CloudflareError("That API token cannot see any Cloudflare account.", 400);
  const lists = await Promise.allSettled(
    accounts.map(async (account) => {
      const scripts = await call<{ id: string; tag?: string }[]>(token, `/accounts/${account.id}/workers/scripts`);
      return (Array.isArray(scripts) ? scripts : [])
        .filter((script) => script.id && script.tag)
        .map(
          (script): CloudflareWorker => ({
            account_id: account.id,
            account_name: account.name,
            name: script.id,
            tag: script.tag!,
          }),
        );
    }),
  );
  const failed = lists.find((list): list is PromiseRejectedResult => list.status === "rejected");
  if (failed && lists.every((list) => list.status === "rejected")) throw failed.reason;
  return lists
    .flatMap((list) => (list.status === "fulfilled" ? list.value : []))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The Worker's immutable tag, which the Builds API addresses it by. */
export async function workerTag(token: string, accountId: string, name: string): Promise<string | null> {
  const scripts = await call<{ id: string; tag?: string }[]>(token, `/accounts/${accountId}/workers/scripts`);
  return (Array.isArray(scripts) ? scripts : []).find((script) => script.id === name)?.tag ?? null;
}

const seconds = (value: unknown): number => {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
};

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");

interface RawDeployment {
  id?: string;
  source?: string;
  author_email?: string;
  created_on?: string;
  annotations?: Record<string, unknown>;
}

/** What went live on the Worker, newest first. */
export async function fetchDeployments(token: string, accountId: string, name: string): Promise<SiteDeployment[]> {
  const result = await call<{ deployments?: RawDeployment[] }>(
    token,
    `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}/deployments`,
    { per_page: HISTORY_LIMIT },
  );
  return (Array.isArray(result?.deployments) ? result.deployments : [])
    .filter((deployment) => deployment.id)
    .map((deployment) => ({
      type: "deployment" as const,
      ref: text(deployment.id, 100),
      created_at: seconds(deployment.created_on),
      status: "live" as const,
      message: text(deployment.annotations?.["workers/message"], 500),
      author: text(deployment.author_email, 200),
      source: text(deployment.source, 100),
      branch: "",
      commit_hash: "",
    }))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, HISTORY_LIMIT);
}

interface RawBuild {
  build_uuid?: string;
  created_on?: string;
  status?: string;
  build_outcome?: string | null;
  build_trigger_metadata?: {
    author?: string;
    branch?: string;
    commit_hash?: string;
    commit_message?: string;
    build_trigger_source?: string;
  };
}

/** A build's state: its run status until it stops, then how it ended. */
export function buildStatus(build: Pick<RawBuild, "status" | "build_outcome">): DeploymentStatus {
  if (build.status === "queued") return "queued";
  if (build.status !== "stopped") return "building";
  switch (build.build_outcome) {
    case "success":
      return "success";
    case "skipped":
      return "skipped";
    case "cancelled":
    case "terminated":
      return "cancelled";
    default:
      return "failed";
  }
}

/** The Worker's Workers Builds runs, newest first. */
export async function fetchBuilds(token: string, accountId: string, tag: string): Promise<SiteDeployment[]> {
  const result = await call<RawBuild[]>(
    token,
    `/accounts/${accountId}/builds/workers/${encodeURIComponent(tag)}/builds`,
    {
      per_page: HISTORY_LIMIT,
    },
  );
  return (Array.isArray(result) ? result : [])
    .filter((build) => build.build_uuid)
    .map((build) => {
      const meta = build.build_trigger_metadata ?? {};
      return {
        type: "build" as const,
        ref: text(build.build_uuid, 100),
        created_at: seconds(build.created_on),
        status: buildStatus(build),
        message: text(meta.commit_message, 500).split("\n")[0],
        author: text(meta.author, 200),
        source: text(meta.build_trigger_source, 100),
        branch: text(meta.branch, 200),
        commit_hash: text(meta.commit_hash, 64),
      };
    })
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, HISTORY_LIMIT);
}

/** One page of a build's log, from `cursor` or the start. */
export async function fetchBuildLog(
  token: string,
  accountId: string,
  buildUuid: string,
  cursor?: string,
): Promise<BuildLog> {
  const result = await call<{ lines?: unknown; cursor?: unknown; truncated?: unknown }>(
    token,
    `/accounts/${accountId}/builds/builds/${encodeURIComponent(buildUuid)}/logs`,
    cursor ? { cursor } : {},
  );
  const lines = (Array.isArray(result?.lines) ? result.lines : [])
    .filter((line): line is [number, string] => Array.isArray(line) && typeof line[1] === "string")
    .map(([time, line]) => ({
      // Cloudflare documents seconds; accept milliseconds too.
      time: Math.floor(Number(time) > 1e12 ? Number(time) / 1000 : Number(time)) || 0,
      text: line.slice(0, 2000),
    }));
  return {
    lines,
    cursor: typeof result?.cursor === "string" && result.cursor && lines.length ? result.cursor : null,
    truncated: result?.truncated === true,
  };
}
