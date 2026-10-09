import {
  PERFORMANCE_STRATEGIES,
  type PerformanceFieldMetric,
  type PerformanceLabMetric,
  type PerformanceOpportunity,
  type PerformanceResult,
  type PerformanceScores,
  type PerformanceStrategy,
  type PerformanceStrategyState,
  type SitePerformance,
  type SiteSummary,
} from "../../shared/types.ts";
import { decryptSetting, encryptSetting } from "./secrets.ts";

/**
 * PageSpeed Insights: Google runs Lighthouse against the site's home page, as
 * a phone and as a desktop, and reports the category scores, the lab
 * measurements, the Chrome user experience data (real visits) when Google has
 * enough of it, and what would save the most time. The tests are slow (about
 * half a minute each), so a test started from the dashboard runs from the
 * queue while the page checks back for it.
 */

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const SETTING = "pagespeed";
const WEEK = 7 * 86400;
const HISTORY_LIMIT = 90;
/** A test that has not finished after this long is treated as lost. */
const RUNNING_LIMIT = 300;
/** One site per cron run, so tests never pile up. */
const TESTS_PER_RUN = 1;
const MAX_OPPORTUNITIES = 6;

/**
 * Only the parts the dashboard shows, so an answer is a few kilobytes instead
 * of a megabyte of screenshots and page details.
 */
export const FIELDS =
  "id,loadingExperience,originLoadingExperience," +
  "lighthouseResult(finalDisplayedUrl,runtimeError,categories," +
  "audits/*(title,score,scoreDisplayMode,displayValue,numericValue,metricSavings,details/type,details/overallSavingsMs))";

export class PerformanceError extends Error {}

export async function loadPagespeedKey(env: Env): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = ?")
    .bind(SETTING)
    .first<{ value: string }>();
  return row ? decryptSetting(env.SITE_SECRETS_KEY, SETTING, row.value) : null;
}

export async function savePagespeedKey(env: Env, key: string): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES (?, ?)")
    .bind(SETTING, await encryptSetting(env.SITE_SECRETS_KEY, SETTING, key))
    .run();
}

export async function deletePagespeedKey(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE name = ?").bind(SETTING).run();
}

/* ---- Reading Google's answer (pure, tested) ---- */

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {});
const asNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function categoryScore(categories: Json, id: string): number | null {
  const score = asNumber(asObject(categories[id]).score);
  return score === null ? null : Math.round(score * 100);
}

const LAB_AUDITS: [PerformanceLabMetric["id"], string][] = [
  ["fcp", "first-contentful-paint"],
  ["lcp", "largest-contentful-paint"],
  ["tbt", "total-blocking-time"],
  ["cls", "cumulative-layout-shift"],
  ["si", "speed-index"],
];

const FIELD_METRICS: [PerformanceFieldMetric["id"], string][] = [
  ["lcp", "LARGEST_CONTENTFUL_PAINT_MS"],
  ["inp", "INTERACTION_TO_NEXT_PAINT"],
  ["cls", "CUMULATIVE_LAYOUT_SHIFT_SCORE"],
  ["fcp", "FIRST_CONTENTFUL_PAINT_MS"],
];

const FIELD_CATEGORIES: Record<string, PerformanceFieldMetric["category"]> = {
  FAST: "good",
  AVERAGE: "needs-improvement",
  SLOW: "poor",
};

/** The parts of a PageSpeed Insights response the dashboard shows. Throws PerformanceError when there is no Lighthouse result in it. */
export function parsePagespeed(response: unknown, now: number): PerformanceResult {
  const body = asObject(response);
  const lighthouse = asObject(body.lighthouseResult);
  const categories = asObject(lighthouse.categories);
  if (!Object.keys(categories).length) throw new PerformanceError("Google returned no Lighthouse result for the page.");
  const audits = asObject(lighthouse.audits);

  const scores: PerformanceScores = {
    performance: categoryScore(categories, "performance"),
    accessibility: categoryScore(categories, "accessibility"),
    best_practices: categoryScore(categories, "best-practices"),
    seo: categoryScore(categories, "seo"),
  };

  const lab: PerformanceLabMetric[] = [];
  for (const [id, audit] of LAB_AUDITS) {
    const found = asObject(audits[audit]);
    const value = asNumber(found.numericValue);
    if (value !== null) lab.push({ id, value, display: typeof found.displayValue === "string" ? found.displayValue : "" });
  }

  // Google falls back to the whole site's visits when the page alone has too few.
  const page = asObject(body.loadingExperience);
  const pageMetrics = asObject(page.metrics);
  const usePage = Object.keys(pageMetrics).length > 0 && page.origin_fallback !== true;
  const metrics = usePage ? pageMetrics : asObject(asObject(body.originLoadingExperience).metrics);
  const field: PerformanceFieldMetric[] = [];
  for (const [id, key] of FIELD_METRICS) {
    const found = asObject(metrics[key]);
    const percentile = asNumber(found.percentile);
    const category = FIELD_CATEGORIES[String(found.category)];
    // Google reports the layout shift multiplied by 100.
    if (percentile !== null && category) field.push({ id, value: id === "cls" ? percentile / 100 : percentile, category });
  }

  // Older Lighthouse versions report savings on "opportunity" audits; newer ones on insights, as metric savings.
  const opportunities: PerformanceOpportunity[] = [];
  const titles = new Set<string>();
  for (const [id, raw] of Object.entries(audits)) {
    const audit = asObject(raw);
    const details = asObject(audit.details);
    const metricSavings = asObject(audit.metricSavings);
    const score = asNumber(audit.score);
    const savings =
      details.type === "opportunity"
        ? asNumber(details.overallSavingsMs)
        : score !== null && score < 0.9
          ? (asNumber(metricSavings.LCP) ?? asNumber(metricSavings.FCP))
          : null;
    if (savings === null || savings <= 0 || typeof audit.title !== "string" || titles.has(audit.title)) continue;
    titles.add(audit.title);
    opportunities.push({
      id,
      title: audit.title,
      savings_ms: Math.round(savings),
      display: typeof audit.displayValue === "string" ? audit.displayValue : "",
    });
  }
  opportunities.sort((a, b) => b.savings_ms - a.savings_ms);

  const runtime = asObject(lighthouse.runtimeError);
  if (typeof runtime.code === "string" && runtime.code !== "NO_ERROR" && scores.performance === null) {
    throw new PerformanceError(
      `Google could not test the page: ${typeof runtime.message === "string" && runtime.message ? runtime.message : runtime.code}`,
    );
  }

  return {
    scanned_at: now,
    url: typeof lighthouse.finalDisplayedUrl === "string" ? lighthouse.finalDisplayedUrl : String(body.id ?? ""),
    scores,
    lab,
    field,
    field_scope: field.length ? (usePage ? "page" : "origin") : null,
    opportunities: opportunities.slice(0, MAX_OPPORTUNITIES),
  };
}

/** What a failed request means for the owner. */
export function pagespeedFailure(status: number, response: unknown): string {
  const error = asObject(asObject(response).error);
  const message = typeof error.message === "string" ? error.message : "";
  if (status === 429) {
    return "Google's PageSpeed Insights refused the test because too many were asked for. Save a free API key in Settings, Integrations, or try again later.";
  }
  if (/api key not valid/i.test(message)) return "Google did not accept the PageSpeed API key. Check the key in Settings, Integrations.";
  if (/api key|API_KEY|has not been used|is disabled|not enabled/i.test(message) || status === 403) {
    return "Google did not accept the PageSpeed API key. Check the key in Settings, and that the PageSpeed Insights API is turned on for its Google Cloud project.";
  }
  const reason = message.replace(/^Lighthouse returned error: ?/i, "").trim();
  return `Google could not test the page${reason ? `: ${reason}` : ` (HTTP ${status})`}`;
}

/** Whether Google still has what the dashboard reads after trimming the answer to FIELDS. */
function complete(response: unknown): boolean {
  const lighthouse = asObject(asObject(response).lighthouseResult);
  const code = asObject(lighthouse.runtimeError).code;
  if (typeof code === "string" && code !== "NO_ERROR") return true;
  const audits = asObject(lighthouse.audits);
  return (
    asNumber(asObject(audits["largest-contentful-paint"]).numericValue) !== null &&
    asNumber(asObject(asObject(lighthouse.categories).performance).score) !== null
  );
}

/** Whether Google accepts FIELDS; learned once per Worker instance, so a change on Google's side costs one extra test. */
let trimAnswers = true;

/** For tests: assume FIELDS works again. */
export function resetFieldsCheck() {
  trimAnswers = true;
}

/** Ask Google to test a page. */
export async function fetchPagespeed(
  url: string,
  strategy: PerformanceStrategy,
  key: string | null,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<PerformanceResult> {
  const ask = async (trim: boolean) => {
    const query = new URLSearchParams({ url, strategy: strategy.toUpperCase() });
    for (const category of ["PERFORMANCE", "ACCESSIBILITY", "BEST_PRACTICES", "SEO"]) query.append("category", category);
    if (key) query.set("key", key);
    if (trim) query.set("fields", FIELDS);
    let response: Response;
    try {
      response = await fetcher(`${ENDPOINT}?${query}`, { signal: AbortSignal.timeout(120_000) });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new PerformanceError("The test took too long. Try again in a few minutes.");
      }
      throw new PerformanceError("Google's PageSpeed Insights could not be reached.");
    }
    const body: unknown = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  };

  let answer = await ask(trimAnswers);
  if (trimAnswers) {
    const message = String(asObject(asObject(answer.body).error).message ?? "");
    const rejected = answer.status === 400 && /field/i.test(message);
    if (rejected || (answer.ok && !complete(answer.body))) {
      trimAnswers = false;
      answer = await ask(false);
    }
  }
  if (!answer.ok) throw new PerformanceError(pagespeedFailure(answer.status, answer.body));
  return parsePagespeed(answer.body, now);
}

/* ---- Storing and reading tests ---- */

/** Mark a site's tests as running. False when one is already running, so a second does not start on top of it. */
export async function claimTest(env: Env, siteId: number, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const running = await env.DB.prepare(
    "SELECT 1 AS n FROM performance_scans WHERE site_id = ? AND running_since IS NOT NULL AND running_since > ?",
  )
    .bind(siteId, now - RUNNING_LIMIT)
    .first();
  if (running) return false;
  await env.DB.batch(
    PERFORMANCE_STRATEGIES.map((strategy) =>
      env.DB.prepare(
        `INSERT INTO performance_scans (site_id, strategy, attempted_at, running_since) VALUES (?, ?, ?, ?)
         ON CONFLICT(site_id, strategy) DO UPDATE SET attempted_at = excluded.attempted_at, running_since = excluded.running_since`,
      ).bind(siteId, strategy, now, now),
    ),
  );
  return true;
}

async function store(env: Env, siteId: number, strategy: PerformanceStrategy, now: number, result: PerformanceResult | PerformanceError) {
  if (result instanceof PerformanceError) {
    await env.DB.prepare("UPDATE performance_scans SET error = ?, running_since = NULL WHERE site_id = ? AND strategy = ?")
      .bind(result.message, siteId, strategy)
      .run();
    return;
  }
  const { scores } = result;
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE performance_scans SET scanned_at = ?, result = ?, error = NULL, running_since = NULL WHERE site_id = ? AND strategy = ?",
    ).bind(now, JSON.stringify(result), siteId, strategy),
    env.DB.prepare(
      `INSERT OR REPLACE INTO performance_history
         (site_id, strategy, scanned_at, performance, accessibility, best_practices, seo) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(siteId, strategy, now, scores.performance, scores.accessibility, scores.best_practices, scores.seo),
    env.DB.prepare(
      `DELETE FROM performance_history WHERE site_id = ? AND strategy = ? AND scanned_at NOT IN
         (SELECT scanned_at FROM performance_history WHERE site_id = ? AND strategy = ? ORDER BY scanned_at DESC LIMIT ?)`,
    ).bind(siteId, strategy, siteId, strategy, HISTORY_LIMIT),
  ]);
}

/** Test the site as a phone and as a desktop, and keep what comes back. The caller has claimed the test. */
export async function testSite(
  env: Env,
  site: Pick<SiteSummary, "id" | "url">,
  now = Math.floor(Date.now() / 1000),
  fetcher: typeof fetch = fetch,
): Promise<void> {
  let key: string | null = null;
  try {
    key = await loadPagespeedKey(env);
  } catch {
    // The key could not be read; Google may still allow a test without one.
  }
  await Promise.all(
    PERFORMANCE_STRATEGIES.map(async (strategy) => {
      try {
        await store(env, site.id, strategy, now, await fetchPagespeed(site.url, strategy, key, now, fetcher));
      } catch (error) {
        await store(
          env,
          site.id,
          strategy,
          now,
          error instanceof PerformanceError ? error : new PerformanceError("The test failed unexpectedly. Try again."),
        );
        if (!(error instanceof PerformanceError)) console.error("performance test", site.id, error);
      }
    }),
  );
}

/** Test the sites not tested in the last week, one at a time, from the cron. Needs a saved API key. Returns how many were tested. */
export async function runScheduledPerformance(
  env: Env,
  now = Math.floor(Date.now() / 1000),
  fetcher: typeof fetch = fetch,
): Promise<number> {
  if (!(await loadPagespeedKey(env).catch(() => null))) return 0;
  const { results } = await env.DB.prepare(
    `SELECT sites.id, sites.url FROM sites
     LEFT JOIN performance_scans p ON p.site_id = sites.id AND p.strategy = 'mobile'
     WHERE sites.status != 'error' AND sites.performance_excluded = 0 AND (p.site_id IS NULL OR p.attempted_at < ?)
     ORDER BY p.attempted_at IS NOT NULL, p.attempted_at
     LIMIT ?`,
  )
    .bind(now - WEEK, TESTS_PER_RUN)
    .all<{ id: number; url: string }>();
  let tested = 0;
  for (const site of results) {
    if (!(await claimTest(env, site.id, now))) continue;
    await testSite(env, site, now, fetcher);
    tested++;
  }
  return tested;
}

type Row = {
  strategy: PerformanceStrategy;
  scanned_at: number | null;
  result: string | null;
  error: string | null;
  running_since: number | null;
};

export async function sitePerformance(env: Env, site: Pick<SiteSummary, "id">, now = Math.floor(Date.now() / 1000)): Promise<SitePerformance> {
  const [rows, history, key] = await Promise.all([
    env.DB.prepare("SELECT strategy, scanned_at, result, error, running_since FROM performance_scans WHERE site_id = ?")
      .bind(site.id)
      .all<Row>(),
    env.DB.prepare(
      `SELECT strategy, scanned_at, performance, accessibility, best_practices, seo FROM performance_history
       WHERE site_id = ? ORDER BY scanned_at DESC LIMIT 120`,
    )
      .bind(site.id)
      .all<{ strategy: PerformanceStrategy; scanned_at: number } & PerformanceScores>(),
    loadPagespeedKey(env).catch(() => null),
  ]);
  const state = (strategy: PerformanceStrategy): PerformanceStrategyState => {
    const row = rows.results.find((candidate) => candidate.strategy === strategy);
    return {
      result: row?.result ? (JSON.parse(row.result) as PerformanceResult) : null,
      error: row?.error ?? null,
      history: history.results
        .filter((point) => point.strategy === strategy)
        .slice(0, 30)
        .reverse()
        .map(({ scanned_at, performance, accessibility, best_practices, seo }) => ({
          scanned_at,
          performance,
          accessibility,
          best_practices,
          seo,
        })),
    };
  };
  return {
    mobile: state("mobile"),
    desktop: state("desktop"),
    running: rows.results.some((row) => row.running_since !== null && row.running_since > now - RUNNING_LIMIT),
    key_configured: Boolean(key),
  };
}
