import assert from "node:assert/strict";
import test from "node:test";
import { randomToken } from "../src/shared/protocol.ts";
import { formatMetric, labBand, performanceBand } from "../src/shared/performance.ts";
import {
  FIELDS,
  claimTest,
  fetchPagespeed,
  pagespeedFailure,
  parsePagespeed,
  resetFieldsCheck,
  runScheduledPerformance,
  savePagespeedKey,
  sitePerformance,
  testSite,
} from "../src/worker/sites/performance.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

/** A trimmed PageSpeed Insights answer, shaped like Google's. */
function answer(overrides = {}) {
  return {
    id: "https://a.test/",
    loadingExperience: {
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100, category: "FAST" },
        INTERACTION_TO_NEXT_PAINT: { percentile: 180, category: "FAST" },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: "FAST" },
        FIRST_CONTENTFUL_PAINT_MS: { percentile: 1500, category: "FAST" },
      },
      overall_category: "FAST",
    },
    lighthouseResult: {
      finalDisplayedUrl: "https://a.test/",
      categories: {
        performance: { score: 0.87 },
        accessibility: { score: 0.95 },
        "best-practices": { score: 1 },
        seo: { score: 0.9 },
      },
      audits: {
        "first-contentful-paint": { numericValue: 1234, displayValue: "1.2 s" },
        "largest-contentful-paint": { numericValue: 2600, displayValue: "2.6 s" },
        "total-blocking-time": { numericValue: 150, displayValue: "150 ms" },
        "cumulative-layout-shift": { numericValue: 0.02, displayValue: "0.02" },
        "speed-index": { numericValue: 3000, displayValue: "3.0 s" },
        "render-blocking-resources": {
          title: "Eliminate render-blocking resources",
          score: 0.3,
          displayValue: "Potential savings of 450 ms",
          details: { type: "opportunity", overallSavingsMs: 450 },
        },
        "unused-javascript": {
          title: "Reduce unused JavaScript",
          score: 0.5,
          details: { type: "opportunity", overallSavingsMs: 900 },
        },
        "image-delivery-insight": {
          title: "Improve image delivery",
          score: 0,
          metricSavings: { LCP: 300, FCP: 0 },
          details: { type: "checklist" },
        },
        "passing-insight": { title: "Passing", score: 1, metricSavings: { LCP: 0 } },
      },
      ...overrides,
    },
  };
}

test("an answer becomes scores, lab measurements, real visits and the biggest savings", () => {
  const result = parsePagespeed(answer(), 100);
  assert.deepEqual(result.scores, { performance: 87, accessibility: 95, best_practices: 100, seo: 90 });
  assert.equal(result.url, "https://a.test/");
  assert.deepEqual(
    result.lab.map((m) => [m.id, m.value]),
    [
      ["fcp", 1234],
      ["lcp", 2600],
      ["tbt", 150],
      ["cls", 0.02],
      ["si", 3000],
    ],
  );
  assert.equal(result.field_scope, "page");
  assert.deepEqual(result.field.find((m) => m.id === "cls"), { id: "cls", value: 0.05, category: "good" });
  assert.deepEqual(
    result.opportunities.map((o) => [o.title, o.savings_ms]),
    [
      ["Reduce unused JavaScript", 900],
      ["Eliminate render-blocking resources", 450],
      ["Improve image delivery", 300],
    ],
  );
});

test("the whole site's visits are used when the page has too few", () => {
  const body = answer();
  body.loadingExperience = { metrics: {}, origin_fallback: true };
  body.originLoadingExperience = {
    metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4500, category: "SLOW" } },
  };
  const result = parsePagespeed(body, 100);
  assert.equal(result.field_scope, "origin");
  assert.deepEqual(result.field, [{ id: "lcp", value: 4500, category: "poor" }]);

  delete body.originLoadingExperience;
  const none = parsePagespeed(body, 100);
  assert.deepEqual(none.field, []);
  assert.equal(none.field_scope, null);
});

test("a page Lighthouse could not load is an error, not a score of nothing", () => {
  assert.throws(
    () =>
      parsePagespeed(
        answer({
          categories: { performance: { score: null } },
          runtimeError: { code: "FAILED_DOCUMENT_REQUEST", message: "Lighthouse was unable to reliably load the page" },
        }),
        1,
      ),
    /unable to reliably load/,
  );
  assert.throws(() => parsePagespeed({}, 1), /no Lighthouse result/);
});

test("Google's refusals read as something the owner can act on", () => {
  assert.match(pagespeedFailure(429, {}, null), /Connect Google or save a free API key/);
  assert.match(
    pagespeedFailure(403, { error: { message: "PageSpeed Insights API has not been used in project 1 before or it is disabled." } }, "google"),
    /owns your Google client ID/,
  );
  assert.match(pagespeedFailure(400, { error: { message: "API key not valid. Please pass a valid API key." } }), /did not accept/);
  assert.match(
    pagespeedFailure(403, { error: { message: "PageSpeed Insights API has not been used in project 1 before or it is disabled." } }),
    /turned on/,
  );
  assert.match(pagespeedFailure(500, { error: { message: "Lighthouse returned error: NO_FCP" } }), /could not test the page: NO_FCP/);
});

test("a test asks for both devices' categories, the key and a trimmed answer", async () => {
  resetFieldsCheck();
  const asked = [];
  const fetcher = async (url) => {
    asked.push(new URL(url));
    return Response.json(answer());
  };
  await fetchPagespeed("https://a.test/", "mobile", { via: "key", key: "secret-key" }, 1, fetcher);
  const url = asked[0];
  assert.equal(url.searchParams.get("url"), "https://a.test/");
  assert.equal(url.searchParams.get("strategy"), "MOBILE");
  assert.equal(url.searchParams.get("key"), "secret-key");
  assert.equal(url.searchParams.get("fields"), FIELDS);
  assert.deepEqual(url.searchParams.getAll("category"), ["PERFORMANCE", "ACCESSIBILITY", "BEST_PRACTICES", "SEO"]);
});

test("when Google rejects or ignores the trimmed field list, the full answer is asked for", async () => {
  resetFieldsCheck();
  const asked = [];
  const rejecting = async (url) => {
    const trimmed = new URL(url).searchParams.has("fields");
    asked.push(trimmed);
    return trimmed
      ? Response.json({ error: { message: "Request contains an invalid argument.", status: "INVALID_ARGUMENT" } }, { status: 400 })
      : Response.json(answer());
  };
  const result = await fetchPagespeed("https://a.test/", "desktop", null, 1, rejecting);
  assert.equal(result.scores.performance, 87);
  assert.deepEqual(asked, [true, false]);
  // Learned: the next test goes straight to the full answer.
  await fetchPagespeed("https://a.test/", "desktop", null, 1, rejecting);
  assert.deepEqual(asked, [true, false, false]);

  resetFieldsCheck();
  const seen = [];
  const ignoring = async (url) => {
    const trimmed = new URL(url).searchParams.has("fields");
    seen.push(trimmed);
    const body = answer();
    if (trimmed) body.lighthouseResult.audits = {};
    return Response.json(body);
  };
  const full = await fetchPagespeed("https://a.test/", "mobile", null, 1, ignoring);
  assert.equal(full.lab.length, 5);
  assert.deepEqual(seen, [true, false]);
  resetFieldsCheck();
});

function setup() {
  const db = fakeD1();
  for (const m of migrations) db.sqlite.exec(m.sql);
  db.sqlite.exec("INSERT INTO sites (id, name, url, key_id, secret, kind) VALUES (1, 'A', 'https://a.test/', 'k', '', 'static')");
  db.sqlite.exec("INSERT INTO sites (id, name, url, key_id, secret, kind) VALUES (2, 'B', 'https://b.test/', 'k', '', 'static')");
  return { DB: db, SITE_SECRETS_KEY: randomToken(32) };
}

test("a test stores both devices, keeps a history and blocks a second test while it runs", async () => {
  resetFieldsCheck();
  const env = setup();
  const site = { id: 1, url: "https://a.test/" };
  assert.equal(await claimTest(env, 1, 1000), true);
  assert.equal(await claimTest(env, 1, 1001), false);
  assert.equal((await sitePerformance(env, site, 1001)).running, true);

  const fetcher = async (url) => {
    const strategy = new URL(url).searchParams.get("strategy");
    if (strategy === "DESKTOP") return Response.json({ error: { message: "Lighthouse returned error: NO_FCP" } }, { status: 500 });
    return Response.json(answer());
  };
  await testSite(env, site, 1000, fetcher);
  const state = await sitePerformance(env, site, 1002);
  assert.equal(state.running, false);
  assert.equal(state.mobile.result.scores.performance, 87);
  assert.equal(state.mobile.error, null);
  assert.equal(state.desktop.result, null);
  assert.match(state.desktop.error, /NO_FCP/);
  assert.equal(state.mobile.history.length, 1);
  assert.equal(state.key_configured, false);

  // A later failure keeps the last good result.
  assert.equal(await claimTest(env, 1, 2000), true);
  await testSite(env, site, 2000, async () => Response.json({}, { status: 429 }));
  const after = await sitePerformance(env, site, 2001);
  assert.equal(after.mobile.result.scanned_at, 1000);
  assert.match(after.mobile.error, /too many/);
  assert.match(after.mobile.error, /Connect Google/);
});

test("a connected Google account signs the test when no key is saved", async () => {
  resetFieldsCheck();
  const headers = [];
  const fetcher = async (url, init) => {
    headers.push([new URL(url).searchParams.get("key"), new Headers(init?.headers).get("Authorization")]);
    return Response.json(answer());
  };
  await fetchPagespeed("https://a.test/", "mobile", { via: "google", token: "tok" }, 1, fetcher);
  await fetchPagespeed("https://a.test/", "mobile", null, 1, fetcher);
  assert.deepEqual(headers, [
    [null, "Bearer tok"],
    [null, null],
  ]);
});

test("weekly tests need a saved key, skip switched off sites and take the oldest first", async () => {
  resetFieldsCheck();
  const env = setup();
  const tested = [];
  const fetcher = async (url) => {
    tested.push(new URL(url).searchParams.get("url"));
    return Response.json(answer());
  };
  assert.equal(await runScheduledPerformance(env, 10_000_000, fetcher), 0);

  await savePagespeedKey(env, "secret-key");
  env.DB.sqlite.exec("UPDATE sites SET performance_excluded = 1 WHERE id = 1");
  assert.equal(await runScheduledPerformance(env, 10_000_000, fetcher), 1);
  assert.deepEqual(tested, ["https://b.test/", "https://b.test/"]);
  // Tested this week already.
  assert.equal(await runScheduledPerformance(env, 10_000_100, fetcher), 0);
  assert.equal((await sitePerformance(env, { id: 2 })).key_configured, true);
});

test("scores and measurements are banded the way Lighthouse colours them", () => {
  assert.equal(performanceBand(90), "good");
  assert.equal(performanceBand(89), "fair");
  assert.equal(performanceBand(49), "poor");
  assert.equal(labBand("lcp", 2500), "good");
  assert.equal(labBand("lcp", 4001), "poor");
  assert.equal(labBand("cls", 0.15), "fair");
  assert.equal(formatMetric("lcp", 2600), "2.6 s");
  assert.equal(formatMetric("inp", 180), "180 ms");
  assert.equal(formatMetric("cls", 0.05), "0.050");
});
