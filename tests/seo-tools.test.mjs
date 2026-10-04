import assert from "node:assert/strict";
import test from "node:test";
import { saveSeoTools, siteSeoTools } from "../src/worker/sites/seo-tools.ts";
import { SeoError } from "../src/worker/sites/seo.ts";

const site = (extra = {}) => ({ id: 1, url: "https://a.test/", kind: "wordpress", plugin_version: "0.20.0", ...extra });
const credentials = { id: 1, url: "https://a.test/", keyId: "k", secret: "c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0MTIzNDU2" };
const settings = {
  verify: { google: "g", bing: "", yandex: "", baidu: "", pinterest: "" },
  robots_mode: "default",
  robots_text: "",
  llms_mode: "auto",
  llms_text: "",
  indexnow: false,
};

test("the tools are refused for static sites, missing keys and old plugins", async () => {
  await assert.rejects(siteSeoTools(site({ kind: "static" }), credentials), SeoError);
  await assert.rejects(siteSeoTools(site(), null), SeoError);
  await assert.rejects(siteSeoTools(site({ plugin_version: "0.19.0" }), credentials), /0\.20\.0/);
});

test("reads and saves go to the site each time", async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).searchParams.get("rest_route") ?? new URL(url).pathname;
    calls.push({ path, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ settings }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    await siteSeoTools(site(), credentials);
    await siteSeoTools(site(), credentials);
    await saveSeoTools(site(), credentials, settings);
    assert.equal(calls.length, 3);
    assert.match(calls[0].path, /seo\/tools$/);
    assert.match(calls[2].path, /seo\/tools\/save$/);
    assert.deepEqual(calls[2].body, settings);
  } finally {
    globalThis.fetch = real;
  }
});
