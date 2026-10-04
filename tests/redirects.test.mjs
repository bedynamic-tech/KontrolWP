import assert from "node:assert/strict";
import test from "node:test";
import {
  bulkRedirects,
  clearNotFound,
  importRedirects,
  listNotFound,
  listRedirects,
  saveRedirect,
  setRedirectSettings,
} from "../src/worker/sites/redirects.ts";
import { SeoError } from "../src/worker/sites/seo.ts";

const site = (extra = {}) => ({ id: 1, url: "https://a.test/", kind: "wordpress", plugin_version: "0.16.0", ...extra });
const credentials = { id: 1, url: "https://a.test/", keyId: "k", secret: "c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0MTIzNDU2" };
const rule = { source: "/old", match_type: "exact", target: "/new", status_code: 301, enabled: true };

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

test("redirects are refused for static sites, missing keys and old plugins", async () => {
  await assert.rejects(listRedirects(site({ kind: "static" }), credentials, { page: 1, search: "" }), SeoError);
  await assert.rejects(listRedirects(site(), null, { page: 1, search: "" }), SeoError);
  await assert.rejects(
    listRedirects(site({ plugin_version: "0.15.1" }), credentials, { page: 1, search: "" }),
    /0\.16\.0/,
  );
});

test("every call goes to the site, and answers are not kept between calls", async () => {
  await withSite(
    () => ({ items: [], total: 0, log_404: false }),
    async (calls) => {
      await listRedirects(site(), credentials, { page: 1, search: "a" });
      await listRedirects(site(), credentials, { page: 1, search: "a" });
      assert.equal(calls.length, 2);
      assert.match(calls[0].path, /seo\/redirects$/);
      assert.deepEqual(calls[0].body, { page: 1, search: "a" });
    },
  );
});

test("saving sends the rule, with the id when changing one", async () => {
  await withSite(
    () => ({ ok: true }),
    async (calls) => {
      await saveRedirect(site(), credentials, null, rule);
      await saveRedirect(site(), credentials, 7, rule);
      assert.equal("id" in calls[0].body, false);
      assert.equal(calls[1].body.id, 7);
      assert.match(calls[1].path, /seo\/redirect$/);
    },
  );
});

test("bulk, import, settings and the 404 log reach their routes", async () => {
  await withSite(
    (path) => (path.endsWith("/import") ? { added: 1, skipped: 0, errors: [] } : { ok: true, items: [], total: 0 }),
    async (calls) => {
      await bulkRedirects(site(), credentials, "delete", [1, 2]);
      assert.deepEqual(calls[0].body, { action: "delete", ids: [1, 2] });
      assert.deepEqual(await importRedirects(site(), credentials, [rule]), { added: 1, skipped: 0, errors: [] });
      await setRedirectSettings(site(), credentials, true);
      assert.deepEqual(calls[2].body, { log_404: true });
      await listNotFound(site(), credentials, 2);
      assert.deepEqual(calls[3].body, { page: 2 });
      await clearNotFound(site(), credentials);
      assert.match(calls[4].path, /seo\/404s\/clear$/);
    },
  );
});

import {
  deactivateMigrationSource,
  listMigrationSources,
  previewMigration,
  runMigration,
} from "../src/worker/sites/redirects.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

function envWithSite() {
  const db = fakeD1();
  for (const m of migrations) db.sqlite.exec(m.sql);
  db.sqlite.exec("INSERT INTO sites (id, name, url, key_id, secret) VALUES (1, 'A', 'https://a.test/', 'k', 'x')");
  return { DB: db };
}

test("importing needs plugin 0.17.0", async () => {
  await assert.rejects(listMigrationSources(site(), credentials), /0\.17\.0/);
  await assert.rejects(previewMigration(site({ kind: "static" }), credentials, "yoast"), SeoError);
});

test("the import routes send the source and the parts to import", async () => {
  const env = envWithSite();
  await withSite(
    (path) =>
      path.endsWith("/migrate") ? { sources: [{ id: "yoast", name: "Yoast SEO", active: true }] } : { ok: true },
    async (calls) => {
      const s = site({ plugin_version: "0.17.0" });
      assert.equal((await listMigrationSources(s, credentials)).sources[0].id, "yoast");
      await previewMigration(s, credentials, "yoast");
      assert.deepEqual(calls[1].body, { source: "yoast" });
      await runMigration(env, s, credentials, "yoast", { settings: true, pages: false, redirects: true });
      assert.deepEqual(calls[2].body, { source: "yoast", settings: true, pages: false, redirects: true });
      await deactivateMigrationSource(env, s, credentials, "yoast");
      assert.match(calls[3].path, /migrate\/deactivate$/);
    },
  );
});
