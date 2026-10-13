import assert from "node:assert/strict";
import test from "node:test";
import { applyMigrations } from "../src/worker/db/migrate.ts";
import { checkLinks, collectLinks, listLinks, PAGES_PER_COLLECT, recheckLink, startLinkScan } from "../src/worker/sites/links.ts";
import { isSitePage, pageId, readPage } from "../src/worker/sites/static-links.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

test("readPage lists links and images made absolute, and keeps header and footer links apart", () => {
  const page = readPage(
    `<html><head><title>About &amp; team</title><script>var a = '<a href="/script">x</a>';</script></head>
<body><header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
<!-- <a href="/commented">old</a> -->
<main><a href="team/">Our <b>team</b></a><a href="#top">Top</a><a href="mailto:a@b.test">Mail</a>
<img src="/img/logo.png" alt="Logo"><a href="https://other.test/x#y">Other</a><a href='team/'>again</a></main>
<footer><a href="/privacy/">Privacy</a></footer></body></html>`,
    "https://example.com/about/",
  );
  assert.equal(page.title, "About & team");
  assert.deepEqual(page.links, [
    { url: "https://example.com/about/team/", text: "Our team", kind: "link" },
    { url: "https://other.test/x", text: "Other", kind: "link" },
    { url: "https://example.com/img/logo.png", text: "Logo", kind: "image" },
  ]);
  assert.deepEqual(page.header.map((link) => link.url), ["https://example.com/", "https://example.com/about"]);
  assert.deepEqual(page.footer.map((link) => link.url), ["https://example.com/privacy/"]);
});

test("only the site's own pages are read, and page ids are stable and positive", () => {
  assert.equal(isSitePage("https://www.example.com/a/", "https://example.com"), true);
  assert.equal(isSitePage("https://example.com/file.pdf", "https://example.com"), false);
  assert.equal(isSitePage("https://other.test/", "https://example.com"), false);
  assert.equal(pageId("https://example.com/a"), pageId("https://example.com/a"));
  assert.notEqual(pageId("https://example.com/a"), pageId("https://example.com/b"));
  assert.ok(pageId("https://example.com/") > 0);
});

const html = (body, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

async function setup(site) {
  const db = fakeD1();
  await applyMigrations(db, migrations);
  db.sqlite.prepare("INSERT INTO sites (id, name, url, secret, kind) VALUES (1, 'Docs', 'https://docs.test', '', 'static')").run();
  const sent = [];
  const env = { DB: db, SYNC_QUEUE: { send: async (body) => sent.push(body) } };
  const fetched = [];
  const fetcher = async (url) => {
    fetched.push(url);
    const answer = site[url];
    if (answer === undefined) return new Response("missing", { status: 404 });
    return typeof answer === "string" ? html(answer) : answer;
  };
  return { env, sent, fetched, fetcher };
}

const layout = (title, main) =>
  `<title>${title}</title><header><a href="/">Docs</a><a href="/old-nav">Old</a></header><main>${main}</main>`;

test("a static site scan reads its pages, follows its own links, and checks what it found", async () => {
  const site = {
    "https://docs.test/robots.txt": new Response("", { status: 404 }),
    "https://docs.test/sitemap.xml": new Response(
      "<urlset><url><loc>https://docs.test/</loc></url><url><loc>https://docs.test/guide/</loc></url></urlset>",
      { headers: { "Content-Type": "application/xml" } },
    ),
    "https://docs.test/": html(layout("Home", `<a href="/guide/">Guide</a><a href="/hidden/">Hidden</a>`)),
    "https://docs.test/guide/": html(layout("Guide", `<a href="https://gone.test/x">Gone</a><img src="/missing.png" alt="Diagram">`)),
    // Not in the sitemap: found through the home page's link.
    "https://docs.test/hidden/": html(layout("Hidden", `<a href="https://gone.test/x">Gone again</a>`)),
  };
  const { env, sent, fetched, fetcher } = await setup(site);
  const scanId = await startLinkScan(env, 1);
  sent.shift();
  await collectLinks(env, 1, scanId, 1, fetcher);
  // The home page links to a page the sitemap leaves out, and one message reads that too.
  assert.deepEqual(sent.shift(), { type: "links-check", siteId: 1, scanId });
  assert.ok(!fetched.includes("https://docs.test/missing.png"));

  const scan = (await listLinks(env.DB, 1)).scan;
  // Home, Guide, Hidden, and the header's missing page, which is read and found not to be a page.
  assert.equal(scan.posts_scanned, 4);
  assert.equal(scan.status, "checking");

  const check = async (url) => new Response(null, { status: ["https://gone.test/x", "https://docs.test/missing.png", "https://docs.test/old-nav"].includes(url) ? 404 : 200 });
  while (await checkLinks(env, 1, scanId, check));
  const result = await listLinks(env.DB, 1);
  assert.equal(result.scan.status, "done");
  assert.deepEqual(
    result.links.map((link) => [link.url, link.refs.map((ref) => `${ref.post_title}:${ref.kind}`)]),
    [
      ["https://docs.test/missing.png", ["Guide:image"]],
      ["https://docs.test/old-nav", ["Header:link"]],
      ["https://gone.test/x", ["Guide:link", "Hidden:link"]],
    ],
  );

  // After the link is taken out of a page, checking it again re-reads the pages it was on.
  site["https://docs.test/guide/"] = html(layout("Guide", `<img src="/missing.png" alt="Diagram">`));
  site["https://docs.test/hidden/"] = html(layout("Hidden", `<p>Fixed</p>`));
  const both = (url) => (site[url] ? fetcher(url) : check(url));
  assert.equal(await recheckLink(env, 1, "https://gone.test/x", both), true);
  assert.deepEqual(
    (await listLinks(env.DB, 1)).links.map((link) => link.url),
    ["https://docs.test/missing.png", "https://docs.test/old-nav"],
  );
});

test("a large static site is read a few pages per message", async () => {
  const links = Array.from({ length: PAGES_PER_COLLECT + 5 }, (_, i) => `<a href="/p${i}/">P${i}</a>`).join("");
  const site = { "https://docs.test/": html(`<title>Home</title>${links}`) };
  for (let i = 0; i < PAGES_PER_COLLECT + 5; i++) site[`https://docs.test/p${i}/`] = html(`<title>P${i}</title>`);
  const { env, sent, fetcher } = await setup(site);
  const scanId = await startLinkScan(env, 1);
  sent.shift();
  await collectLinks(env, 1, scanId, 1, fetcher);
  assert.deepEqual(sent.shift(), { type: "links-collect", siteId: 1, scanId, page: 2 });
  assert.equal((await listLinks(env.DB, 1)).scan.posts_scanned, PAGES_PER_COLLECT);
  await collectLinks(env, 1, scanId, 2, fetcher);
  assert.deepEqual(sent.shift(), { type: "links-check", siteId: 1, scanId });
  assert.equal((await listLinks(env.DB, 1)).scan.posts_scanned, PAGES_PER_COLLECT + 6);
});
