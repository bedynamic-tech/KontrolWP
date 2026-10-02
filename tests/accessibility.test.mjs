import assert from "node:assert/strict";
import test from "node:test";
import { accessibilityScore, scoreBand } from "../src/shared/accessibility.ts";
import { analyzePage } from "../src/worker/sites/accessibility-check.ts";
import {
  AccessibilityError,
  linkedPages,
  runScheduledScans,
  scanNow,
  siteAccessibility,
  summarize,
} from "../src/worker/sites/accessibility.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

const good = `<!doctype html><html lang="en"><head><title>Home</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><a href="#main">Skip to content</a><main id="main"><h1>Welcome</h1><h2>Next</h2>
<img src="a.png" alt="A cat"><label for="e">Email</label><input id="e" type="email">
<a href="/about">About us</a><button>Send</button></main></body></html>`;

const rules = (html) => [...new Set(analyzePage(html).map((f) => f.rule))].sort();

test("a well made page has no findings", () => {
  assert.deepEqual(analyzePage(good), []);
});

test("each kind of problem is found", () => {
  const bad = `<html><head><meta name="viewport" content="width=device-width, user-scalable=no">
<meta http-equiv="refresh" content="30"></head><body>
<h3>Skipped</h3><h5></h5>
<img src="a.png"><img src="b.png" alt=""><img src="c.png" role="presentation">
<iframe src="https://x.test"></iframe><video autoplay></video><video autoplay muted></video>
<div tabindex="3"></div><div tabindex="0"></div>
<input type="text"><input type="hidden"><label>Wrapped <input></label>
<a href="https://f.test"><svg></svg></a><a href="/x">Click here</a><a name="anchor"></a>
<button></button><button aria-label="Close"></button></body></html>`;
  assert.deepEqual(rules(bad), [
    "autoplay",
    "button-name",
    "document-title",
    "empty-heading",
    "frame-title",
    "html-lang",
    "image-alt",
    "label",
    "landmark-main",
    "link-name",
    "link-text",
    "meta-refresh",
    "meta-viewport",
    "page-has-heading-one",
    "tabindex",
  ]);
  const count = (rule) => analyzePage(bad).filter((f) => f.rule === rule).length;
  assert.equal(count("image-alt"), 1);
  assert.equal(count("label"), 1);
  assert.equal(count("autoplay"), 1);
  assert.equal(count("link-name"), 1);
  assert.equal(count("button-name"), 1);
});

test("skipped heading levels and a missing skip link are reported", () => {
  const html = `<html lang="en"><head><title>T</title></head><body><main id="main"><h1>A</h1><h3>B</h3></main></body></html>`;
  assert.deepEqual(rules(html), ["heading-order", "skip-link"]);
});

test("names from text, images, titles and svg titles count", () => {
  const html = `<html lang="en"><head><title>T</title></head><body><a href="#main">Skip</a><main id="main"><h1>H</h1>
<a href="/1"><img src="x" alt="Home"></a><a href="/2" title="Two"><i></i></a>
<a href="/3"><svg><title>Three</title></svg></a><button><img src="x" alt="Go"></button>
<script>document.write('<img src="no-alt">')</script><!-- <img src="comment"> --></main></body></html>`;
  assert.deepEqual(analyzePage(html), []);
});

test("scores fall with impact and repetition, and stay between 0 and 100", () => {
  assert.equal(accessibilityScore([]), 100);
  const one = accessibilityScore([{ impact: "critical", count: 1 }]);
  const many = accessibilityScore([{ impact: "critical", count: 30 }]);
  const minor = accessibilityScore([{ impact: "minor", count: 1 }]);
  assert.ok(100 > one && one > many);
  assert.ok(minor > one);
  assert.equal(accessibilityScore(Array(20).fill({ impact: "critical", count: 50 })), 0);
  assert.deepEqual([95, 80, 60, 20].map(scoreBand), ["good", "fair", "poor", "bad"]);
});

test("the home page's own links are the other pages scanned", () => {
  const html = `<a href="/">Home</a><a href="/about">A</a><a href="/about#team">A</a><a href="https://other.test/x">O</a>
<a href="/files/a.pdf">P</a><a href="/wp-login.php">L</a><a href="/blog?page=2">B</a><a href="/contact/">C</a>
<a href="http://example.com/insecure">I</a><a href="/a">1</a><a href="/b">2</a><a href="/c">3</a>`;
  assert.deepEqual(linkedPages(html, "https://example.com/"), [
    "https://example.com/about",
    "https://example.com/contact/",
  ]);
});

test("findings are added up per kind of problem across pages, most serious first", () => {
  const result = summarize([
    {
      url: "https://e.test/",
      findings: [
        { rule: "image-alt", example: "<img a>" },
        { rule: "skip-link", example: "s" },
      ],
    },
    {
      url: "https://e.test/b",
      findings: [
        { rule: "image-alt", example: "<img b>" },
        { rule: "image-alt", example: "<img b>" },
        { rule: "unknown", example: "x" },
      ],
    },
  ]);
  assert.deepEqual(
    result.issues.map((i) => i.rule),
    ["image-alt", "skip-link"],
  );
  assert.equal(result.issues[0].count, 3);
  assert.deepEqual(result.issues[0].pages, ["https://e.test/", "https://e.test/b"]);
  assert.deepEqual(result.issues[0].examples, ["<img a>", "<img b>"]);
});

function setup() {
  const db = fakeD1();
  for (const m of migrations) db.sqlite.exec(m.sql);
  db.sqlite.exec("INSERT INTO sites (id, name, url, key_id, secret) VALUES (1, 'A', 'https://a.test/', 'k', 'x')");
  db.sqlite.exec("INSERT INTO sites (id, name, url, key_id, secret) VALUES (2, 'B', 'https://b.test/', 'k', 'x')");
  return { DB: db };
}

const site = (id, url, extra = {}) => ({ id, url, kind: "wordpress", plugin_version: null, ...extra });

function withFetch(handler, run) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = handler(String(url));
    if (body === null) return new Response("no", { status: 500 });
    const response = new Response(body, { headers: { "Content-Type": "text/html" } });
    Object.defineProperty(response, "url", { value: String(url) });
    return response;
  };
  return run().finally(() => {
    globalThis.fetch = real;
  });
}

test("a scan stores the score, the issues and a history entry", async () => {
  const env = setup();
  const pages = {
    "https://a.test/": `<html lang="en"><head><title>H</title></head><body><main id="m"><h1>H</h1><a href="/p">P</a><img src="x"></main></body></html>`,
    "https://a.test/p": `<html lang="en"><head><title>P</title></head><body><main><h1>P</h1><img src="y"></main></body></html>`,
  };
  await withFetch(
    (url) => pages[url] ?? null,
    () => scanNow(env, site(1, "https://a.test/")),
  );
  const result = await siteAccessibility(env, site(1, "https://a.test/"), null);
  assert.equal(result.scan.pages.length, 2);
  const alt = result.scan.issues.find((i) => i.rule === "image-alt");
  assert.equal(alt.count, 2);
  assert.equal(alt.fix, null);
  assert.ok(result.scan.score < 100);
  assert.equal(result.history.length, 1);
  assert.equal(result.can_fix, false);
});

test("a manual scan is not repeated within half a minute, unless forced", async () => {
  const env = setup();
  let fetches = 0;
  const handler = () => {
    fetches++;
    return `<html lang="en"><head><title>H</title></head><body><main><h1>H</h1></main></body></html>`;
  };
  await withFetch(handler, async () => {
    await scanNow(env, site(1, "https://a.test/"));
    const first = fetches;
    await scanNow(env, site(1, "https://a.test/"));
    assert.equal(fetches, first);
    await scanNow(env, site(1, "https://a.test/"), { force: true });
    assert.ok(fetches > first);
  });
});

test("a home page that cannot be read leaves the last result and records the error", async () => {
  const env = setup();
  await withFetch(
    () => `<html lang="en"><head><title>H</title></head><body><main><h1>H</h1></main></body></html>`,
    () => scanNow(env, site(1, "https://a.test/")),
  );
  await withFetch(
    () => null,
    async () => {
      await assert.rejects(scanNow(env, site(1, "https://a.test/"), { force: true }), AccessibilityError);
    },
  );
  const result = await siteAccessibility(env, site(1, "https://a.test/"), null);
  assert.ok(result.scan);
  assert.match(result.error, /server error/);
});

test("the cron scans one site not scanned in a day per run", async () => {
  const env = setup();
  const now = 10_000_000;
  const ok = () => `<html lang="en"><head><title>H</title></head><body><main><h1>H</h1></main></body></html>`;
  await withFetch(ok, async () => {
    assert.equal(await runScheduledScans(env, now, 0), 1);
    assert.equal(await runScheduledScans(env, now + 60, 0), 1);
    assert.equal(await runScheduledScans(env, now + 120, 0), 0);
    assert.equal(await runScheduledScans(env, now + 86400 + 1, 0), 1);
  });
});

test("the cron skips sites with accessibility checks turned off", async () => {
  const env = setup();
  env.DB.sqlite.exec("UPDATE sites SET accessibility_excluded = 1");
  await withFetch(
    () => {
      throw new Error("should not fetch");
    },
    async () => assert.equal(await runScheduledScans(env, 10_000_000, 0), 0),
  );
  env.DB.sqlite.exec("UPDATE sites SET accessibility_excluded = 0 WHERE id = 1");
  const ok = () => `<html lang="en"><head><title>H</title></head><body><main><h1>H</h1></main></body></html>`;
  await withFetch(ok, async () => assert.equal(await runScheduledScans(env, 10_000_000, 0), 1));
});

test("a site that answers with a server error stops the scan, and sites already in error are skipped", async () => {
  const env = setup();
  env.DB.sqlite.exec("UPDATE sites SET status = 'error' WHERE id = 2");
  let fetched = [];
  const home = `<html lang="en"><head><title>H</title></head><body><main><h1>H</h1><a href="/a">a</a><a href="/b">b</a></main></body></html>`;
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    if (String(url).endsWith("/a")) return new Response("db down", { status: 500 });
    const response = new Response(home, { headers: { "Content-Type": "text/html" } });
    Object.defineProperty(response, "url", { value: String(url) });
    return response;
  };
  try {
    assert.equal(await runScheduledScans(env, 10_000_000, 0), 1);
    assert.deepEqual(fetched, ["https://a.test/", "https://a.test/a"]);
    const result = await siteAccessibility(env, site(1, "https://a.test/"), null);
    assert.equal(result.scan.pages.length, 1);
    fetched = [];
    globalThis.fetch = async () => new Response("down", { status: 503 });
    await assert.rejects(scanNow(env, site(1, "https://a.test/"), { force: true }), /server error/);
  } finally {
    globalThis.fetch = real;
  }
});
