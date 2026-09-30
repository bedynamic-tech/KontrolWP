import { REST_NAMESPACE } from "../../shared/protocol.ts";
import type { UpdateKind } from "../../shared/types.ts";
import { callSite, SiteRequestError } from "./client.ts";
import { SecretsKeyError } from "./secrets.ts";
import { loadPackage, SELF_UPDATE } from "./presser-connect.ts";
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

export type UpdateStep =
  | { next: "idle" }
  | { next: "continue" }
  | { next: "retry"; delaySeconds: number };

const now = () => Math.floor(Date.now() / 1000);

/** Queue an update for a site and wake the consumer. Queuing the same update again is a no-op. */
export async function enqueueUpdate(env: Env, siteId: number, update: UpdateRequest): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO update_jobs (site_id, kind, slug, version) VALUES (?, ?, ?, ?)
       ON CONFLICT (site_id, kind, slug) DO UPDATE SET
         status = 'queued', version = excluded.version, error = NULL, attempts = 0,
         created_at = unixepoch(), started_at = NULL
       WHERE update_jobs.status IN ('failed', 'done')`,
    )
    .bind(siteId, update.kind, update.slug, update.version ?? null)
    .run();
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
         error = 'Presser lost track of this update. Sync the site to see whether it finished.'
       WHERE site_id = ? AND status = 'running' AND started_at < ?`,
    )
    .bind(siteId, time - STALE_AFTER_SECONDS)
    .run();

  const job = await env.DB
    .prepare(
      `UPDATE update_jobs SET status = 'running', started_at = ?, attempts = attempts + 1
       WHERE id = (SELECT id FROM update_jobs WHERE site_id = ? AND status = 'queued' ORDER BY created_at, id LIMIT 1)
         AND NOT EXISTS (SELECT 1 FROM update_jobs WHERE site_id = ? AND status = 'running')
       RETURNING id, kind, slug, version, attempts`,
    )
    .bind(time, siteId, siteId)
    .first<{ id: number; kind: UpdateKind; slug: string; version: string | null; attempts: number }>();
  // Nothing queued, or another consumer is running this site's update and
  // will pick up the rest when it finishes.
  if (!job) return { next: "idle" };

  const finish = (status: "queued" | "done" | "failed", error: string | null = null) =>
    env.DB.prepare("UPDATE update_jobs SET status = ?, error = ? WHERE id = ?").bind(status, error, job.id).run();

  try {
    const site = await getCredentials(env, siteId);
    if (!site) return { next: "idle" };
    if (job.kind === "plugin" && job.slug === SELF_UPDATE.slug) {
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
    if (job.slug === SELF_UPDATE.slug && error instanceof SiteRequestError && error.code === "presser_up_to_date") {
      // Installed by hand since the last sync; the sync below drops the row.
      await finish("done");
      return afterJob(env, siteId);
    }
    if (job.slug === SELF_UPDATE.slug && error instanceof SiteRequestError && error.status === 404) {
      // Versions before 0.4.0 have no self-update route.
      await finish(
        "failed",
        "This version of Presser Connect cannot update itself. Install the new version from the sidebar once; later updates come from Presser.",
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
  // The queue is empty: re-read versions and the remaining updates once.
  await syncSite(env, siteId);
  return { next: "idle" };
}

