import assert from "node:assert/strict";
import test from "node:test";
import { randomToken } from "../src/shared/protocol.ts";
import { applyMigrations } from "../src/worker/db/migrate.ts";
import { encryptSecret } from "../src/worker/sites/secrets.ts";
import {
  checkLinks,
  checkUrl,
  classify,
  cleanUrl,
  collectLinks,
  ignoreLink,
  listLinks,
  recheckLink,
  startLinkScan,
} from "../src/worker/sites/links.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Answers like the web: each address's status, or a thrown error. */
function web(statuses, calls = []) {
  return async (url, init) => {
    calls.push(`${init.method} ${url}`);
    const answer = statuses[url];
    if (answer instanceof Error) throw answer;
    const status = typeof answer === "function" ? answer(init.method) : (answer ?? 200);
    return new Response(init.method === "HEAD" ? null : "page", { status });
  };
}

test("classify sorts statuses into broken, unresponsive and couldn't check", () => {
  assert.equal(classify(200).status, "ok");
  assert.equal(classify(301).status, "ok");
  assert.equal(classify(404).status, "broken");
  assert.equal(classify(410).status, "broken");
  assert.equal(classify(400).status, "broken");
  assert.equal(classify(403).status, "blocked");
  assert.equal(classify(429).status, "blocked");
  assert.equal(classify(503).status, "unresponsive");
  assert.deepEqual(classify(530), { status: "broken", http_status: null, error: "The domain doesn't exist." });
});

test("checkUrl tries GET when HEAD is refused, and reads failures", async () => {
  const calls = [];
  const fetcher = web(
    {
      "https://a.test/": (method) => (method === "HEAD" ? 405 : 200),
      "https://b.test/gone": 404,
      "https://c.test/": new DOMException("timed out", "TimeoutError"),
      "https://d.test/": Object.assign(new TypeError("fetch failed"), { cause: new Error("getaddrinfo ENOTFOUND d.test") }),
      "https://e.test/": new TypeError("Network connection lost"),
    },
    calls,
  );
  assert.equal((await checkUrl("https://a.test/", fetcher)).status, "ok");
  assert.deepEqual(calls.slice(0, 2), ["HEAD https://a.test/", "GET https://a.test/"]);
  assert.deepEqual(await checkUrl("https://b.test/gone", fetcher), { status: "broken", http_status: 404, error: "Page not found." });
  assert.equal((await checkUrl("https://c.test/", fetcher)).status, "unresponsive");
  assert.equal((await checkUrl("https://d.test/", fetcher)).status, "broken");
  assert.equal((await checkUrl("https://e.test/", fetcher)).status, "unresponsive");
});

test("cleanUrl keeps http(s) addresses without fragments", () => {
  assert.equal(cleanUrl("https://example.com/a#top"), "https://example.com/a");
  assert.equal(cleanUrl("mailto:a@example.com"), null);
  assert.equal(cleanUrl("not a url"), null);
  assert.equal(cleanUrl(42), null);
});

async function setup(pages) {
  const db = fakeD1();
  await applyMigrations(db, migrations);
  const key = randomToken(32);
  db.sqlite.prepare("INSERT INTO sites (id, name, url, key_id, secret) VALUES (1, 'Example', 'https://example.com', 'k', '')").run();
  db.sqlite.prepare("UPDATE sites SET secret = ? WHERE id = 1").run(await encryptSecret(key, 1, randomToken(32)));
  const sent = [];
  const env = { DB: db, SITE_SECRETS_KEY: key, SYNC_QUEUE: { send: async (body) => sent.push(body) } };
  globalThis.fetch = async (url, init) => {
    const route = new URL(url).searchParams.get("rest_route");
    if (route !== "/kontrolwp/v1/links") throw new Error(`unexpected ${route}`);
    const { page } = JSON.parse(init.body);
    return pages ? json(pages[page - 1]) : json({ code: "rest_no_route" }, 404);
  };
  return { db, env, sent };
}

const post = (post_id, title, links) => ({ post_id, title, type: "page", permalink: `https://example.com/p${post_id}/`, links });

test("a scan reads every page of links, checks them, and lists the problems", async () => {
  const { env, sent } = await setup([
    {
      items: [
        post(1, "Home", [
          { url: "https://ok.test/", text: "Fine", kind: "link" },
          { url: "https://gone.test/x#frag", text: "Gone", kind: "link" },
        ]),
      ],
      page: 1,
      total_pages: 2,
      total_posts: 2,
    },
    {
      items: [post(2, "About", [{ url: "https://gone.test/x", text: "", kind: "image" }, { url: "https://slow.test/", text: "Slow", kind: "link" }])],
      page: 2,
      total_pages: 2,
      total_posts: 2,
    },
  ]);
  const scanId = await startLinkScan(env, 1);
  assert.deepEqual(sent.shift(), { type: "links-collect", siteId: 1, scanId, page: 1 });
  await collectLinks(env, 1, scanId, 1);
  assert.deepEqual(sent.shift(), { type: "links-collect", siteId: 1, scanId, page: 2 });
  await collectLinks(env, 1, scanId, 2);
  assert.deepEqual(sent.shift(), { type: "links-check", siteId: 1, scanId });

  const fetcher = web({ "https://gone.test/x": 404, "https://slow.test/": new DOMException("t", "TimeoutError") });
  assert.equal(await checkLinks(env, 1, scanId, fetcher), false);

  const result = await listLinks(env.DB, 1);
  assert.equal(result.scan.status, "done");
  assert.equal(result.scan.total_urls, 3);
  assert.equal(result.scan.checked_urls, 3);
  assert.equal(result.scan.posts_scanned, 2);
  assert.deepEqual(result.counts, { ok: 1, broken: 1, unresponsive: 1, blocked: 0, ignored: 0, total: 3 });
  assert.deepEqual(
    result.links.map((link) => [link.url, link.status, link.refs.map((ref) => `${ref.post_title}:${ref.kind}`)]),
    [
      ["https://gone.test/x", "broken", ["About:image", "Home:link"]],
      ["https://slow.test/", "unresponsive", ["About:link"]],
    ],
  );

  // Ignoring moves a link out of the counts; a recheck after the fix clears it.
  await ignoreLink(env.DB, 1, "https://slow.test/", true);
  assert.equal((await listLinks(env.DB, 1)).counts.ignored, 1);
  assert.equal(await recheckLink(env, 1, "https://gone.test/x", web({})), true);
  assert.equal(await recheckLink(env, 1, "https://never.test/", web({})), false);
  const after = await listLinks(env.DB, 1);
  assert.deepEqual(after.links.map((link) => [link.url, link.ignored]), [["https://slow.test/", true]]);
});

test("a rescan keeps old results until rechecked, drops removed links, and outdated messages do nothing", async () => {
  const pages = [{ items: [post(1, "Home", [{ url: "https://gone.test/", text: "", kind: "link" }])], page: 1, total_pages: 1, total_posts: 1 }];
  const { env, sent } = await setup(pages);
  const first = await startLinkScan(env, 1);
  await collectLinks(env, 1, first, 1);
  await checkLinks(env, 1, first, web({ "https://gone.test/": 404 }));

  pages[0].items[0].links = [{ url: "https://new.test/", text: "", kind: "link" }, { url: "https://gone.test/", text: "", kind: "link" }];
  const second = await startLinkScan(env, 1);
  assert.equal(second, first + 1);
  // A message from the first scan arriving late changes nothing.
  await collectLinks(env, 1, first, 1);
  await collectLinks(env, 1, second, 1);
  const during = await listLinks(env.DB, 1);
  assert.equal(during.scan.status, "checking");
  assert.equal(during.links[0].status, "broken");
  assert.equal(during.counts.total, 2);

  pages[0].items[0].links = [];
  const third = await startLinkScan(env, 1);
  await collectLinks(env, 1, third, 1);
  const empty = await listLinks(env.DB, 1);
  assert.equal(empty.scan.status, "done");
  assert.equal(empty.counts.total, 0);
  assert.ok(sent.length > 0);
});

test("a site without the links route fails the scan with a clear message", async () => {
  const { env } = await setup(null);
  const scanId = await startLinkScan(env, 1);
  await collectLinks(env, 1, scanId, 1);
  const result = await listLinks(env.DB, 1);
  assert.equal(result.scan.status, "failed");
  assert.match(result.scan.error, /too old to list links/);
});

test("a scan that stops making progress shows as stopped", async () => {
  const { env } = await setup([]);
  await startLinkScan(env, 1, 1000);
  const result = await listLinks(env.DB, 1, 1000 + 16 * 60);
  assert.equal(result.scan.status, "stopped");
});

test("Check again drops a link taken out of its posts, and keeps one still there", async () => {
  const content = {
    1: post(1, "Home", [{ url: "https://gone.test/", text: "Gone", kind: "link" }, { url: "https://also.test/", text: "", kind: "link" }]),
    2: post(2, "About", [{ url: "https://also.test/", text: "", kind: "link" }]),
  };
  const { db, env } = await setup([{ items: Object.values(content), page: 1, total_pages: 1, total_posts: 2 }]);
  const scanId = await startLinkScan(env, 1);
  await collectLinks(env, 1, scanId, 1);
  await checkLinks(env, 1, scanId, web({ "https://gone.test/": 404, "https://also.test/": 404 }));
  assert.equal((await listLinks(env.DB, 1)).links.length, 2);

  // The owner removes both links from Home; About still links to also.test.
  content[1] = post(1, "Home", [{ url: "https://new.test/", text: "", kind: "link" }]);
  const asked = [];
  globalThis.fetch = async (_url, init) => {
    const { post_ids } = JSON.parse(init.body);
    asked.push(post_ids);
    return json({ items: post_ids.map((id) => content[id]).filter(Boolean), page: 1, total_pages: 1, total_posts: post_ids.length });
  };

  // A site before 0.9.2 can't list chosen posts: the address is only checked.
  db.sqlite.prepare("UPDATE sites SET plugin_version = '0.9.1' WHERE id = 1").run();
  assert.equal(await recheckLink(env, 1, "https://gone.test/", web({ "https://gone.test/": 404 })), true);
  assert.equal(asked.length, 0);
  assert.equal((await listLinks(env.DB, 1)).links.length, 2);

  db.sqlite.prepare("UPDATE sites SET plugin_version = '0.9.2' WHERE id = 1").run();
  const checked = [];
  assert.equal(await recheckLink(env, 1, "https://gone.test/", web({}, checked)), true);
  assert.deepEqual(asked, [[1]]);
  assert.deepEqual(checked, []);
  let result = await listLinks(env.DB, 1);
  assert.deepEqual(result.links.map((link) => [link.url, link.refs.map((ref) => ref.post_title)]), [["https://also.test/", ["About"]]]);

  // Still linked from About, so it is checked; now it loads.
  assert.equal(await recheckLink(env, 1, "https://also.test/", web({}, checked)), true);
  assert.deepEqual(asked[1], [2]);
  assert.equal(checked.length, 1);
  result = await listLinks(env.DB, 1);
  assert.equal(result.links.length, 0);
  assert.equal(result.counts.ok, 1);
});
