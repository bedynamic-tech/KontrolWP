import { compareVersions, LINK_CHECK_SINCE } from "../../shared/plugin-version.ts";
import {
  LINK_SCAN_INTERVALS,
  type LinkScanInterval,
  type LinkScanSchedule,
  type LinkScanSettings,
} from "../../shared/types.ts";
import { startLinkScan } from "./links.ts";

/**
 * Scheduled link checks: every site's links are checked at midnight in the
 * owner's time zone, every 1, 3, 5 or 7 days (Settings). The cron trigger
 * runs every 15 minutes; the first tick in the midnight hour starts them.
 */

export const DEFAULT_LINK_SCAN_INTERVAL: LinkScanInterval = 7;
const DAY = 86400;
/** Seconds between one site's scheduled check and the next. */
export const SITE_SPACING = 120;
/** Cloudflare Queues delay a message by at most 12 hours. */
const MAX_QUEUE_DELAY = 12 * 3600;

export async function loadLinkScanSettings(env: Env): Promise<LinkScanSettings> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = 'link_scan'").first<{ value: string }>();
  let value: Partial<LinkScanSettings> = {};
  try {
    value = row ? (JSON.parse(row.value) as Partial<LinkScanSettings>) : {};
  } catch {
    // Fall back to the defaults below.
  }
  return {
    interval_days: LINK_SCAN_INTERVALS.find((days) => days === value.interval_days) ?? DEFAULT_LINK_SCAN_INTERVAL,
    time_zone: typeof value.time_zone === "string" && validTimeZone(value.time_zone) ? value.time_zone : null,
  };
}

export async function saveLinkScanSettings(env: Env, settings: LinkScanSettings): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES ('link_scan', ?)")
    .bind(JSON.stringify(settings))
    .run();
}

export function validTimeZone(zone: string): boolean {
  if (!zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The date ("2026-10-01") and hour (0-23) at `now` in the zone; UTC when none is set. */
export function localTime(now: number, zone: string | null): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(now * 1000))
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 1000 / DAY);
const dateOf = (day: number) => new Date(day * DAY * 1000).toISOString().slice(0, 10);

/** Unix seconds of midnight starting `date` in the zone. */
export function midnight(date: string, zone: string | null): number {
  const utc = Date.parse(`${date}T00:00:00Z`) / 1000;
  // The zone's offset near that moment, applied twice to settle across a DST change.
  let guess = utc;
  for (let i = 0; i < 2; i++) {
    const local = localTime(guess, zone);
    const shown = Date.parse(`${local.date}T${String(local.hour).padStart(2, "0")}:00:00Z`) / 1000;
    guess = utc - (shown - Math.floor(guess / 3600) * 3600);
  }
  return guess;
}

async function lastRunDate(env: Env): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = 'link_scan_last_date'").first<{ value: string }>();
  return row?.value ?? null;
}

/** When the next scheduled check starts. */
export async function linkScanSchedule(env: Env, now = Math.floor(Date.now() / 1000)): Promise<LinkScanSchedule> {
  const settings = await loadLinkScanSettings(env);
  if (!settings.interval_days) return { ...settings, next_run_at: null };
  const today = localTime(now, settings.time_zone).date;
  const last = await lastRunDate(env);
  // Due on the date `interval` days after the last run; never earlier than tonight.
  let next = last ? dayNumber(last) + settings.interval_days : dayNumber(today) + 1;
  next = Math.max(next, dayNumber(today) + (last === today ? settings.interval_days : 1));
  return { ...settings, next_run_at: midnight(dateOf(next), settings.time_zone) };
}

/**
 * Called by the cron trigger: in the midnight hour, starts a link check on
 * every site that can run one, once the chosen number of days has passed.
 */
export async function runScheduledLinkScans(env: Env, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const settings = await loadLinkScanSettings(env);
  if (!settings.interval_days) return false;
  const { date, hour } = localTime(now, settings.time_zone);
  if (hour !== 0) return false;
  const last = await lastRunDate(env);
  if (last && dayNumber(date) - dayNumber(last) < settings.interval_days) return false;
  await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES ('link_scan_last_date', ?)").bind(date).run();

  const { results } = await env.DB.prepare(
    `SELECT s.id, s.plugin_version, l.status, l.updated_at FROM sites s
     LEFT JOIN link_scans l ON l.site_id = s.id WHERE s.links_excluded = 0`,
  ).all<{ id: number; plugin_version: string | null; status: string | null; updated_at: number | null }>();
  const due = results.filter((site) => {
    if (!site.plugin_version || compareVersions(site.plugin_version, LINK_CHECK_SINCE) < 0) return false;
    // A scan someone started by hand is still going; leave it be.
    return !((site.status === "collecting" || site.status === "checking") && now - (site.updated_at ?? 0) < 15 * 60);
  });
  // One site at a time through the queue, a couple of minutes apart, so the
  // Worker and the sites linked to never see every site's checks at once.
  const spacing = Math.min(SITE_SPACING, Math.floor(MAX_QUEUE_DELAY / Math.max(1, due.length)));
  for (const [index, site] of due.entries()) await startLinkScan(env, site.id, now, index * spacing);
  return true;
}
