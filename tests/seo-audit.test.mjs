import assert from "node:assert/strict";
import test from "node:test";
import { seoScore } from "../src/shared/seo-audit.ts";
import { analyzeSeoPage } from "../src/worker/sites/seo-audit-check.ts";
import {
  SeoAuditError,
  blocksEverything,
  runScheduledSeoScans,
  sample,
  scanSeoNow,
  siteSeoAudit,
  summarizeSeo,
} from "../src/worker/sites/seo-audit.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

const good = `<!doctype html><html lang="en"><head><title>Cloud hosting for small teams</title>
<meta name="description" content="Fast, simple cloud hosting for small teams, with daily backups, free migration and support from real people.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://a.test/">
<meta property="og:title" content="Cloud"><meta property="og:description" content="Hosting"><meta property="og:image" content="https://a.test/i.png">
<script type="application/ld+json">{"@type":"WebSite"}</script></head>
<body><h1>Cloud hosting</h1><p>Hello</p></body></html>`;

const rules = (html, url = "https://a.test/") =>
  analyzeSeoPage(html, url)
    .findings.map((f) => f.rule)
    .sort();

test("a well made page has no findings", () => {
  assert.deepEqual(rules(good), []);
});

test("each kind of page problem is found", () => {
  assert.deepEqual(rules("<html><head></head><body><p>x</p></body></html>"), [
    "canonical-missing",
    "description-missing",
    "h1-missing",
    "social-tags",
    "structured-data",
    "title-missing",
    "viewport",
  ]);
  const odd = good
    .replace("Cloud hosting for small teams", "Hi")
    .replace(/content="Fast[^"]*"/, 'content="Short"')
    .replace('https://a.test/"', 'https://other.test/"')
    .replace("<body>", "<body><h1>Two</h1>")
    .replace("<head>", '<head><meta name="robots" content="noindex, follow">');
  assert.deepEqual(rules(odd), [
    "canonical-offsite",
    "description-length",
    "h1-multiple",
    "noindex",
    "title-length",
  ]);
});

test("a canonical link on the same site, with or without www, is fine", () => {
  assert.deepEqual(
    rules(good.replace('https://a.test/"', 'https://www.a.test/page"')),
    [],
  );
});

test("a robots.txt that blocks everyone is found, one that blocks a folder is not", () => {
  assert.equal(blocksEverything("User-agent: *\nDisallow: /"), true);
  assert.equal(
    blocksEverything(
      "User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin",
    ),
    false,
  );
  assert.equal(blocksEverything("User-agent: *\nAllow: /\n"), false);
  assert.equal(blocksEverything("# nothing\n"), false);
});

test("a long list is sampled across its length", () => {
  assert.deepEqual(sample([1, 2, 3], 4), [1, 2, 3]);
  assert.deepEqual(sample([1, 2, 3, 4, 5, 6, 7, 8], 4), [1, 3, 5, 7]);
});

test("pages that share a title or description are reported once per page, and the score drops", () => {
  const a = {
    url: "https://a.test/",
    title: "Same",
    description: "d1",
    findings: [],
  };
  const b = {
    url: "https://a.test/b",
    title: "Same",
    description: "d2",
    findings: [],
  };
  const c = {
    url: "https://a.test/c",
    title: "Other",
    description: "d2",
    findings: [],
  };
  const result = summarizeSeo(
    [a, b, c],
    [{ rule: "robots-missing", example: "r" }],
    ["https://a.test/gone"],
  );
  const byRule = Object.fromEntries(result.issues.map((i) => [i.rule, i]));
  assert.deepEqual(byRule["title-duplicate"].pages, [
    "https://a.test/",
    "https://a.test/b",
  ]);
  assert.deepEqual(byRule["description-duplicate"].pages, [
    "https://a.test/b",
    "https://a.test/c",
  ]);
  assert.deepEqual(byRule["broken-pages"].pages, ["https://a.test/gone"]);
  assert.equal(result.issues[0].rule, "broken-pages");
  assert.equal(seoScore([]), 100);
  assert.ok(
    seoScore(
      result.issues.map((i) => ({
        impact: i.rule === "broken-pages" ? "high" : "low",
        count: i.count,
      })),
    ) < 100,
  );
});

function setup() {
  const db = fakeD1();
  for (const m of migrations) db.sqlite.exec(m.sql);
  db.sqlite.exec(
    "INSERT INTO sites (id, name, url, key_id, secret, kind) VALUES (1, 'A', 'https://a.test/', 'k', '', 'static')",
  );
  db.sqlite.exec(
    "INSERT INTO sites (id, name, url, key_id, secret, kind) VALUES (2, 'B', 'https://b.test/', 'k', 'x', 'wordpress')",
  );
  return { DB: db };
}

const site = (id, url) => ({ id, url, kind: "static" });

/** `routes` maps an address to [status, body, type]; anything else answers 404. */
function withFetch(routes, run) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const route =
      typeof routes === "function" ? routes(String(url)) : routes[String(url)];
    if (route === null) throw new TypeError("down");
    const [status, body, type] = route ?? [404, "not found", "text/plain"];
    const response = new Response(body, {
      status,
      headers: { "Content-Type": type ?? "text/html" },
    });
    Object.defineProperty(response, "url", { value: String(url) });
    return response;
  };
  return run().finally(() => {
    globalThis.fetch = real;
  });
}

const sitemap = `<?xml version="1.0"?><urlset><url><loc>https://a.test/</loc></url><url><loc>https://a.test/about</loc></url><url><loc>https://a.test/gone</loc></url></urlset>`;
const routes = {
  "https://a.test/": [200, good],
  "https://a.test/about": [
    200,
    good
      .replace("Cloud hosting for small teams", "About us and our small team")
      .replace("Fast, simple cloud hosting", "Meet the people behind our cloud hosting"),
  ],
  "https://a.test/robots.txt": [
    200,
    "User-agent: *\nDisallow: /\nSitemap: https://a.test/sitemap.xml",
    "text/plain",
  ],
  "https://a.test/sitemap.xml": [200, sitemap, "application/xml"],
};

test("a check stores the score, the recommendations and a history entry", async () => {
  const env = setup();
  await withFetch(routes, () => scanSeoNow(env, site(1, "https://a.test/")));
  const result = await siteSeoAudit(env, site(1, "https://a.test/"));
  assert.equal(result.scan.pages.length, 2);
  const found = result.scan.issues.map((i) => i.rule).sort();
  assert.deepEqual(found, ["broken-pages", "robots-blocks-all"]);
  assert.ok(result.scan.issues[0].help.length > 10);
  assert.ok(result.scan.score < 100);
  assert.equal(result.history.length, 1);
});

test("a site that answers 200 for a made-up address, with no robots.txt or sitemap, is reported", async () => {
  const env = setup();
  await withFetch(
    (url) =>
      url.includes("robots") || url.includes("sitemap")
        ? undefined
        : [200, good],
    () => scanSeoNow(env, site(1, "https://a.test/")),
  );
  const result = await siteSeoAudit(env, site(1, "https://a.test/"));
  assert.deepEqual(result.scan.issues.map((i) => i.rule).sort(), [
    "robots-missing",
    "sitemap-missing",
    "soft-404",
  ]);
});

test("a check is not repeated within half a minute, unless forced", async () => {
  const env = setup();
  let fetches = 0;
  await withFetch(
    (url) => {
      fetches++;
      return routes[url];
    },
    async () => {
      await scanSeoNow(env, site(1, "https://a.test/"));
      const first = fetches;
      await scanSeoNow(env, site(1, "https://a.test/"));
      assert.equal(fetches, first);
      await scanSeoNow(env, site(1, "https://a.test/"), { force: true });
      assert.ok(fetches > first);
    },
  );
});

test("a home page that cannot be read keeps the last result and records the error", async () => {
  const env = setup();
  await withFetch(routes, () => scanSeoNow(env, site(1, "https://a.test/")));
  await withFetch(
    () => [503, "down"],
    async () => {
      await assert.rejects(
        scanSeoNow(env, site(1, "https://a.test/"), { force: true }),
        SeoAuditError,
      );
    },
  );
  const result = await siteSeoAudit(env, site(1, "https://a.test/"));
  assert.ok(result.scan);
  assert.match(result.error, /HTTP 503/);
});

test("the cron checks one static site per run and never a WordPress one", async () => {
  const env = setup();
  const now = 10_000_000;
  await withFetch(routes, async () => {
    assert.equal(await runScheduledSeoScans(env, now, 0), 1);
    assert.equal(await runScheduledSeoScans(env, now + 60, 0), 0);
    assert.equal(await runScheduledSeoScans(env, now + 86400 + 1, 0), 1);
  });
});
