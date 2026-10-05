import { SEO_RULES, seoScore } from "../../shared/seo-audit.ts";
import type {
  SeoAuditIssue,
  SiteSeoAudit,
  SiteSummary,
} from "../../shared/types.ts";
import { linkedPages } from "./accessibility.ts";
import { analyzeSeoPage, type SeoFinding } from "./seo-audit-check.ts";
import { readSitemap } from "./sitemap.ts";

/** The home page plus a handful of others: enough to show a template-wide problem and spot duplicates. */
const MAX_PAGES = 5;
const DAY = 86400;
/** Manual scans can follow each other, but not on top of each other. */
const MIN_GAP = 30;
const HISTORY_LIMIT = 90;
/** One site per cron run, so scans never pile up. */
const SCANS_PER_RUN = 1;
const PAGE_PAUSE_MS = 300;
const MAX_HTML = 1024 * 1024;

export class SeoAuditError extends Error {}

interface StoredResult {
  pages: string[];
  issues: Omit<SeoAuditIssue, "title" | "impact" | "help">[];
}

type Fetched = { status: number; url: string; html: string };

/** A page's status and HTML, or null when the site did not answer. */
async function fetchPage(url: string): Promise<Fetched | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "KontrolWP SEO Check" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const html = (response.headers.get("Content-Type") ?? "").includes("html")
      ? (await response.text()).slice(0, MAX_HTML)
      : "";
    return { status: response.status, url: response.url || url, html };
  } catch {
    return null;
  }
}

async function fetchText(
  url: string,
): Promise<{ status: number; text: string } | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "KontrolWP SEO Check" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    return {
      status: response.status,
      text: response.ok ? (await response.text()).slice(0, 200_000) : "",
    };
  } catch {
    return null;
  }
}

/** Whether a robots.txt tells every crawler to stay out of the whole site. */
export function blocksEverything(robots: string): boolean {
  let applies = false;
  let sawRule = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    switch (field.trim().toLowerCase()) {
      case "user-agent":
        if (sawRule) applies = false;
        sawRule = false;
        if (value === "*") applies = true;
        break;
      case "disallow":
      case "allow":
        sawRule = true;
        if (
          applies &&
          field.trim().toLowerCase() === "disallow" &&
          value === "/"
        )
          return true;
        break;
    }
  }
  return false;
}

/** Up to `limit` addresses spread evenly across a list, so a long sitemap is sampled, not just its start. */
export function sample<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  return Array.from(
    { length: limit },
    (_, i) => items[Math.floor((i * items.length) / limit)],
  );
}

/** Add up the findings into one entry per kind of problem, and add the problems only several pages show. */
export function summarizeSeo(
  perPage: {
    url: string;
    title: string;
    description: string;
    findings: SeoFinding[];
  }[],
  siteWide: SeoFinding[],
  broken: string[],
): StoredResult {
  const byRule = new Map<
    string,
    { count: number; pages: Set<string>; examples: string[] }
  >();
  const record = (rule: string, url: string | null, example: string) => {
    if (!SEO_RULES[rule]) return;
    const entry = byRule.get(rule) ?? {
      count: 0,
      pages: new Set(),
      examples: [],
    };
    entry.count++;
    if (url) entry.pages.add(url);
    if (entry.examples.length < 3 && !entry.examples.includes(example))
      entry.examples.push(example);
    byRule.set(rule, entry);
  };
  for (const page of perPage)
    for (const finding of page.findings)
      record(finding.rule, page.url, finding.example);
  for (const finding of siteWide) record(finding.rule, null, finding.example);
  for (const url of broken) record("broken-pages", url, url);

  for (const [field, rule] of [
    ["title", "title-duplicate"],
    ["description", "description-duplicate"],
  ] as const) {
    const groups = new Map<string, string[]>();
    for (const page of perPage) {
      const value = page[field].toLowerCase();
      if (value) groups.set(value, [...(groups.get(value) ?? []), page.url]);
    }
    for (const urls of groups.values()) {
      if (urls.length < 2) continue;
      for (const url of urls)
        record(rule, url, perPage.find((page) => page.url === url)![field]);
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  const issues = [...byRule]
    .map(([rule, entry]) => ({
      rule,
      count: entry.count,
      pages: [...entry.pages],
      examples: entry.examples,
    }))
    .sort(
      (a, b) =>
        order[SEO_RULES[a.rule].impact] - order[SEO_RULES[b.rule].impact] ||
        b.count - a.count,
    );
  return { pages: perPage.map((page) => page.url), issues };
}

/**
 * Check a static site's SEO and keep the result: the home page and a sample
 * of pages from its sitemap (or the pages the home page links to), plus its
 * robots.txt and sitemap. It only reads the site. Throws SeoAuditError when
 * the home page cannot be read, leaving the last result in place.
 */
export async function scanSeo(
  env: Env,
  siteId: number,
  siteUrl: string,
  now = Math.floor(Date.now() / 1000),
  pauseMs = PAGE_PAUSE_MS,
) {
  await env.DB.prepare(
    `INSERT INTO seo_scans (site_id, attempted_at) VALUES (?, ?)
     ON CONFLICT(site_id) DO UPDATE SET attempted_at = excluded.attempted_at`,
  )
    .bind(siteId, now)
    .run();
  const fail = async (error: string): Promise<never> => {
    await env.DB.prepare("UPDATE seo_scans SET error = ? WHERE site_id = ?")
      .bind(error, siteId)
      .run();
    throw new SeoAuditError(error);
  };
  const home = await fetchPage(siteUrl);
  if (!home) return fail("The site's home page could not be read.");
  if (home.status >= 400)
    return fail(`The site's home page answered HTTP ${home.status}.`);

  const origin = new URL(home.url).origin;
  const [robots, sitemap] = await Promise.all([
    fetchText(`${origin}/robots.txt`),
    readSitemap(siteUrl),
  ]);
  const robotsText = robots && robots.status < 400 ? robots.text : null;

  const siteWide: SeoFinding[] = [];
  if (robotsText === null)
    siteWide.push({ rule: "robots-missing", example: `${origin}/robots.txt` });
  else {
    if (blocksEverything(robotsText))
      siteWide.push({ rule: "robots-blocks-all", example: "Disallow: /" });
    if (!/^\s*sitemap:/im.test(robotsText)) {
      siteWide.push({
        rule: "sitemap-unlisted",
        example: `${origin}/robots.txt`,
      });
    }
  }
  if (!sitemap.sitemap_url)
    siteWide.push({
      rule: "sitemap-missing",
      example: `${origin}/sitemap.xml`,
    });

  const candidates = sitemap.items.length
    ? sample(
        sitemap.items
          .map((item) => item.url)
          .filter((url) => url !== home.url && url !== origin + "/"),
        MAX_PAGES - 1,
      )
    : linkedPages(home.html, home.url, MAX_PAGES - 1);
  const pages: Fetched[] = [home];
  const broken: string[] = [];
  for (const url of candidates) {
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
    const page = await fetchPage(url);
    if (!page || page.status >= 400) broken.push(url);
    else if (page.html) pages.push(page);
  }

  // A made-up address should answer 404; one that answers 200 is a page search engines can index.
  const missing = await fetchPage(
    `${origin}/kontrolwp-check-${Math.random().toString(36).slice(2, 10)}`,
  );
  if (missing && missing.status === 200 && missing.html) {
    siteWide.push({
      rule: "soft-404",
      example: "An address that does not exist answered 200",
    });
  }

  const result = summarizeSeo(
    pages.map((page) => ({
      url: page.url,
      ...analyzeSeoPage(page.html, page.url),
    })),
    siteWide,
    broken,
  );
  const score = seoScore(
    result.issues.map((issue) => ({
      impact: SEO_RULES[issue.rule].impact,
      count: issue.count,
    })),
  );
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE seo_scans SET scanned_at = ?, score = ?, result = ?, error = NULL WHERE site_id = ?",
    ).bind(now, score, JSON.stringify(result), siteId),
    env.DB.prepare(
      "INSERT OR REPLACE INTO seo_history (site_id, scanned_at, score) VALUES (?, ?, ?)",
    ).bind(siteId, now, score),
    env.DB.prepare(
      `DELETE FROM seo_history WHERE site_id = ? AND scanned_at NOT IN
         (SELECT scanned_at FROM seo_history WHERE site_id = ? ORDER BY scanned_at DESC LIMIT ?)`,
    ).bind(siteId, siteId, HISTORY_LIMIT),
  ]);
}

/** Scan on request, unless one just ran. */
export async function scanSeoNow(
  env: Env,
  site: Pick<SiteSummary, "id" | "url">,
  options: { force?: boolean; pauseMs?: number } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    "SELECT attempted_at FROM seo_scans WHERE site_id = ?",
  )
    .bind(site.id)
    .first<{ attempted_at: number }>();
  if (!options.force && row && now - row.attempted_at < MIN_GAP) return;
  await scanSeo(env, site.id, site.url, now, options.pauseMs);
}

/** Check the static sites not checked in the last day, from the cron. Returns how many were checked. */
export async function runScheduledSeoScans(
  env: Env,
  now = Math.floor(Date.now() / 1000),
  pauseMs = PAGE_PAUSE_MS,
): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT sites.id, sites.url FROM sites
     LEFT JOIN seo_scans s ON s.site_id = sites.id
     WHERE sites.kind = 'static' AND sites.status != 'error' AND (s.site_id IS NULL OR s.attempted_at < ?)
     ORDER BY s.attempted_at IS NOT NULL, s.attempted_at
     LIMIT ?`,
  )
    .bind(now - DAY, SCANS_PER_RUN)
    .all<{ id: number; url: string }>();
  for (const site of results) {
    try {
      await scanSeo(env, site.id, site.url, now, pauseMs);
    } catch (error) {
      if (!(error instanceof SeoAuditError))
        console.error("seo scan", site.id, error);
    }
  }
  return results.length;
}

/** The latest check and its score history. */
export async function siteSeoAudit(
  env: Env,
  site: Pick<SiteSummary, "id">,
): Promise<SiteSeoAudit> {
  const [row, history] = await Promise.all([
    env.DB.prepare(
      "SELECT scanned_at, score, result, error FROM seo_scans WHERE site_id = ?",
    )
      .bind(site.id)
      .first<{
        scanned_at: number | null;
        score: number | null;
        result: string | null;
        error: string | null;
      }>(),
    env.DB.prepare(
      "SELECT scanned_at, score FROM seo_history WHERE site_id = ? ORDER BY scanned_at DESC LIMIT 30",
    )
      .bind(site.id)
      .all<{ scanned_at: number; score: number }>(),
  ]);
  let scan: SiteSeoAudit["scan"] = null;
  if (row?.result && row.scanned_at !== null && row.score !== null) {
    const stored = JSON.parse(row.result) as StoredResult;
    scan = {
      scanned_at: row.scanned_at,
      score: row.score,
      pages: stored.pages,
      issues: stored.issues.flatMap((issue) => {
        const rule = SEO_RULES[issue.rule];
        return rule
          ? [
              {
                ...issue,
                title: rule.title,
                impact: rule.impact,
                help: rule.help,
              },
            ]
          : [];
      }),
    };
  }
  return {
    scan,
    error: row?.error ?? null,
    history: history.results.reverse(),
  };
}
