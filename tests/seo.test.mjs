import assert from "node:assert/strict";
import test from "node:test";
import { listSeoPages, saveSeoPage, saveSeoSettings, SeoError, siteSeo } from "../src/worker/sites/seo.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

function setup() {
  const db = fakeD1();
  for (const m of migrations) db.sqlite.exec(m.sql);
  db.sqlite.exec("INSERT INTO sites (id, name, url, key_id, secret) VALUES (1, 'A', 'https://a.test/', 'k', 'x')");
  return { DB: db };
}

const site = (extra = {}) => ({ id: 1, url: "https://a.test/", kind: "wordpress", plugin_version: "0.15.0", ...extra });
const credentials = { id: 1, url: "https://a.test/", keyId: "k", secret: "c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0MTIzNDU2" };
const settings = {
  enabled: true,
  separator: "|",
  title_template: "%title%",
  home_title: "",
  home_description: "",
  og_enabled: true,
  og_image: "",
  twitter_card: "summary",
  twitter_site: "",
  noindex_search: true,
  noindex_author: false,
  noindex_date: true,
  canonical: true,
  sitemap: true,
};

async function withSite(handler, run) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).searchParams.get("rest_route") ?? new URL(url).pathname;
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(handler(path)), { headers: { "Content-Type": "application/json" } });
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test("SEO is refused for static sites, missing keys and old plugins", async () => {
  const env = setup();
  await assert.rejects(siteSeo(env, site({ kind: "static" }), credentials), SeoError);
  await assert.rejects(siteSeo(env, site(), null), SeoError);
  await assert.rejects(siteSeo(env, site({ plugin_version: "0.14.0" }), credentials), /0\.15\.0/);
  await assert.rejects(siteSeo(env, site({ plugin_version: null }), credentials), SeoError);
});

test("settings are read once and kept, and saving clears what was kept", async () => {
  const env = setup();
  const report = {
    settings,
    conflict: "",
    site_name: "A",
    tagline: "",
    home_url: "https://a.test/",
    discouraged: false,
  };
  await withSite(
    () => report,
    async (calls) => {
      assert.deepEqual(await siteSeo(env, site(), credentials), report);
      await siteSeo(env, site(), credentials);
      assert.equal(calls.length, 1);
      assert.match(calls[0].path, /\/seo$/);
      await saveSeoSettings(env, site(), credentials, settings);
      assert.equal(calls[1].method, "POST");
      assert.match(calls[1].path, /\/seo\/settings$/);
      assert.deepEqual(calls[1].body, settings);
      await siteSeo(env, site(), credentials);
      assert.equal(calls.length, 3);
    },
  );
});

test("page lists are kept per page and search, and saving a page clears them", async () => {
  const env = setup();
  await withSite(
    () => ({ items: [], total: 0 }),
    async (calls) => {
      await listSeoPages(env, site(), credentials, 1, "");
      await listSeoPages(env, site(), credentials, 1, "");
      await listSeoPages(env, site(), credentials, 2, "");
      await listSeoPages(env, site(), credentials, 1, "about");
      assert.equal(calls.length, 3);
      assert.deepEqual(calls[2].body, { page: 1, search: "about" });
      await saveSeoPage(env, site(), credentials, 7, { description: "Hi", noindex: true });
      assert.deepEqual(calls[3].body, { id: 7, description: "Hi", noindex: true });
      await listSeoPages(env, site(), credentials, 1, "");
      assert.equal(calls.length, 5);
    },
  );
});
