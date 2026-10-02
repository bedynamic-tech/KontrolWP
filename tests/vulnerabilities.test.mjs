import assert from "node:assert/strict";
import test from "node:test";
import { randomToken } from "../src/shared/protocol.ts";
import { applyMigrations } from "../src/worker/db/migrate.ts";
import {
  feedFailure,
  fixesFrom,
  saveFeedKey,
  isAffected,
  pluginSlug,
  refreshFeed,
  rowsFromEntry,
  runScheduledFeedRefresh,
  siteVulnerabilities,
  topLevelEntries,
} from "../src/worker/sites/vulnerabilities.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

const entry = (id, software, extra = {}) => ({
  id,
  title: `Bug ${id}`,
  cve: "CVE-2026-0001",
  cvss: { score: 8.1, rating: "High" },
  software,
  ...extra,
});
const range = (from, to, extra = {}) => ({
  "*": { from_version: from, from_inclusive: true, to_version: to, to_inclusive: true, ...extra },
});
const FEED = {
  a: entry("a", [
    { type: "plugin", slug: "akismet", affected_versions: range("*", "5.0.0"), patched_versions: ["5.0.1"] },
    { type: "plugin", slug: "unused-plugin", affected_versions: range("*", "9.9.9") },
  ]),
  b: entry("b", [{ type: "core", slug: "wordpress", affected_versions: range("6.0", "6.4.1", { to_inclusive: false }) }], {
    cvss: { score: 9.8 },
  }),
  c: entry("c", [{ type: "theme", slug: "twentytwenty", affected_versions: range("*", "9") }]),
};

const streamOf = (text, size) =>
  new ReadableStream({
    start(controller) {
      const bytes = new TextEncoder().encode(text);
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.subarray(i, i + size));
      controller.close();
    },
  });

test("topLevelEntries yields each member however the bytes are split", async () => {
  const text = JSON.stringify({ ...FEED, tricky: { id: "t", title: 'a "} {" \\ b é', software: [] } });
  for (const size of [1, 3, 7, 64, 100_000]) {
    const seen = [];
    for await (const part of topLevelEntries(streamOf(text, size))) seen.push(JSON.parse(part));
    assert.deepEqual(
      seen.map((item) => item.id),
      ["a", "b", "c", "t"],
      `chunk size ${size}`,
    );
    assert.equal(seen[3].title, 'a "} {" \\ b é');
  }
});

test("rowsFromEntry keeps core and wanted plugins and rates by score", () => {
  const wanted = new Set(["akismet"]);
  const a = rowsFromEntry(FEED.a, wanted);
  assert.equal(a.length, 1);
  assert.deepEqual([a[0].slug, a[0].severity, a[0].patched_in], ["akismet", "high", "5.0.1"]);
  const b = rowsFromEntry(FEED.b, wanted);
  assert.deepEqual([b[0].kind, b[0].slug, b[0].severity, b[0].to_inclusive], ["core", "wordpress", "critical", 0]);
  assert.deepEqual(rowsFromEntry(FEED.c, wanted), []);
  assert.deepEqual(rowsFromEntry({ nonsense: true }, wanted), []);
});

test("isAffected honours open ends and inclusive bounds", () => {
  const r = { from_version: "1.2", from_inclusive: 1, to_version: "1.10", to_inclusive: 0 };
  assert.ok(isAffected("1.2", r));
  assert.ok(isAffected("1.9.9", r));
  assert.ok(!isAffected("1.10", r));
  assert.ok(!isAffected("1.1.9", r));
  assert.ok(isAffected("0.1", { ...r, from_version: "*" }));
  assert.ok(isAffected("99", { ...r, to_version: "*" }));
  assert.ok(!isAffected("", r));
});

test("pluginSlug", () => {
  assert.equal(pluginSlug("akismet/akismet.php"), "akismet");
  assert.equal(pluginSlug("hello.php"), "hello");
});

async function setup() {
  const db = fakeD1();
  await applyMigrations(db, migrations);
  db.sqlite
    .prepare("INSERT INTO sites (id, name, url, key_id, secret, wp_version) VALUES (1, 'S', 'https://s.example.com', 'k', 'x', '6.4.0')")
    .run();
  const plugin = db.sqlite.prepare("INSERT INTO site_plugins (site_id, file, name, version, active) VALUES (1, ?, ?, ?, ?)");
  plugin.run("akismet/akismet.php", "Akismet", "4.9", 1);
  plugin.run("other/other.php", "Other", "1.0", 0);
  const feed = (body = JSON.stringify(FEED), status = 200) => async () => new Response(body, { status });
  const env = { DB: db, SITE_SECRETS_KEY: randomToken(32) };
  await saveFeedKey(env, "wf-key-123");
  return { db, env, feed };
}

test("refresh stores matching rows, matches a site and drops rows the feed no longer has", async () => {
  const { db, env, feed } = await setup();
  const state = await refreshFeed(env, 1000, feed());
  assert.equal(state.error, null);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM vulnerabilities").get().n, 2);

  const site = { id: 1, wp_version: "6.4.0" };
  const found = await siteVulnerabilities(env, site);
  assert.deepEqual(found.map((v) => [v.id, v.name, v.severity, v.active]), [
    ["b", "WordPress", "critical", true],
    ["a", "Akismet", "high", true],
  ]);
  assert.equal((await siteVulnerabilities(env, { id: 1, wp_version: "6.4.1" })).length, 1);

  await refreshFeed(env, 2000, feed(JSON.stringify({ a: FEED.a })));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM vulnerabilities").get().n, 1);
});

test("the feed is requested from v3 with the key as a bearer token", async () => {
  const { env } = await setup();
  let seen;
  await refreshFeed(env, 1000, async (url, init) => {
    seen = { url: String(url), auth: init.headers.Authorization };
    return new Response(JSON.stringify(FEED));
  });
  assert.equal(seen.url, "https://www.wordfence.com/api/intelligence/v3/vulnerabilities/scanner");
  assert.equal(seen.auth, "Bearer wf-key-123");
});

test("without a key nothing is downloaded", async () => {
  const { db, env, feed } = await setup();
  db.sqlite.prepare("DELETE FROM settings WHERE name = 'wordfence'").run();
  await assert.rejects(refreshFeed(env, 1000, feed()), /API key/);
  assert.ok(!(await runScheduledFeedRefresh(env, 1000, feed())));
});

test("feed failures name the status", () => {
  assert.match(feedFailure(410), /HTTP 410/);
  assert.match(feedFailure(403), /did not accept the API key \(HTTP 403\)/);
  assert.match(feedFailure(429), /30 minutes/);
});

test("a feed whose entries have no software lists is rejected and keeps what is stored", async () => {
  const { db, env, feed } = await setup();
  await refreshFeed(env, 1000, feed());
  const state = await refreshFeed(env, 2000, feed(JSON.stringify({ x: { id: "x", packages: [] } })));
  assert.match(state.error, /expected format/);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM vulnerabilities").get().n, 2);
});

test("a failed or empty feed keeps what is stored and records the error", async () => {
  const { db, env, feed } = await setup();
  await refreshFeed(env, 1000, feed());
  assert.match((await refreshFeed(env, 2000, feed("{}"))).error, /no entries/);
  assert.match((await refreshFeed(env, 3000, feed("", 503))).error, /HTTP 503/);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM vulnerabilities").get().n, 2);
  const state = await refreshFeed(env, 4000, async () => {
    throw new Error("offline");
  });
  assert.deepEqual([state.updated_at, state.error], [1000, "offline"]);
});

test("the schedule refreshes daily, retries hourly after a failure and skips without WordPress sites", async () => {
  const { db, env, feed } = await setup();
  let calls = 0;
  const counted = async () => {
    calls++;
    return feed()();
  };
  assert.ok(await runScheduledFeedRefresh(env, 1000, counted));
  assert.ok(!(await runScheduledFeedRefresh(env, 1000 + 3600, counted)));
  assert.ok(await runScheduledFeedRefresh(env, 1000 + 86400, counted));
  assert.equal(calls, 2);

  const failing = async () => new Response("", { status: 500 });
  assert.ok(await runScheduledFeedRefresh(env, 200_000, failing));
  assert.ok(!(await runScheduledFeedRefresh(env, 200_000 + 600, failing)));
  assert.ok(await runScheduledFeedRefresh(env, 200_000 + 3600, counted));

  db.sqlite.prepare("DELETE FROM sites").run();
  assert.ok(!(await runScheduledFeedRefresh(env, 900_000, counted)));
});

test("fixesFrom lists every catalog fix with the states the plugin reported", () => {
  const fixes = fixesFrom({ generator: { enabled: true, applied: true }, readme: { applied: true } });
  assert.equal(fixes.length, 9);
  assert.deepEqual(
    fixes.filter((fix) => fix.enabled || fix.applied).map((fix) => [fix.id, fix.enabled, fix.applied]),
    [["generator", true, true], ["readme", false, true]],
  );
});
