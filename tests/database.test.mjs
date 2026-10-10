import assert from "node:assert/strict";
import test from "node:test";
import { cleanDatabase, siteDatabase } from "../src/worker/sites/database.ts";
import { SeoError } from "../src/worker/sites/seo.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

const site = (extra = {}) => ({ id: 1, url: "https://a.test/", kind: "wordpress", plugin_version: "0.35.0", ...extra });
const credentials = { id: 1, url: "https://a.test/", keyId: "k", secret: "c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0MTIzNDU2" };

function setup() {
  const db = fakeD1();
  for (const m of migrations) db.sqlite.exec(m.sql);
  db.sqlite.exec("INSERT INTO sites (id, name, url, key_id, secret) VALUES (1, 'A', 'https://a.test/', 'k', 'x')");
  return { DB: db };
}

test("database cleanup is refused for static sites, missing keys and old plugins", async () => {
  await assert.rejects(siteDatabase(site({ kind: "static" }), credentials), SeoError);
  await assert.rejects(siteDatabase(site(), null), SeoError);
  await assert.rejects(siteDatabase(site({ plugin_version: "0.34.0" }), credentials), /0\.35\.0/);
});

test("the report and a cleanup go to the site's database routes", async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).searchParams.get("rest_route") ?? new URL(url).pathname;
    calls.push({ path, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    await siteDatabase(site(), credentials);
    const cleanup = { items: ["revisions", "spam_comments"], optimize: true };
    await cleanDatabase(setup(), site(), credentials, cleanup);
    assert.match(calls[0].path, /database$/);
    assert.match(calls[1].path, /database\/clean$/);
    assert.deepEqual(calls[1].body, cleanup);
  } finally {
    globalThis.fetch = real;
  }
});
