import {
  UPDATE_FREQUENCIES,
  type GlobalUpdatePolicy,
  type GlobalUpdatePolicyView,
  type SiteUpdatePolicy,
  type SiteUpdatePolicyView,
  type UpdateKind,
  type UpdateRun,
  type UpdateSchedule,
} from "../../shared/types.ts";
import { loadLinkScanSettings, localTime, midnight } from "./link-schedule.ts";
import { enqueueUpdate } from "./updates.ts";

/**
 * Scheduled updates. A global policy says which updates (WordPress, plugins,
 * themes) run on which day and hour, in the time zone chosen under Link checks;
 * a site can follow it, use its own schedule, or run none. Plugins can be left
 * out globally and per site. The 15-minute cron starts each due site once per
 * due day by queueing its waiting updates, which then run one at a time like any
 * other update (updates.ts).
 */

export const DEFAULT_SCHEDULE: UpdateSchedule = {
  core: false,
  plugins: true,
  themes: true,
  frequency: "weekly",
  weekday: 0,
  day: 1,
  hour: 3,
};

const DAY = 86400;
/** Seconds between the starts of two sites' runs. */
const SITE_SPACING = 120;
/** Cloudflare Queues delay a message by at most 12 hours. */
const MAX_QUEUE_DELAY = 12 * 3600;
const LOG_DAYS = 90;

const int = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;

/** A schedule from stored or submitted JSON, with anything invalid replaced by the default. */
export function cleanSchedule(value: unknown): UpdateSchedule {
  const v = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof UpdateSchedule, unknown>>;
  return {
    core: typeof v.core === "boolean" ? v.core : DEFAULT_SCHEDULE.core,
    plugins: typeof v.plugins === "boolean" ? v.plugins : DEFAULT_SCHEDULE.plugins,
    themes: typeof v.themes === "boolean" ? v.themes : DEFAULT_SCHEDULE.themes,
    frequency: UPDATE_FREQUENCIES.find((f) => f === v.frequency) ?? DEFAULT_SCHEDULE.frequency,
    weekday: int(v.weekday, 0, 6, DEFAULT_SCHEDULE.weekday),
    day: int(v.day, 1, 28, DEFAULT_SCHEDULE.day),
    hour: int(v.hour, 0, 23, DEFAULT_SCHEDULE.hour),
  };
}

export function cleanExcluded(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 300))].slice(
    0,
    500,
  );
}

function parse(raw: string | null | undefined): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function loadGlobalPolicy(env: Env): Promise<GlobalUpdatePolicy> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = 'update_policy'").first<{
    value: string;
  }>();
  const value = parse(row?.value) as { enabled?: unknown; excluded_plugins?: unknown } | null;
  return {
    ...cleanSchedule(value),
    enabled: value?.enabled === true,
    excluded_plugins: cleanExcluded(value?.excluded_plugins),
  };
}

export async function saveGlobalPolicy(env: Env, policy: GlobalUpdatePolicy): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES ('update_policy', ?)")
    .bind(JSON.stringify(policy))
    .run();
}

export function sitePolicyFrom(raw: string | null | undefined): SiteUpdatePolicy {
  const value = parse(raw) as { mode?: unknown; schedule?: unknown; excluded_plugins?: unknown } | null;
  return {
    mode: value?.mode === "custom" || value?.mode === "off" ? value.mode : "inherit",
    schedule: cleanSchedule(value?.schedule),
    excluded_plugins: cleanExcluded(value?.excluded_plugins),
  };
}

export async function saveSitePolicy(env: Env, siteId: number, policy: SiteUpdatePolicy): Promise<void> {
  // A site that follows the global policy and leaves nothing out stores nothing.
  const plain = policy.mode === "inherit" && !policy.excluded_plugins.length;
  await env.DB.prepare("UPDATE sites SET update_policy = ? WHERE id = ?")
    .bind(plain ? null : JSON.stringify(policy), siteId)
    .run();
}

/** The schedule that applies to a site, and where it comes from; null when it has none. */
export function effectiveSchedule(
  global: GlobalUpdatePolicy,
  site: SiteUpdatePolicy,
): { schedule: UpdateSchedule | null; source: "off" | "global" | "custom" } {
  if (site.mode === "off") return { schedule: null, source: "off" };
  if (site.mode === "custom") return { schedule: site.schedule, source: "custom" };
  return global.enabled ? { schedule: global, source: "global" } : { schedule: null, source: "off" };
}

/** Whether the schedule runs on this local date. */
function runsOn(schedule: UpdateSchedule, date: string): boolean {
  if (schedule.frequency === "daily") return true;
  if (schedule.frequency === "weekly") return new Date(`${date}T00:00:00Z`).getUTCDay() === schedule.weekday;
  return Number(date.slice(8, 10)) === schedule.day;
}

/** Due once the scheduled hour has come on a day it runs, until it has run that day. */
export function isDue(schedule: UpdateSchedule, zone: string | null, now: number, lastRun: string | null): boolean {
  const { date, hour } = localTime(now, zone);
  return runsOn(schedule, date) && hour >= schedule.hour && lastRun !== date;
}

/** When the next run starts: now when it is due, else the next scheduled hour. */
export function nextRunAt(schedule: UpdateSchedule, zone: string | null, now: number, lastRun: string | null): number {
  const today = localTime(now, zone).date;
  for (let i = 0; i < 62; i++) {
    const date = new Date(Date.parse(`${today}T00:00:00Z`) + i * DAY * 1000).toISOString().slice(0, 10);
    if (!runsOn(schedule, date)) continue;
    if (i === 0 && lastRun === today) continue;
    const at = midnight(date, zone) + schedule.hour * 3600;
    return Math.max(at, now);
  }
  return now;
}

interface SiteRow {
  id: number;
  name: string;
  update_policy: string | null;
  scheduled_update_run: string | null;
}

/**
 * Called by the cron trigger: starts the sites whose scheduled update is due.
 * Their waiting updates (plugins and themes first, WordPress last) are queued
 * except excluded plugins, and the sites start a couple of minutes apart.
 * Returns how many sites were started.
 */
export async function runScheduledUpdates(env: Env, now = Math.floor(Date.now() / 1000)): Promise<number> {
  const zone = (await loadLinkScanSettings(env)).time_zone;
  const global = await loadGlobalPolicy(env);
  const { date } = localTime(now, zone);
  const { results } = await env.DB.prepare(
    `SELECT id, name, update_policy, scheduled_update_run FROM sites
     WHERE kind = 'wordpress' AND updates_excluded = 0 AND plugin_version IS NOT NULL AND status != 'error'
     ORDER BY id`,
  ).all<SiteRow>();

  const due: { row: SiteRow; schedule: UpdateSchedule; excluded: Set<string> }[] = [];
  for (const row of results) {
    const policy = sitePolicyFrom(row.update_policy);
    const { schedule } = effectiveSchedule(global, policy);
    if (!schedule || !isDue(schedule, zone, now, row.scheduled_update_run)) continue;
    // Claim the day first, so two overlapping cron runs never both start the site.
    const claim = await env.DB.prepare(
      "UPDATE sites SET scheduled_update_run = ? WHERE id = ? AND COALESCE(scheduled_update_run, '') != ?",
    )
      .bind(date, row.id, date)
      .run();
    if (!claim.meta.changes) continue;
    due.push({ row, schedule, excluded: new Set([...global.excluded_plugins, ...policy.excluded_plugins]) });
  }

  const spacing = Math.min(SITE_SPACING, Math.floor(MAX_QUEUE_DELAY / Math.max(1, due.length)));
  for (const [index, { row, schedule, excluded }] of due.entries()) {
    // A version the owner reverted away from is left for them to install by hand.
    const { results: waiting } = await env.DB.prepare(
      `SELECT u.kind, u.slug, u.name, u.new_version FROM site_updates u
       WHERE u.site_id = ? AND NOT EXISTS (
         SELECT 1 FROM update_holds h WHERE h.site_id = u.site_id AND h.kind = u.kind AND h.slug = u.slug
           AND h.version = u.new_version)`,
    )
      .bind(row.id)
      .all<{ kind: UpdateKind; slug: string; name: string; new_version: string }>();
    const wanted = (kind: UpdateKind) =>
      kind === "core" ? schedule.core : kind === "plugin" ? schedule.plugins : schedule.themes;
    const order: Record<UpdateKind, number> = { plugin: 0, theme: 1, core: 2 };
    const candidates = waiting.filter((u) => wanted(u.kind)).sort((a, b) => order[a.kind] - order[b.kind]);
    const items: UpdateRun["items"] = [];
    let skipped = 0;
    for (const update of candidates) {
      if (update.kind === "plugin" && excluded.has(update.slug)) {
        skipped++;
        continue;
      }
      await enqueueUpdate(
        env,
        row.id,
        { kind: update.kind, slug: update.slug, ...(update.kind === "core" ? { version: update.new_version } : {}) },
        false,
      );
      items.push({ kind: update.kind, name: update.name, version: update.new_version });
    }
    if (items.length || skipped) {
      await env.DB.prepare("INSERT INTO update_runs (site_id, ran_at, queued, skipped, items) VALUES (?, ?, ?, ?, ?)")
        .bind(row.id, now, items.length, skipped, JSON.stringify(items))
        .run();
    }
    if (items.length) {
      await env.SYNC_QUEUE.send({ type: "update", siteId: row.id }, { delaySeconds: index * spacing });
    }
  }
  await env.DB.prepare("DELETE FROM update_runs WHERE ran_at < ?")
    .bind(now - LOG_DAYS * DAY)
    .run();
  return due.length;
}

async function listRuns(env: Env, siteId: number | null, limit: number): Promise<UpdateRun[]> {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.site_id, s.name AS site_name, r.ran_at, r.queued, r.skipped, r.items
     FROM update_runs r JOIN sites s ON s.id = r.site_id
     ${siteId === null ? "" : "WHERE r.site_id = ?"} ORDER BY r.ran_at DESC, r.id DESC LIMIT ?`,
  )
    .bind(...(siteId === null ? [limit] : [siteId, limit]))
    .all<Omit<UpdateRun, "items"> & { items: string }>();
  return results.map((run) => ({ ...run, items: (parse(run.items) as UpdateRun["items"] | null) ?? [] }));
}

export async function globalPolicyView(env: Env, now = Math.floor(Date.now() / 1000)): Promise<GlobalUpdatePolicyView> {
  const zone = (await loadLinkScanSettings(env)).time_zone;
  const policy = await loadGlobalPolicy(env);
  return {
    policy,
    time_zone: zone ?? "UTC",
    next_run_at: policy.enabled ? nextRunAt(policy, zone, now, null) : null,
    runs: await listRuns(env, null, 10),
  };
}

export async function sitePolicyView(
  env: Env,
  siteId: number,
  now = Math.floor(Date.now() / 1000),
): Promise<SiteUpdatePolicyView | null> {
  const row = await env.DB.prepare("SELECT update_policy, scheduled_update_run FROM sites WHERE id = ?")
    .bind(siteId)
    .first<{ update_policy: string | null; scheduled_update_run: string | null }>();
  if (!row) return null;
  const zone = (await loadLinkScanSettings(env)).time_zone;
  const global = await loadGlobalPolicy(env);
  const policy = sitePolicyFrom(row.update_policy);
  const { schedule, source } = effectiveSchedule(global, policy);
  return {
    policy,
    global,
    time_zone: zone ?? "UTC",
    effective: source,
    next_run_at: schedule ? nextRunAt(schedule, zone, now, row.scheduled_update_run) : null,
    runs: await listRuns(env, siteId, 5),
  };
}
