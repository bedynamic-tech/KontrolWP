import type { SiteUptime, SslCertificate, UptimeCheck, UptimeDay, UptimeIncident } from "../../shared/types.ts";
import { checkCertificate, type OpenSocket } from "./certificate.ts";

/**
 * Uptime monitoring for every site, WordPress or static: the cron queues the
 * sites due a check every 15 minutes, a queue message loads a few home pages
 * and records how each answered, and once a day it reads each site's TLS
 * certificate. Results stay for 30 days.
 */

const MINUTE = 60;
const DAY = 86400;
export const CHECK_INTERVAL = 15 * MINUTE;
const HISTORY = 30 * DAY;
const CERTIFICATE_INTERVAL = DAY;
/** Sites one queue message checks, which keeps it well inside a Worker's subrequest limit. */
export const SITES_PER_MESSAGE = 10;
const TIMEOUT_MS = 15_000;
/** Wait before the second try at a site that failed, so a single dropped request is not an outage. */
const RETRY_DELAY_MS = 5000;

export interface UptimeDeps {
  fetcher?: typeof fetch;
  open?: OpenSocket;
  retryDelayMs?: number;
}

/** Load the home page once and say how it answered. Never throws. */
export async function probe(url: string, fetcher: typeof fetch = fetch): Promise<Omit<UptimeCheck, "checked_at">> {
  const started = Date.now();
  try {
    const response = await fetcher(url, {
      headers: { Accept: "text/html", "User-Agent": "KontrolWP uptime monitor" },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const response_ms = Math.max(0, Date.now() - started);
    // Only the answer matters; skip downloading the page.
    await response.body?.cancel().catch(() => {});
    return {
      up: response.ok,
      status_code: response.status,
      response_ms,
      error: response.ok ? null : `The site answered HTTP ${response.status}`,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      up: false,
      status_code: null,
      response_ms: null,
      error: timedOut ? `The site did not answer within ${TIMEOUT_MS / 1000} seconds` : "Could not reach the site",
    };
  }
}

interface SiteRow {
  id: number;
  url: string;
  uptime_up: number | null;
  uptime_since: number | null;
  uptime_checked_at: number | null;
}

/**
 * Check one site and store the answer. A failed load is tried once more
 * before it counts as down. The certificate is read when the last reading is
 * a day old, the site's host changed, or `refreshCertificate` asks for it.
 */
export async function checkSite(
  env: Env,
  siteId: number,
  now = Math.floor(Date.now() / 1000),
  deps: UptimeDeps & { refreshCertificate?: boolean } = {},
): Promise<void> {
  const site = await env.DB.prepare("SELECT id, url, uptime_up, uptime_since, uptime_checked_at FROM sites WHERE id = ?")
    .bind(siteId)
    .first<SiteRow>();
  if (!site) return;

  const certificate = readCertificateIfDue(env, site, now, deps).catch((error: unknown) => console.error("certificate", error));
  let result = await probe(site.url, deps.fetcher);
  if (!result.up) {
    await new Promise((resolve) => setTimeout(resolve, deps.retryDelayMs ?? RETRY_DELAY_MS));
    const again = await probe(site.url, deps.fetcher);
    if (again.up) result = again;
  }
  const up = result.up ? 1 : 0;
  const since = site.uptime_up === up && site.uptime_since ? site.uptime_since : now;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR REPLACE INTO uptime_checks (site_id, checked_at, up, status_code, response_ms, error)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(site.id, now, up, result.status_code, result.response_ms, result.error),
    env.DB.prepare("UPDATE sites SET uptime_up = ?, uptime_since = ?, uptime_checked_at = ? WHERE id = ?").bind(
      up,
      since,
      now,
      site.id,
    ),
    env.DB.prepare("DELETE FROM uptime_checks WHERE site_id = ? AND checked_at < ?").bind(site.id, now - HISTORY),
  ]);
  await certificate;
}

async function readCertificateIfDue(
  env: Env,
  site: SiteRow,
  now: number,
  deps: UptimeDeps & { refreshCertificate?: boolean },
): Promise<void> {
  let host: string;
  try {
    const url = new URL(site.url);
    if (url.protocol !== "https:") return;
    host = url.hostname;
  } catch {
    return;
  }
  if (!deps.refreshCertificate) {
    const stored = await env.DB.prepare("SELECT host, checked_at FROM ssl_certificates WHERE site_id = ?")
      .bind(site.id)
      .first<{ host: string; checked_at: number }>();
    if (stored && stored.host === host && stored.checked_at > now - CERTIFICATE_INTERVAL) return;
  }
  const cert = await checkCertificate(host, now, { open: deps.open, fetcher: deps.fetcher });
  await env.DB.prepare(
    `INSERT OR REPLACE INTO ssl_certificates
       (site_id, host, checked_at, source, subject, issuer, valid_from, expires_at, names, covers_host, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      site.id,
      cert.host,
      cert.checked_at,
      cert.source,
      cert.subject,
      cert.issuer,
      cert.valid_from,
      cert.expires_at,
      JSON.stringify(cert.names),
      cert.covers_host === null ? null : cert.covers_host ? 1 : 0,
      cert.error,
    )
    .run();
}

/** Queue the sites due a check, a few to a message. Returns how many were queued. */
export async function runScheduledUptime(env: Env, now = Math.floor(Date.now() / 1000)): Promise<number> {
  // A minute of slack, so a cron that fires a little early still checks every site each time.
  const { results } = await env.DB.prepare(
    `SELECT id FROM sites
     WHERE uptime_excluded = 0 AND (uptime_checked_at IS NULL OR uptime_checked_at <= ?)
     ORDER BY uptime_checked_at IS NOT NULL, uptime_checked_at`,
  )
    .bind(now - CHECK_INTERVAL + MINUTE)
    .all<{ id: number }>();
  const ids = results.map((row) => row.id);
  const messages: { body: SyncMessage }[] = [];
  for (let i = 0; i < ids.length; i += SITES_PER_MESSAGE) {
    messages.push({ body: { type: "uptime", siteIds: ids.slice(i, i + SITES_PER_MESSAGE) } });
  }
  // sendBatch takes up to 100 messages.
  for (let i = 0; i < messages.length; i += 100) await env.SYNC_QUEUE.sendBatch(messages.slice(i, i + 100));
  return ids.length;
}

/** Check each queued site in turn, skipping one already checked since it was queued. */
export async function runUptimeMessage(
  env: Env,
  siteIds: number[],
  now = () => Math.floor(Date.now() / 1000),
  deps: UptimeDeps = {},
): Promise<void> {
  for (const id of siteIds.slice(0, SITES_PER_MESSAGE)) {
    const row = await env.DB.prepare("SELECT uptime_excluded, uptime_checked_at FROM sites WHERE id = ?")
      .bind(id)
      .first<{ uptime_excluded: number; uptime_checked_at: number | null }>();
    if (!row || row.uptime_excluded) continue;
    if (row.uptime_checked_at && row.uptime_checked_at > now() - CHECK_INTERVAL / 2) continue;
    await checkSite(env, id, now(), deps);
  }
}

/** The stored checks and certificate for one site, summarized for the Uptime tab. */
export async function siteUptime(env: Env, siteId: number, now = Math.floor(Date.now() / 1000)): Promise<SiteUptime> {
  const [checks, cert, site] = await Promise.all([
    env.DB.prepare(
      `SELECT checked_at, up, status_code, response_ms, error FROM uptime_checks
       WHERE site_id = ? AND checked_at >= ? ORDER BY checked_at`,
    )
      .bind(siteId, now - HISTORY)
      .all<Omit<UptimeCheck, "up"> & { up: number }>(),
    env.DB.prepare("SELECT * FROM ssl_certificates WHERE site_id = ?").bind(siteId).first<CertificateRow>(),
    env.DB.prepare("SELECT uptime_since FROM sites WHERE id = ?").bind(siteId).first<{ uptime_since: number | null }>(),
  ]);
  return {
    ...summarizeUptime(
      checks.results.map((row) => ({ ...row, up: Boolean(row.up) })),
      now,
    ),
    since: site?.uptime_since ?? null,
    ssl: cert ? certificateFromRow(cert) : null,
  };
}

type CertificateRow = Omit<SslCertificate, "names" | "covers_host"> & { names: string; covers_host: number | null };

function certificateFromRow(row: CertificateRow): SslCertificate {
  let names: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.names);
    if (Array.isArray(parsed)) names = parsed.filter((name): name is string => typeof name === "string");
  } catch {
    // Shown without names.
  }
  return {
    host: row.host,
    checked_at: row.checked_at,
    source: row.source,
    subject: row.subject,
    issuer: row.issuer,
    valid_from: row.valid_from,
    expires_at: row.expires_at,
    names,
    covers_host: row.covers_host === null ? null : Boolean(row.covers_host),
    error: row.error,
  };
}

const percent = (checks: UptimeCheck[]) =>
  checks.length ? Math.round((checks.filter((check) => check.up).length / checks.length) * 10000) / 100 : null;

/** Ratios, daily totals and outages from 30 days of checks (oldest first). */
export function summarizeUptime(checks: UptimeCheck[], now: number): Omit<SiteUptime, "ssl" | "since"> {
  const within = (seconds: number) => checks.filter((check) => check.checked_at > now - seconds);
  const recent = within(DAY);
  const answered = recent.filter((check) => check.up && check.response_ms !== null);

  const today = Math.floor(now / DAY) * DAY;
  const days: UptimeDay[] = [];
  for (let day = today - 29 * DAY; day <= today; day += DAY) days.push({ day, checks: 0, up: 0 });
  for (const check of checks) {
    const entry = days[Math.floor((check.checked_at - days[0].day) / DAY)];
    if (!entry) continue;
    entry.checks++;
    if (check.up) entry.up++;
  }

  const incidents: UptimeIncident[] = [];
  let open: UptimeIncident | null = null;
  for (const check of checks) {
    if (!check.up && !open) {
      open = { started_at: check.checked_at, ended_at: null, error: check.error };
      incidents.push(open);
    } else if (check.up && open) {
      open.ended_at = check.checked_at;
      open = null;
    }
  }

  return {
    latest: checks[checks.length - 1] ?? null,
    ratios: { day: percent(recent), week: percent(within(7 * DAY)), month: percent(checks) },
    average_ms: answered.length
      ? Math.round(answered.reduce((sum, check) => sum + (check.response_ms ?? 0), 0) / answered.length)
      : null,
    recent,
    days,
    incidents: incidents.reverse().slice(0, 50),
  };
}
