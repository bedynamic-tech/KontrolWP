import { compareVersions, KONTROLWP_CONNECT_VERSION, KONTROLWP_CONNECT_ZIP } from "../../shared/plugin-version.ts";
import { SiteRequestError } from "./client.ts";

/**
 * The update job for KontrolWP Connect itself. The dashboard supplies it and
 * queues it on its own; it never appears in the updates lists.
 */
export const SELF_UPDATE = {
  slug: "kontrolwp-connect",
  version: KONTROLWP_CONNECT_VERSION,
} as const;

/**
 * A finished or failed self-update of the same version waits this long before
 * a scheduled sync tries again, so a site that keeps reporting the old version
 * never loops. A newer version, or the owner's Sync now, goes ahead at once.
 */
const RETRY_FAILED_AFTER_SECONDS = 6 * 60 * 60;

/**
 * Queue KontrolWP Connect's own update when the site runs an older one, unless
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

/**
 * Queue the self-update on every site whose last sync reported an older
 * KontrolWP Connect, without waiting for its next sync. Runs on each cron
 * tick and when the dashboard first loads after a deploy; queueSelfUpdate
 * skips sites already updating or that failed recently.
 */
export async function queueSelfUpdates(env: Env): Promise<void> {
  const { results } = await env.DB
    .prepare("SELECT id, plugin_version FROM sites WHERE plugin_version IS NOT NULL")
    .all<{ id: number; plugin_version: string }>();
  for (const site of results) {
    if (needsSelfUpdate(site.plugin_version)) await queueSelfUpdate(env, site.id, site.plugin_version);
  }
}

/**
 * The first dashboard load after a deploy that ships a new KontrolWP Connect
 * queues it on every site at once. Remembers the version it did this for.
 */
export async function queueSelfUpdatesAfterDeploy(env: Env): Promise<void> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = 'self_update_version'").first<{ value: string }>();
  if (row?.value === KONTROLWP_CONNECT_VERSION) return;
  await env.DB
    .prepare("INSERT OR REPLACE INTO settings (name, value) VALUES ('self_update_version', ?)")
    .bind(KONTROLWP_CONNECT_VERSION)
    .run();
  await queueSelfUpdates(env);
}

/** True when the site runs an older KontrolWP Connect than this dashboard ships. */
export function needsSelfUpdate(siteVersion: string): boolean {
  return !!siteVersion && compareVersions(siteVersion, KONTROLWP_CONNECT_VERSION) < 0;
}

/** The zip the build put in the static assets, base64-encoded for a signed request. */
export async function loadPackage(env: Env): Promise<string> {
  const response = await env.ASSETS.fetch(`https://assets.invalid/downloads/${KONTROLWP_CONNECT_ZIP}`);
  if (!response.ok) throw new SiteRequestError(`The KontrolWP Connect package is missing from this deployment (HTTP ${response.status})`);
  return base64(new Uint8Array(await response.arrayBuffer()));
}

/** Base64 for a zip in a signed JSON body. */
export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
