import { REST_NAMESPACE } from "../../shared/protocol.ts";
import type { UpdateKind } from "../../shared/types.ts";
import { callSite, SiteRequestError } from "./client.ts";
import { SecretsKeyError } from "./secrets.ts";
import { loadPackage, SELF_UPDATE } from "./kontrolwp-connect.ts";
import { getCredentials } from "./store.ts";
import { syncSite } from "./sync.ts";

// WordPress puts the site in maintenance mode while it updates, so each site
// runs one update at a time. Jobs live in update_jobs; a queue message only
// says "this site may have work", and claiming a job is a single statement,
// so two consumers never run updates on one site at once.

export interface UpdateRequest {
  kind: UpdateKind;
  slug: string;
  /** Core only: the version the owner saw. */
  version?: string;
}

/** A 503 usually means WordPress is still in maintenance mode; try again later. */
const BUSY_RETRY_SECONDS = 30;
const MAX_ATTEMPTS = 5;
/** Longer than a site action may take (client.ts), so only a lost job is this old. */
const STALE_AFTER_SECONDS = 15 * 60;

/** A sync that fails right after an update (the site is still restarting) is tried again, a few times. */
export const RESYNC_SECONDS = 45;
export const MAX_RESYNCS = 5;

export type UpdateStep =
  | { next: "idle" }
  | { next: "continue" }
  | { next: "retry"; delaySeconds: number }
  | { next: "resync"; delaySeconds: number };

const now = () => Math.floor(Date.now() / 1000);

/** Queue an update for a site and wake the consumer. Queuing the same update again is a no-op. */
export async function enqueueUpdate(
  env: Env,
  siteId: number,
  update: UpdateRequest,
  /** False when the caller wakes the consumer itself, once for many updates. */
  wake = true,
): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO update_jobs (site_id, kind, slug, version) VALUES (?, ?, ?, ?)
       ON CONFLICT (site_id, kind, slug) DO UPDATE SET
         status = 'queued', action = 'update', version = excluded.version, error = NULL, attempts = 0,
         created_at = unixepoch(), started_at = NULL
       WHERE update_jobs.status IN ('failed', 'done')`,
    )
    .bind(siteId, update.kind, update.slug, update.version ?? null)
    .run();
  if (wake) await env.SYNC_QUEUE.send({ type: "update", siteId });
}

export class RollbackError extends Error {}

/**
 * Queue putting back the previous version KontrolWP Connect kept of a plugin
 * or theme. It runs in the Update Queue, since WordPress replaces the files
 * the same way an update does. The job's version is the one being left, which
 * scheduled updates then skip (update_holds).
 */
export async function enqueueRollback(
  env: Env,
  siteId: number,
  item: { kind: "plugin" | "theme"; slug: string },
): Promise<void> {
  const kept = await env.DB
    .prepare("SELECT current_version FROM site_rollbacks WHERE site_id = ? AND kind = ? AND slug = ?")
    .bind(siteId, item.kind, item.slug)
    .first<{ current_version: string }>();
  if (!kept) throw new RollbackError("There is no previous version of this on the site. Sync the site to check.");
  const queued = await env.DB
    .prepare(
      `INSERT INTO update_jobs (site_id, kind, slug, version, action) VALUES (?, ?, ?, ?, 'rollback')
       ON CONFLICT (site_id, kind, slug) DO UPDATE SET
         status = 'queued', action = 'rollback', version = excluded.version, error = NULL, attempts = 0,
         created_at = unixepoch(), started_at = NULL
       WHERE update_jobs.status IN ('failed', 'done')`,
    )
    .bind(siteId, item.kind, item.slug, kept.current_version)
    .run();
  if (!queued.meta.changes) {
    // Already queued or running: a second click is a no-op, but not an update of the same item.
    const job = await env.DB
      .prepare("SELECT action FROM update_jobs WHERE site_id = ? AND kind = ? AND slug = ?")
      .bind(siteId, item.kind, item.slug)
      .first<{ action: string }>();
    if (job?.action !== "rollback") throw new RollbackError("An update of this is in the queue. Revert once it is done.");
  }
  await env.SYNC_QUEUE.send({ type: "update", siteId });
}

/**
 * Run the site's oldest queued update, unless one is already running.
 * Returns what the consumer should do next for this site.
 */
export async function runNextUpdate(env: Env, siteId: number): Promise<UpdateStep> {
  const time = now();
  // A job still "running" long after any request could last was lost (the
  // Worker stopped mid-update). Whether it finished is unknown; a sync shows.
  await env.DB
    .prepare(
      `UPDATE update_jobs SET status = 'failed',
         error = 'KontrolWP lost track of this update. Sync the site to see whether it finished.'
       WHERE site_id = ? AND status = 'running' AND started_at < ?`,
    )
    .bind(siteId, time - STALE_AFTER_SECONDS)
    .run();

  const job = await env.DB
    .prepare(
      `UPDATE update_jobs SET status = 'running', started_at = ?, attempts = attempts + 1
       WHERE id = (SELECT id FROM update_jobs WHERE site_id = ? AND status = 'queued' ORDER BY created_at, id LIMIT 1)
         AND NOT EXISTS (SELECT 1 FROM update_jobs WHERE site_id = ? AND status = 'running')
       RETURNING id, kind, slug, version, attempts, action`,
    )
    .bind(time, siteId, siteId)
    .first<{
      id: number;
      kind: UpdateKind;
      slug: string;
      version: string | null;
      attempts: number;
      action: "update" | "rollback";
    }>();
  // Nothing queued, or another consumer is running this site's update and
  // will pick up the rest when it finishes.
  if (!job) return { next: "idle" };

  const finish = (status: "queued" | "done" | "failed", error: string | null = null) =>
    env.DB.prepare("UPDATE update_jobs SET status = ?, error = ? WHERE id = ?").bind(status, error, job.id).run();

  try {
    const site = await getCredentials(env, siteId);
    if (!site) return { next: "idle" };
    if (job.action === "rollback") {
      await callSite(site, "POST", `${REST_NAMESPACE}/updates/rollback`, { kind: job.kind, slug: job.slug });
      // Scheduled updates leave the version the owner just reverted away from alone.
      if (job.version) {
        await env.DB
          .prepare(
            `INSERT INTO update_holds (site_id, kind, slug, version) VALUES (?, ?, ?, ?)
             ON CONFLICT (site_id, kind, slug) DO UPDATE SET version = excluded.version, created_at = unixepoch()`,
          )
          .bind(siteId, job.kind, job.slug, job.version)
          .run();
      }
    } else if (job.kind === "plugin" && job.slug === SELF_UPDATE.slug) {
      // Record the version tried, so sync waits before trying it again.
      await env.DB.prepare("UPDATE update_jobs SET version = ? WHERE id = ?").bind(SELF_UPDATE.version, job.id).run();
      await callSite(site, "POST", `${REST_NAMESPACE}/self-update`, {
        version: SELF_UPDATE.version,
        package: await loadPackage(env),
      });
    } else {
      await callSite(site, "POST", `${REST_NAMESPACE}/updates/apply`, {
        kind: job.kind,
        slug: job.slug,
        ...(job.version ? { version: job.version } : {}),
      });
    }
    await finish("done");
  } catch (error) {
    if (job.slug === SELF_UPDATE.slug && error instanceof SiteRequestError && error.code === "kontrolwp_up_to_date") {
      // Installed by hand since the last sync; the sync below drops the row.
      await finish("done");
      return afterJob(env, siteId);
    }
    if (job.slug === SELF_UPDATE.slug && error instanceof SiteRequestError && error.status === 404) {
      // Versions before 0.4.0 have no self-update route.
      await finish(
        "failed",
        "This version of KontrolWP Connect cannot update itself. Install the new version from the sidebar once; later updates come from KontrolWP.",
      );
      return afterJob(env, siteId);
    }
    if (error instanceof SiteRequestError && error.status === 503 && job.attempts < MAX_ATTEMPTS) {
      await finish("queued", "The site is busy. Trying again shortly.");
      return { next: "retry", delaySeconds: BUSY_RETRY_SECONDS };
    }
    if (!(error instanceof SiteRequestError || error instanceof SecretsKeyError)) {
      await finish("queued");
      throw error;
    }
    await finish("failed", error.message);
  }
  return afterJob(env, siteId);
}

/** Hand on the site's next queued update, or sync once the queue is empty. */
async function afterJob(env: Env, siteId: number): Promise<UpdateStep> {
  const more = await env.DB
    .prepare("SELECT 1 FROM update_jobs WHERE site_id = ? AND status = 'queued' LIMIT 1")
    .bind(siteId)
    .first();
  if (more) return { next: "continue" };
  // The queue is empty: re-read versions and the remaining updates. A site is
  // often still restarting or in maintenance just after an update, and a failed
  // sync leaves the finished updates listed, so it is tried again shortly.
  const synced = await syncSite(env, siteId);
  return synced.ok ? { next: "idle" } : { next: "resync", delaySeconds: RESYNC_SECONDS };
}

/**
 * One of those later syncs. Returns when to try again, or null once the sync
 * worked or the tries are used up (the site's error then stays on its page).
 */
export async function runResync(env: Env, siteId: number, attempt: number): Promise<number | null> {
  const synced = await syncSite(env, siteId);
  return synced.ok || attempt >= MAX_RESYNCS ? null : RESYNC_SECONDS * attempt;
}

