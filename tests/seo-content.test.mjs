import assert from "node:assert/strict";
import test from "node:test";
import { saveSeoContent, siteSeoContent } from "../src/worker/sites/seo-content.ts";
import { SeoError } from "../src/worker/sites/seo.ts";

const site = (extra = {}) => ({ id: 1, url: "https://a.test/", kind: "wordpress", plugin_version: "0.21.0", ...extra });
const credentials = { id: 1, url: "https://a.test/", keyId: "k", secret: "c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0MTIzNDU2" };

test("these settings are refused for static sites, missing keys and old plugins", async () => {
  await assert.rejects(siteSeoContent(site({ kind: "static" }), credentials), SeoError);
  await assert.rejects(siteSeoContent(site(), null), SeoError);
  await assert.rejects(siteSeoContent(site({ plugin_version: "0.20.0" }), credentials), /0\.21\.0/);
});

test("reads and saves go to the site", async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).searchParams.get("rest_route") ?? new URL(url).pathname;
    calls.push({ path, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ settings: {} }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    await siteSeoContent(site(), credentials);
    await saveSeoContent(site(), credentials, { schema: true });
    assert.match(calls[0].path, /seo\/content$/);
    assert.match(calls[1].path, /seo\/content\/save$/);
    assert.deepEqual(calls[1].body, { schema: true });
  } finally {
    globalThis.fetch = real;
  }
});
