import { ACCESSIBILITY_FIXES, ACCESSIBILITY_RULES, accessibilityScore } from "../../shared/accessibility.ts";
import { REST_NAMESPACE } from "../../shared/protocol.ts";
import { ACCESSIBILITY_SINCE, compareVersions } from "../../shared/plugin-version.ts";
import type { AccessibilityIssue, AccessibilityScan, SiteAccessibility, SiteSummary } from "../../shared/types.ts";
import { cachedRead } from "../content-cache.ts";
import { analyzePage, type Finding } from "./accessibility-check.ts";
import { callSite, type SiteCredentials } from "./client.ts";

/** The home page and a few pages it links to, so a theme-wide problem shows up and a one-off does not dominate. */
const MAX_PAGES = 5;
const DAY = 86400;
/** Manual scans can follow each other, but not on top of each other. */
const MIN_GAP = 30;
const HISTORY_LIMIT = 90;
/** One cron run makes at most 50 requests, and a scan makes up to five. */
const SCANS_PER_RUN = 3;
const MAX_HTML = 1024 * 1024;

export class AccessibilityError extends Error {}

interface StoredResult {
  pages: string[];
  issues: Omit<AccessibilityIssue, "fix">[];
}

async function fetchPage(url: string): Promise<{ url: string; html: string } | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "KontrolWP Accessibility Check" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
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

/** Add up the findings of every page into one entry per kind of problem. */
export function summarize(perPage: { url: string; findings: Finding[] }[]): StoredResult {
  const byRule = new Map<string, { count: number; pages: Set<string>; examples: string[] }>();
  for (const { url, findings } of perPage) {
    for (const finding of findings) {
      if (!ACCESSIBILITY_RULES[finding.rule]) continue;
      const entry = byRule.get(finding.rule) ?? { count: 0, pages: new Set(), examples: [] };
      entry.count++;
      entry.pages.add(url);
      if (entry.examples.length < 3 && !entry.examples.includes(finding.example)) entry.examples.push(finding.example);
      byRule.set(finding.rule, entry);
    }
  }
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const issues = [...byRule]
    .map(([rule, entry]) => {
      const meta = ACCESSIBILITY_RULES[rule];
      return {
        rule,
        title: meta.title,
        impact: meta.impact,
        wcag: meta.wcag,
        help: meta.help,
        count: entry.count,
        pages: [...entry.pages],
        examples: entry.examples,
      };
    })
    .sort((a, b) => order[a.impact] - order[b.impact] || b.count - a.count);
  return { pages: perPage.map((page) => page.url), issues };
}

/**
 * Scan a site's home page and the pages it links to, and keep the result.
 * Throws AccessibilityError when the home page cannot be read, leaving the
 * last result in place.
 */
export async function scanSite(env: Env, siteId: number, siteUrl: string, now = Math.floor(Date.now() / 1000)) {
  await env.DB.prepare(
    `INSERT INTO accessibility_scans (site_id, attempted_at) VALUES (?, ?)
     ON CONFLICT(site_id) DO UPDATE SET attempted_at = excluded.attempted_at`,
  )
    .bind(siteId, now)
    .run();
  const home = await fetchPage(siteUrl);
  if (!home) {
    const error = "The site's home page could not be read.";
    await env.DB.prepare("UPDATE accessibility_scans SET error = ? WHERE site_id = ?").bind(error, siteId).run();
    throw new AccessibilityError(error);
  }
  const others = await Promise.all(linkedPages(home.html, home.url).map(fetchPage));
  const pages = [home, ...others.filter((page): page is { url: string; html: string } => !!page)];
  const result = summarize(pages.map((page) => ({ url: page.url, findings: analyzePage(page.html) })));
  const score = accessibilityScore(result.issues);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE accessibility_scans SET scanned_at = ?, score = ?, result = ?, error = NULL WHERE site_id = ?",
    ).bind(now, score, JSON.stringify(result), siteId),
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

/** Scan on request, unless one just ran. */
export async function scanNow(env: Env, site: Pick<SiteSummary, "id" | "url">, options: { force?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT attempted_at FROM accessibility_scans WHERE site_id = ?")
    .bind(site.id)
    .first<{ attempted_at: number }>();
  if (!options.force && row && now - row.attempted_at < MIN_GAP) return;
  await scanSite(env, site.id, site.url, now);
}

/** Rescan the sites not scanned in the last day, a few at a time, from the cron. Returns how many were scanned. */
export async function runScheduledScans(env: Env, now = Math.floor(Date.now() / 1000)): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT sites.id, sites.url FROM sites
     LEFT JOIN accessibility_scans a ON a.site_id = sites.id
     WHERE a.site_id IS NULL OR a.attempted_at < ?
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
    env.DB.prepare("SELECT scanned_at, score, result, error FROM accessibility_scans WHERE site_id = ?")
      .bind(site.id)
      .first<{ scanned_at: number | null; score: number | null; result: string | null; error: string | null }>(),
    env.DB.prepare(
      "SELECT scanned_at, score FROM accessibility_history WHERE site_id = ? ORDER BY scanned_at DESC LIMIT 30",
    )
      .bind(site.id)
      .all<{ scanned_at: number; score: number }>(),
    fixStates(env, site, credentials),
  ]);
  let scan: AccessibilityScan | null = null;
  if (row?.result && row.scanned_at !== null && row.score !== null) {
    const stored = JSON.parse(row.result) as StoredResult;
    scan = {
      scanned_at: row.scanned_at,
      score: row.score,
      pages: stored.pages,
      issues: stored.issues.map((issue) => {
        const id = ACCESSIBILITY_RULES[issue.rule]?.fix;
        const fix = ACCESSIBILITY_FIXES.find((candidate) => candidate.id === id);
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
  return {
    scan,
    error: row?.error ?? null,
    history: history.results.reverse(),
    fixes: fixes.states
      ? ACCESSIBILITY_FIXES.map((fix) => ({
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
