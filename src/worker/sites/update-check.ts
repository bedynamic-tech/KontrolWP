import { SELF_UPDATE } from "./kontrolwp-connect.ts";
import { enqueueRollback, RollbackError } from "./updates.ts";

/**
 * Regression check for scheduled updates. Before a site's scheduled updates
 * run, Cloudflare Browser Rendering loads its home page once; after they
 * finish it loads it again. When the page stopped loading, shows WordPress's
 * critical error, answers with a new HTTP error or looks very different, the
 * updated plugins and themes are reverted through the Update Queue (which also
 * holds those versions back from the next scheduled run). The result is noted
 * on the scheduled run. Updates queued by hand are not checked.
 */

/** Screenshots are compared in squares of this many pixels... */
export const BLOCK = 10;
/** ...and a square counts as changed when its average colour moved more than this (sum of the RGB differences). */
export const TOLERANCE = 48;
/** More of the page than this looking different counts as broken. */
export const THRESHOLD = 0.3;
/** The site may still be finishing its update (WordPress's maintenance mode) right after it. */
const AFTER_DELAY_SECONDS = 20;
/** Added to the address so page caches serve what WordPress renders now. */
const CACHE_BUSTER = "kontrolwp_check";

export class UpdateCheckError extends Error {}

/** A screenshot shrunk to one RGBA pixel per block. */
export interface Grid {
  cols: number;
  rows: number;
  pixels: Uint8Array;
}

export interface Look {
  /** The HTTP status; null when the page did not load. */
  status: number | null;
  /** WordPress showed its "critical error" page. */
  critical: boolean;
  grid: Grid | null;
  /** Why the page did not load, as the end of a sentence. */
  error: string | null;
}

export interface Looker {
  /** Throws UpdateCheckError when no browser can be had. */
  look(env: Env, url: string): Promise<Look>;
}

type CheckResult = "passed" | "reverted" | "broken" | "skipped";

const now = () => Math.floor(Date.now() / 1000);

/* ---- Judging (pure, tested) ---- */

/** The share of blocks that differ. A block only one of them has (the page got longer or shorter) counts as changed. */
export function changedShare(a: Grid, b: Grid, tolerance = TOLERANCE): number {
  const cols = Math.max(a.cols, b.cols);
  const rows = Math.max(a.rows, b.rows);
  if (!cols || !rows) return 0;
  let changed = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (row >= a.rows || row >= b.rows || col >= a.cols || col >= b.cols) {
        changed++;
        continue;
      }
      const i = (row * a.cols + col) * 4;
      const j = (row * b.cols + col) * 4;
      const delta =
        Math.abs(a.pixels[i] - b.pixels[j]) + Math.abs(a.pixels[i + 1] - b.pixels[j + 1]) + Math.abs(a.pixels[i + 2] - b.pixels[j + 2]);
      if (delta > tolerance) changed++;
    }
  }
  return changed / (cols * rows);
}

/** Why the home page counts as broken after the updates, or null when it looks fine. */
export function regression(before: { status: number | null; grid: Grid | null }, after: Look): string | null {
  if (after.error) return `the home page ${after.error} after the updates`;
  if (after.critical) return "the home page showed WordPress's critical error after the updates";
  if (after.status !== null && (after.status >= 500 || (after.status >= 400 && (before.status ?? 0) < 400))) {
    return `the home page answered HTTP ${after.status} after the updates`;
  }
  if (before.grid && after.grid) {
    const share = changedShare(before.grid, after.grid);
    if (share >= THRESHOLD) return `${Math.round(share * 100)}% of the home page looked different after the updates`;
  }
  return null;
}

export function homeUrl(siteUrl: string, time: number): string {
  const url = new URL(siteUrl);
  url.searchParams.set(CACHE_BUSTER, String(time));
  return url.toString();
}

/* ---- Running it ---- */

async function defaultLooker(): Promise<Looker> {
  return (await import("./update-check-browser.ts")).browserLooker;
}

async function note(env: Env, runId: number, result: CheckResult, text: string | null) {
  await env.DB.prepare("UPDATE update_runs SET check_result = ?, check_note = ? WHERE id = ?").bind(result, text, runId).run();
}

/**
 * The scheduled run's first step: look at the home page, then start the
 * updates whatever happened. A page that is already broken, or a browser that
 * cannot start, means no check for this run.
 */
export async function checkBeforeUpdates(
  env: Env,
  siteId: number,
  runId: number,
  looker?: Looker,
  time = now(),
): Promise<void> {
  try {
    const site = await env.DB.prepare("SELECT url FROM sites WHERE id = ?").bind(siteId).first<{ url: string }>();
    if (!site) return;
    try {
      const look = await (looker ?? (await defaultLooker())).look(env, homeUrl(site.url, time));
      if (look.error || look.critical || look.status === null || look.status >= 400 || !look.grid) {
        await note(env, runId, "skipped", "Not checked: the home page was not working before the updates.");
        return;
      }
      await env.DB.prepare(
        `INSERT OR REPLACE INTO update_checks (site_id, run_id, status, started_at, before_status, grid_cols, grid_rows, grid)
         VALUES (?, ?, 'waiting', ?, ?, ?, ?, ?)`,
      )
        .bind(siteId, runId, time, look.status, look.grid.cols, look.grid.rows, look.grid.pixels)
        .run();
    } catch (error) {
      if (!(error instanceof UpdateCheckError)) console.error("update check before", siteId, error);
      await note(env, runId, "skipped", `Not checked: ${error instanceof UpdateCheckError ? error.message : "the check failed."}`);
    }
  } finally {
    await env.SYNC_QUEUE.send({ type: "update", siteId });
  }
}

/** Once a site's Update Queue is empty: look again shortly, if a scheduled run is waiting for it. */
export async function afterUpdates(env: Env, siteId: number): Promise<void> {
  const waiting = await env.DB.prepare("SELECT run_id FROM update_checks WHERE site_id = ? AND status = 'waiting'")
    .bind(siteId)
    .first<{ run_id: number }>();
  if (waiting) {
    await env.SYNC_QUEUE.send(
      { type: "update-check", siteId, runId: waiting.run_id, phase: "after" },
      { delaySeconds: AFTER_DELAY_SECONDS },
    );
  }
}

/** Look at the home page again and revert the run's plugin and theme updates when it broke. */
export async function checkAfterUpdates(env: Env, siteId: number, looker?: Looker, time = now()): Promise<void> {
  const check = await env.DB.prepare(
    `UPDATE update_checks SET status = 'running' WHERE site_id = ? AND status = 'waiting'
     RETURNING run_id, started_at, before_status, grid_cols, grid_rows, grid`,
  )
    .bind(siteId)
    .first<{
      run_id: number;
      started_at: number;
      before_status: number;
      grid_cols: number;
      grid_rows: number;
      grid: ArrayLike<number> | ArrayBuffer;
    }>();
  if (!check) return;
  const done = () => env.DB.prepare("DELETE FROM update_checks WHERE site_id = ?").bind(siteId).run();
  try {
    const site = await env.DB.prepare("SELECT url FROM sites WHERE id = ?").bind(siteId).first<{ url: string }>();
    if (!site) return;
    let after: Look;
    try {
      after = await (looker ?? (await defaultLooker())).look(env, homeUrl(site.url, time));
    } catch (error) {
      if (!(error instanceof UpdateCheckError)) throw error;
      await note(env, check.run_id, "skipped", `Not checked after the updates: ${error.message}`);
      return;
    }
    // D1 returns a BLOB as an array of bytes.
    const before = {
      status: check.before_status,
      grid: { cols: check.grid_cols, rows: check.grid_rows, pixels: new Uint8Array(check.grid as ArrayLike<number>) },
    };
    const broken = regression(before, after);
    if (!broken) {
      await note(env, check.run_id, "passed", "The home page looked the same after the updates.");
      return;
    }

    // The plugins and themes this run updated (core cannot be reverted).
    const { results: updated } = await env.DB.prepare(
      `SELECT j.kind, j.slug, COALESCE(r.name, j.slug) AS name FROM update_jobs j
       LEFT JOIN site_rollbacks r ON r.site_id = j.site_id AND r.kind = j.kind AND r.slug = j.slug
       WHERE j.site_id = ? AND j.action = 'update' AND j.status = 'done' AND j.kind IN ('plugin', 'theme')
         AND j.slug != ? AND j.started_at >= ?
       ORDER BY j.started_at, j.id`,
    )
      .bind(siteId, SELF_UPDATE.slug, check.started_at)
      .all<{ kind: "plugin" | "theme"; slug: string; name: string }>();
    const reverted: string[] = [];
    const kept: string[] = [];
    for (const item of updated) {
      try {
        await enqueueRollback(env, siteId, { kind: item.kind, slug: item.slug });
        reverted.push(item.name);
      } catch (error) {
        if (!(error instanceof RollbackError)) throw error;
        kept.push(item.name);
      }
    }
    const reason = broken.charAt(0).toUpperCase() + broken.slice(1);
    if (reverted.length) {
      await note(
        env,
        check.run_id,
        "reverted",
        `${reason}, so KontrolWP reverted ${reverted.join(", ")}.` +
          (kept.length ? ` No previous version of ${kept.join(", ")} was kept to revert to.` : ""),
      );
    } else {
      await note(env, check.run_id, "broken", `${reason}, and there was nothing KontrolWP could revert.`);
    }
  } catch (error) {
    console.error("update check after", siteId, error);
    await note(env, check.run_id, "skipped", "Not checked after the updates: the check failed.").catch(() => undefined);
  } finally {
    await done();
  }
}
