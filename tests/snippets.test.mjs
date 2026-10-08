import assert from "node:assert/strict";
import test from "node:test";
import { saveSnippets, siteSnippets } from "../src/worker/sites/snippets.ts";
import { SeoError } from "../src/worker/sites/seo.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

const site = (extra = {}) => ({ id: 1, url: "https://a.test/", kind: "wordpress", plugin_version: "0.29.0", ...extra });
const credentials = { id: 1, url: "https://a.test/", keyId: "k", secret: "c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0MTIzNDU2" };
const settings = {
  skip_editors: true,
  snippets: [{ id: "abc123def0", name: "GA", code: "<script></script>", location: "head", enabled: true, scope: "all", paths: [] }],
};

function setup() {
  const db = fakeD1();
  for (const m of migrations) db.sqlite.exec(m.sql);
  db.sqlite.exec("INSERT INTO sites (id, name, url, key_id, secret) VALUES (1, 'A', 'https://a.test/', 'k', 'x')");
  return { DB: db };
}

test("snippets are refused for static sites, missing keys and old plugins", async () => {
  await assert.rejects(siteSnippets(setup(), site({ kind: "static" }), credentials), SeoError);
  await assert.rejects(siteSnippets(setup(), site(), null), SeoError);
  await assert.rejects(siteSnippets(setup(), site({ plugin_version: "0.28.0" }), credentials), /0\.29\.0/);
});

test("snippets are kept, a save goes to the site and clears them", async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).searchParams.get("rest_route") ?? new URL(url).pathname;
    calls.push({ path, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ settings, limits: {} }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    const env = setup();
    await siteSnippets(env, site(), credentials);
    await siteSnippets(env, site(), credentials);
    assert.equal(calls.length, 1);
    await saveSnippets(env, site(), credentials, settings);
    assert.equal(calls.length, 2);
    assert.match(calls[0].path, /snippets$/);
    assert.match(calls[1].path, /snippets\/save$/);
    assert.deepEqual(calls[1].body, settings);
    await siteSnippets(env, site(), credentials);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = real;
  }
});
