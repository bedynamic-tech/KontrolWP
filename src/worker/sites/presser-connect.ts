import { compareVersions, PRESSER_CONNECT_VERSION } from "../../shared/plugin-version.ts";
import { SiteRequestError } from "./client.ts";

/**
 * The update job for Presser Connect itself. The dashboard supplies it and
 * queues it on its own; it never appears in the updates lists.
 */
export const SELF_UPDATE = {
  slug: "presser-connect",
  version: PRESSER_CONNECT_VERSION,
} as const;

/**
 * A finished or failed self-update of the same version waits this long before
 * a scheduled sync tries again, so a site that keeps reporting the old version
 * never loops. A newer version, or the owner's Sync now, goes ahead at once.
 */
const RETRY_FAILED_AFTER_SECONDS = 6 * 60 * 60;

/**
 * Queue Presser Connect's own update when the site runs an older one, unless
 * it is already queued or running, or this version finished or failed
 * recently. `retry` (Sync now) skips the wait.
 */
export async function queueSelfUpdate(env: Env, siteId: number, siteVersion: string, retry = false): Promise<void> {
  if (!needsSelfUpdate(siteVersion)) return;
  const queued = await env.DB
    .prepare(
      `INSERT INTO update_jobs (site_id, kind, slug, version) VALUES (?, 'plugin', ?, ?)
       ON CONFLICT (site_id, kind, slug) DO UPDATE SET
         status = 'queued', version = excluded.version, error = NULL, attempts = 0,
         created_at = unixepoch(), started_at = NULL
       WHERE update_jobs.status IN ('done', 'failed')
         AND (? OR update_jobs.version IS NOT excluded.version OR COALESCE(update_jobs.started_at, 0) < ?)
       RETURNING id`,
    )
    .bind(
      siteId,
      SELF_UPDATE.slug,
      SELF_UPDATE.version,
      retry ? 1 : 0,
      Math.floor(Date.now() / 1000) - RETRY_FAILED_AFTER_SECONDS,
    )
    .first();
  if (queued) await env.SYNC_QUEUE.send({ type: "update", siteId });
}

/** True when the site runs an older Presser Connect than this dashboard ships. */
export function needsSelfUpdate(siteVersion: string): boolean {
  return !!siteVersion && compareVersions(siteVersion, PRESSER_CONNECT_VERSION) < 0;
}

/** The zip the build put in the static assets, base64-encoded for a signed request. */
export async function loadPackage(env: Env): Promise<string> {
  const response = await env.ASSETS.fetch("https://assets.invalid/downloads/presser-connect.zip");
  if (!response.ok) throw new SiteRequestError(`The Presser Connect package is missing from this deployment (HTTP ${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
