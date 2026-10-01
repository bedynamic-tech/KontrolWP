import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { parseSitemap, readSitemap } from "../src/worker/sites/sitemap.ts";

const urlset = (...entries) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries
    .map(([loc, lastmod]) => `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`)
    .join("")}</urlset>`;

/** A fake web: path to body (string, Uint8Array or a status number). */
function web(files, calls = []) {
  return async (url) => {
    calls.push(url);
    const file = files[url];
    if (file === undefined || typeof file === "number") return new Response("missing", { status: file ?? 404 });
    return new Response(file, { status: 200 });
  };
}

test("parseSitemap reads pages and index entries, decoding entities and CDATA", () => {
  const page = parseSitemap(urlset(["https://a.test/x?a=1&amp;b=2", "2026-09-30"], ["<![CDATA[https://a.test/y]]>"]));
  assert.deepEqual(page.pages, [
    { url: "https://a.test/x?a=1&b=2", lastmod: "2026-09-30" },
    { url: "https://a.test/y", lastmod: null },
  ]);
  const index = parseSitemap(
    `<sitemapindex><sitemap><loc>https://a.test/p.xml</loc></sitemap><sitemap><loc>https://a.test/q.xml</loc></sitemap></sitemapindex>`,
  );
  assert.deepEqual(index, { sitemaps: ["https://a.test/p.xml", "https://a.test/q.xml"], pages: [] });
  assert.equal(parseSitemap("<html>not a sitemap</html>"), null);
});

test("a sitemap named in robots.txt is read, following its index and keeping only the site's own pages", async () => {
  const calls = [];
  const sitemap = await readSitemap(
    "https://www.example.com/",
    web(
      {
        "https://www.example.com/robots.txt":
          "User-agent: *\nSitemap: https://example.com/map.xml\nSitemap: https://evil.test/map.xml",
        "https://example.com/map.xml": `<sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap><sitemap><loc>https://evil.test/b.xml</loc></sitemap></sitemapindex>`,
        "https://example.com/a.xml": urlset(
          ["https://example.com/", "2026-10-01T10:00:00Z"],
          ["https://other.test/x"],
          ["https://www.example.com/about"],
        ),
      },
      calls,
    ),
  );
  assert.equal(sitemap.sitemap_url, "https://example.com/map.xml");
  assert.deepEqual(
    sitemap.items.map((page) => page.url),
    ["https://example.com/", "https://www.example.com/about"],
  );
  assert.equal(sitemap.total, 2);
  assert.equal(sitemap.error, null);
  assert.ok(!calls.some((url) => url.includes("evil.test")), "other hosts are never fetched");
});

test("without robots.txt, /sitemap.xml and then /sitemap_index.xml are tried; gzip files are read", async () => {
  const first = await readSitemap(
    "https://example.com",
    web({ "https://example.com/sitemap_index.xml": urlset(["https://example.com/one"]) }),
  );
  assert.equal(first.sitemap_url, "https://example.com/sitemap_index.xml");
  assert.equal(first.items.length, 1);

  const zipped = await readSitemap(
    "https://example.com",
    web({
      "https://example.com/robots.txt": "Sitemap: https://example.com/map.xml.gz",
      "https://example.com/map.xml.gz": gzipSync(urlset(["https://example.com/z"])),
    }),
  );
  assert.deepEqual(zipped.items, [{ url: "https://example.com/z", lastmod: null }]);
});

test("a site with no sitemap says so", async () => {
  const sitemap = await readSitemap("https://example.com", web({}));
  assert.deepEqual(sitemap, { sitemap_url: null, items: [], total: 0, truncated: false, error: "No sitemap found" });
});
