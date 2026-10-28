import {
  ACCESSIBILITY_FIXES,
  ACCESSIBILITY_RULES,
  MAX_SCANNED_PAGES,
  accessibilityScore,
  fixesFor,
} from "../../shared/accessibility.ts";
import { REST_NAMESPACE } from "../../shared/protocol.ts";
import { ACCESSIBILITY_SINCE, compareVersions } from "../../shared/plugin-version.ts";
import type {
  AccessibilityFixDefaults,
  AccessibilityIssue,
  AccessibilityScan,
  SiteAccessibility,
  SiteSummary,
} from "../../shared/types.ts";
import { cachedRead } from "../content-cache.ts";
import { analyzePage, type Finding } from "./accessibility-check.ts";
import { callSite, SiteRequestError, type SiteCredentials } from "./client.ts";
import { readSitemap, sample } from "./sitemap.ts";
import { getCredentials } from "./store.ts";

/**
 * The home page and up to 49 others, sampled across the sitemap (or the pages
 * the home page links to), so a theme-wide problem shows up and a one-off does
 * not dominate.
 */
const MAX_PAGES = MAX_SCANNED_PAGES;
/**
 * Pages read per queue message. Each Worker run on the free plan may make 50
 * outside requests and use a few milliseconds of CPU, so a scan reads a few
 * pages, saves what it found and hands the rest to the next message.
 */
export const PAGES_PER_STEP = 5;
const DAY = 86400;
/** Manual scans can follow each other, but not on top of each other. */
const MIN_GAP = 30;
/** A scan still running after this long lost its queue message, and a new one may start. */
const STALE_AFTER = 3600;
const HISTORY_LIMIT = 90;
/** One site per cron run, so scans never pile up on small hosts or overlap a sync. */
const SCANS_PER_RUN = 1;
/** A pause between a site's pages: each one runs its whole theme and queries its database. */
const PAGE_PAUSE_MS = 1500;
const MAX_HTML = 1024 * 1024;

export class AccessibilityError extends Error {}

interface StoredResult {
  pages: string[];
  issues: Omit<AccessibilityIssue, "fix">[];
}

/** Findings so far, one entry per rule, kept small enough to save between queue messages. */
type Tally = Record<string, { count: number; pages: string[]; examples: string[] }>;

/** A scan in progress: the pages still to read, and what the pages read so far showed. */
interface Progress {
  run: string;
  started_at: number;
  queue: string[];
  pages: string[];
  tally: Tally;
}

type Page = { url: string; html: string };

/** A page, null when it is not HTML, and "overloaded" when the site answers with a server error. */
async function fetchPage(url: string): Promise<Page | null | "overloaded"> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "KontrolWP Accessibility Check" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status >= 500) return "overloaded";
    if (!response.ok || !(response.headers.get("Content-Type") ?? "").includes("html")) return null;
    return { url: response.url || url, html: (await response.text()).slice(0, MAX_HTML) };
  } catch {
    return null;
  }
}

const SKIPPED_PATH =
  /\.(?:pdf|jpe?g|png|gif|webp|svg|zip|xml|json|css|js|mp[34]|docx?|xlsx?)$|^\/(?:wp-|feed|xmlrpc|cart|checkout|my-account)/i;

/** Pages on the same site that the home page links to, in the order it lists them. */
export function linkedPages(html: string, home: string, limit = MAX_PAGES - 1): string[] {
  const base = new URL(home);
  const seen = new Set<string>([new URL("/", base).href, base.href]);
  const pages: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    let url: URL;
    try {
      url = new URL((match[1] ?? match[2] ?? "").replace(/&amp;/g, "&"), base);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.hostname !== base.hostname || url.search || SKIPPED_PATH.test(url.pathname))
      continue;
    url.hash = "";
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    pages.push(url.href);
    if (pages.length >= limit) break;
  }
  return pages;
}

const bareHost = (url: URL) => url.hostname.replace(/^www\./i, "").toLowerCase();

/**
 * The pages to scan after the home page: a sample spread across the sitemap,
 * topped up with the pages the home page links to when the sitemap is short
 * or missing.
 */
export function pagesToScan(sitemap: string[], html: string, home: string, limit = MAX_PAGES - 1): string[] {
  const base = new URL(home);
  const seen = new Set<string>([new URL("/", base).href, base.href]);
  const listed: string[] = [];
  for (const entry of sitemap) {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || bareHost(url) !== bareHost(base) || url.search) continue;
    if (SKIPPED_PATH.test(url.pathname)) continue;
    url.hash = "";
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    listed.push(url.href);
  }
  const pages = sample(listed, limit);
  for (const url of linkedPages(html, home, limit)) {
    if (pages.length >= limit) break;
    if (!seen.has(url)) {
      seen.add(url);
      pages.push(url);
    }
  }
  return pages;
}

/** Add one page's findings to the tally. */
function addPage(tally: Tally, url: string, findings: Finding[]) {
  for (const finding of findings) {
    if (!ACCESSIBILITY_RULES[finding.rule]) continue;
    const entry = (tally[finding.rule] ??= { count: 0, pages: [], examples: [] });
    entry.count++;
    if (!entry.pages.includes(url)) entry.pages.push(url);
    if (entry.examples.length < 3 && !entry.examples.includes(finding.example)) entry.examples.push(finding.example);
  }
}

/** One entry per kind of problem, most serious and most frequent first. */
function result(pages: string[], tally: Tally): StoredResult {
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const issues = Object.entries(tally)
    .map(([rule, entry]) => {
      const meta = ACCESSIBILITY_RULES[rule];
      return {
        rule,
        title: meta.title,
        impact: meta.impact,
        wcag: meta.wcag,
        help: meta.help,
        count: entry.count,
        pages: entry.pages,
        examples: entry.examples,
      };
    })
    .sort((a, b) => order[a.impact] - order[b.impact] || b.count - a.count);
  return { pages, issues };
}

/** Add up the findings of every page into one entry per kind of problem. */
export function summarize(perPage: { url: string; findings: Finding[] }[]): StoredResult {
  const tally: Tally = {};
  for (const { url, findings } of perPage) addPage(tally, url, findings);
  return result(
    perPage.map((page) => page.url),
    tally,
  );
}

/**
 * Start a scan of a site: read its home page and sitemap, choose the pages
 * to scan, and queue the first few. Throws AccessibilityError when the home
 * page cannot be read, leaving the last result in place.
 */
export async function scanSite(env: Env, siteId: number, siteUrl: string, now = Math.floor(Date.now() / 1000)) {
  await env.DB.prepare(
    `INSERT INTO accessibility_scans (site_id, attempted_at) VALUES (?, ?)
     ON CONFLICT(site_id) DO UPDATE SET attempted_at = excluded.attempted_at, progress = NULL`,
  )
    .bind(siteId, now)
    .run();
  const home = await fetchPage(siteUrl);
  if (!home || home === "overloaded") {
    const error =
      home === "overloaded"
        ? "The site answered with a server error, so the scan stopped. It will be tried again tomorrow."
        : "The site's home page could not be read.";
    await env.DB.prepare("UPDATE accessibility_scans SET error = ? WHERE site_id = ?").bind(error, siteId).run();
    throw new AccessibilityError(error);
  }
  const sitemap = await readSitemap(home.url);
  const progress: Progress = {
    run: crypto.randomUUID(),
    started_at: now,
    queue: pagesToScan(
      sitemap.items.map((item) => item.url),
      home.html,
      home.url,
    ),
    pages: [home.url],
    tally: {},
  };
  addPage(progress.tally, home.url, analyzePage(home.html));
  if (!progress.queue.length) return finish(env, siteId, progress, now);
  await env.DB.prepare("UPDATE accessibility_scans SET progress = ? WHERE site_id = ?")
    .bind(JSON.stringify(progress), siteId)
    .run();
  await env.SYNC_QUEUE.send({ type: "accessibility", siteId, run: progress.run });
}

/**
 * Read the next few pages of a running scan, from the queue. Queues the
 * rest, or saves the result once every page is read or the site starts to
 * struggle. A scan that was replaced, or a site whose checks were turned off
 * or that was removed, is dropped quietly.
 */
export async function continueScan(env: Env, siteId: number, run: string, pauseMs = PAGE_PAUSE_MS) {
  const row = await env.DB.prepare(
    `SELECT a.progress, s.accessibility_excluded AS excluded FROM accessibility_scans a
     JOIN sites s ON s.id = a.site_id WHERE a.site_id = ?`,
  )
    .bind(siteId)
    .first<{ progress: string | null; excluded: number }>();
  const progress = row?.progress ? (JSON.parse(row.progress) as Progress) : null;
  if (!row || !progress || progress.run !== run) return;
  if (row.excluded) {
    await env.DB.prepare("UPDATE accessibility_scans SET progress = NULL WHERE site_id = ?").bind(siteId).run();
    return;
  }
  // One page at a time, and no more once the site starts to struggle.
  const step = progress.queue.splice(0, PAGES_PER_STEP);
  for (const url of step) {
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
    const page = await fetchPage(url);
    if (page === "overloaded") {
      progress.queue = [];
      break;
    }
    if (page && !progress.pages.includes(page.url)) {
      progress.pages.push(page.url);
      addPage(progress.tally, page.url, analyzePage(page.html));
    }
  }
  if (!progress.queue.length) return finish(env, siteId, progress, Math.floor(Date.now() / 1000));
  // A scan started meanwhile replaced this one, and keeps its own progress.
  const saved = await env.DB.prepare(
    "UPDATE accessibility_scans SET progress = ? WHERE site_id = ? AND json_extract(progress, '$.run') = ?",
  )
    .bind(JSON.stringify(progress), siteId, run)
    .run();
  if (!saved.meta.changes) return;
  await env.SYNC_QUEUE.send({ type: "accessibility", siteId, run });
}

/** Save a finished scan's result and score. */
async function finish(env: Env, siteId: number, progress: Progress, now: number) {
  const stored = result(progress.pages, progress.tally);
  const score = accessibilityScore(stored.issues);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE accessibility_scans SET scanned_at = ?, score = ?, result = ?, error = NULL, progress = NULL
       WHERE site_id = ?`,
    ).bind(now, score, JSON.stringify(stored), siteId),
    env.DB.prepare("INSERT OR REPLACE INTO accessibility_history (site_id, scanned_at, score) VALUES (?, ?, ?)").bind(
      siteId,
      now,
      score,
    ),
    env.DB.prepare(
      `DELETE FROM accessibility_history WHERE site_id = ? AND scanned_at NOT IN
         (SELECT scanned_at FROM accessibility_history WHERE site_id = ? ORDER BY scanned_at DESC LIMIT ?)`,
    ).bind(siteId, siteId, HISTORY_LIMIT),
  ]);
}

/** A running scan's progress, unless it has gone stale. */
function running(progress: string | null, now: number): Progress | null {
  if (!progress) return null;
  const parsed = JSON.parse(progress) as Progress;
  return now - parsed.started_at < STALE_AFTER ? parsed : null;
}

/** Start a scan on request, unless one just started or is still running. */
export async function scanNow(env: Env, site: Pick<SiteSummary, "id" | "url">, options: { force?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT attempted_at, progress FROM accessibility_scans WHERE site_id = ?")
    .bind(site.id)
    .first<{ attempted_at: number; progress: string | null }>();
  if (!options.force && row && (now - row.attempted_at < MIN_GAP || running(row.progress, now))) return;
  await scanSite(env, site.id, site.url, now);
}

/** Start scans of the sites not scanned in the last day, one per cron run. Returns how many were started. */
export async function runScheduledScans(env: Env, now = Math.floor(Date.now() / 1000)): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT sites.id, sites.url FROM sites
     LEFT JOIN accessibility_scans a ON a.site_id = sites.id
     WHERE sites.status != 'error' AND sites.accessibility_excluded = 0 AND (a.site_id IS NULL OR a.attempted_at < ?)
     ORDER BY a.attempted_at IS NOT NULL, a.attempted_at
     LIMIT ?`,
  )
    .bind(now - DAY, SCANS_PER_RUN)
    .all<{ id: number; url: string }>();
  for (const site of results) {
    try {
      await scanSite(env, site.id, site.url, now);
    } catch (error) {
      if (!(error instanceof AccessibilityError)) console.error("accessibility scan", site.id, error);
    }
  }
  return results.length;
}

interface FixStates {
  [id: string]: { enabled?: boolean; applied?: boolean };
}

/** The fixes the site reports, or why they are not available. */
async function fixStates(
  env: Env,
  site: SiteSummary,
  credentials: SiteCredentials | null,
): Promise<{ states: FixStates | null; note: string | null }> {
  if (site.kind === "static" || !credentials) return { states: null, note: null };
  if (!site.plugin_version || compareVersions(site.plugin_version, ACCESSIBILITY_SINCE) < 0) {
    return {
      states: null,
      note: "KontrolWP Connect on this site is too old to apply accessibility fixes. It updates automatically; select Sync now to check.",
    };
  }
  try {
    const report = await cachedRead(env.DB, site.id, "accessibility", "fixes", () =>
      callSite<{ fixes?: FixStates }>(credentials, "GET", `${REST_NAMESPACE}/accessibility`),
    );
    return { states: report.fixes ?? {}, note: null };
  } catch (error) {
    return {
      states: null,
      note: `The site's fixes could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** The latest scan, its score history, and the state of the automatic fixes. */
export async function siteAccessibility(
  env: Env,
  site: SiteSummary,
  credentials: SiteCredentials | null,
): Promise<SiteAccessibility> {
  const [row, history, fixes] = await Promise.all([
    env.DB.prepare("SELECT scanned_at, score, result, error, progress FROM accessibility_scans WHERE site_id = ?")
      .bind(site.id)
      .first<{
        scanned_at: number | null;
        score: number | null;
        result: string | null;
        error: string | null;
        progress: string | null;
      }>(),
    env.DB.prepare(
      "SELECT scanned_at, score FROM accessibility_history WHERE site_id = ? ORDER BY scanned_at DESC LIMIT 30",
    )
      .bind(site.id)
      .all<{ scanned_at: number; score: number }>(),
    fixStates(env, site, credentials),
  ]);
  // Fixes added after 0.14.0 show once the site's plugin can apply them.
  const available = fixes.states ? fixesFor(site.plugin_version) : [];
  let scan: AccessibilityScan | null = null;
  if (row?.result && row.scanned_at !== null && row.score !== null) {
    const stored = JSON.parse(row.result) as StoredResult;
    scan = {
      scanned_at: row.scanned_at,
      score: row.score,
      pages: stored.pages,
      issues: stored.issues.map((issue) => {
        const id = ACCESSIBILITY_RULES[issue.rule]?.fix;
        const fix = available.find((candidate) => candidate.id === id);
        const state = id ? fixes.states?.[id] : undefined;
        return {
          ...issue,
          fix:
            fix && fixes.states
              ? { id: fix.id, title: fix.title, enabled: !!state?.enabled, applied: !!state?.applied }
              : null,
        };
      }),
    };
  }
  const progress = running(row?.progress ?? null, Math.floor(Date.now() / 1000));
  return {
    scan,
    scanning: progress
      ? { done: progress.pages.length, total: progress.pages.length + progress.queue.length }
      : null,
    error: row?.error ?? null,
    history: history.results.reverse(),
    fixes: fixes.states
      ? available.map((fix) => ({
          id: fix.id,
          title: fix.title,
          detail: fix.detail,
          enabled: !!fixes.states![fix.id]?.enabled,
          applied: !!fixes.states![fix.id]?.applied,
        }))
      : [],
    fixes_note: fixes.note,
    can_fix: fixes.states !== null,
  };
}

/** Switch fixes on or off on one WordPress site. */
export async function setAccessibilityFixes(credentials: SiteCredentials, ids: string[], enabled: boolean) {
  await callSite(credentials, "POST", `${REST_NAMESPACE}/accessibility/fixes`, { ids, enabled });
}

const DEFAULTS_SETTING = "accessibility_fix_defaults";

/** The fixes Settings turns on for every newly connected WordPress site. */
export async function loadFixDefaults(env: Env): Promise<string[]> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = ?")
    .bind(DEFAULTS_SETTING)
    .first<{ value: string }>();
  try {
    const saved = row ? (JSON.parse(row.value) as unknown) : [];
    return ACCESSIBILITY_FIXES.map((fix) => fix.id).filter((id) => Array.isArray(saved) && saved.includes(id));
  } catch {
    return [];
  }
}

export async function saveFixDefaults(env: Env, ids: string[]): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES (?, ?)")
    .bind(DEFAULTS_SETTING, JSON.stringify(ACCESSIBILITY_FIXES.map((fix) => fix.id).filter((id) => ids.includes(id))))
    .run();
}

/** The WordPress sites that can take fixes and have accessibility checks on. */
async function fixableSites(env: Env): Promise<{ id: number; name: string; plugin_version: string | null }[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, name, plugin_version FROM sites WHERE kind != 'static' AND accessibility_excluded = 0 ORDER BY name",
  ).all<{ id: number; name: string; plugin_version: string | null }>();
  return results.filter((site) => site.plugin_version && compareVersions(site.plugin_version, ACCESSIBILITY_SINCE) >= 0);
}

/** The defaults, with how many sites "Apply to all sites" would change. */
export async function fixDefaultsView(env: Env): Promise<AccessibilityFixDefaults> {
  const [enabled, sites] = await Promise.all([loadFixDefaults(env), fixableSites(env)]);
  return {
    fixes: ACCESSIBILITY_FIXES.map((fix) => ({ ...fix, enabled: enabled.includes(fix.id) })),
    site_count: sites.length,
  };
}

/** Make one site's fixes match the given ones: those on, every other fix its plugin knows off. */
async function matchFixes(credentials: SiteCredentials, enabled: string[], pluginVersion: string | null) {
  const known = fixesFor(pluginVersion).map((fix) => fix.id);
  const on = known.filter((id) => enabled.includes(id));
  const off = known.filter((id) => !enabled.includes(id));
  if (on.length) await setAccessibilityFixes(credentials, on, true);
  if (off.length) await setAccessibilityFixes(credentials, off, false);
}

/** Give every WordPress site the default fixes. Returns the names of sites that could not be changed. */
export async function applyFixDefaultsToAll(env: Env): Promise<{ applied: number; failed: string[] }> {
  const [enabled, sites] = await Promise.all([loadFixDefaults(env), fixableSites(env)]);
  const failed: string[] = [];
  let applied = 0;
  // A few at a time, so a slow site does not hold up the rest for long.
  for (let i = 0; i < sites.length; i += 4) {
    await Promise.all(
      sites.slice(i, i + 4).map(async (site) => {
        try {
          const credentials = await getCredentials(env, site.id);
          if (!credentials) return;
          await matchFixes(credentials, enabled, site.plugin_version);
          applied++;
        } catch (error) {
          if (!(error instanceof SiteRequestError)) console.error("accessibility defaults", site.id, error);
          failed.push(site.name);
        }
      }),
    );
  }
  await env.DB.prepare("DELETE FROM content_cache WHERE kind = 'accessibility'").run();
  await env.DB.prepare("UPDATE sites SET accessibility_defaults_applied = 1").run();
  return { applied, failed };
}

/**
 * A newly connected site gets the default fixes on its first sync that can
 * take them. Best effort: a site that cannot be changed is tried on the next sync.
 */
export async function applyFixDefaultsOnce(env: Env, credentials: SiteCredentials, pluginVersion: string) {
  if (!pluginVersion || compareVersions(pluginVersion, ACCESSIBILITY_SINCE) < 0) return;
  const row = await env.DB.prepare("SELECT accessibility_defaults_applied, accessibility_excluded FROM sites WHERE id = ?")
    .bind(credentials.id)
    .first<{ accessibility_defaults_applied: number; accessibility_excluded: number }>();
  if (!row || row.accessibility_defaults_applied) return;
  if (!row.accessibility_excluded) {
    const known = fixesFor(pluginVersion).map((fix) => fix.id);
    const enabled = (await loadFixDefaults(env)).filter((id) => known.includes(id));
    try {
      if (enabled.length) await setAccessibilityFixes(credentials, enabled, true);
    } catch (error) {
      if (error instanceof SiteRequestError) return;
      throw error;
    }
  }
  await env.DB.prepare("UPDATE sites SET accessibility_defaults_applied = 1 WHERE id = ?").bind(credentials.id).run();
}
