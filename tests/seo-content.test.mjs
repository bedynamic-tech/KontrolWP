import assert from "node:assert/strict";
import test from "node:test";
import {
  saveSeoContent,
  siteSeoContent,
} from "../src/worker/sites/seo-content.ts";
import { SeoError } from "../src/worker/sites/seo.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";
function setup() {
  const db = fakeD1();
  for (const m of migrations) db.sqlite.exec(m.sql);
  db.sqlite.exec(
    "INSERT INTO sites (id, name, url, key_id, secret) VALUES (1, 'A', 'https://a.test/', 'k', 'x')",
  );
  return { DB: db };
}

const site = (extra = {}) => ({
  id: 1,
  url: "https://a.test/",
  kind: "wordpress",
  plugin_version: "0.21.0",
  ...extra,
});
const credentials = {
  id: 1,
  url: "https://a.test/",
  keyId: "k",
  secret: "c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0MTIzNDU2",
};

test("these settings are refused for static sites, missing keys and old plugins", async () => {
  await assert.rejects(
    siteSeoContent(setup(), site({ kind: "static" }), credentials),
    SeoError,
  );
  await assert.rejects(siteSeoContent(setup(), site(), null), SeoError);
  await assert.rejects(
    siteSeoContent(setup(), site({ plugin_version: "0.20.0" }), credentials),
    /0\.21\.0/,
  );
});

test("reads and saves go to the site", async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path =
      new URL(url).searchParams.get("rest_route") ?? new URL(url).pathname;
    calls.push({ path, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ settings: {} }), {
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await siteSeoContent(setup(), site(), credentials);
    await saveSeoContent(setup(), site(), credentials, { schema: true });
    assert.match(calls[0].path, /seo\/content$/);
    assert.match(calls[1].path, /seo\/content\/save$/);
    assert.deepEqual(calls[1].body, { schema: true });
  } finally {
    globalThis.fetch = real;
  }
});

test("the content settings are kept and a save clears them", async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(
      new URL(url).searchParams.get("rest_route") ?? new URL(url).pathname,
    );
    return new Response(JSON.stringify({ settings: {}, conflict: "" }), {
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const env = setup();
    const s = site({ plugin_version: "0.21.0" });
    await siteSeoContent(env, s, credentials);
    await siteSeoContent(env, s, credentials);
    assert.equal(calls.length, 1);
    await saveSeoContent(env, s, credentials, {});
    await siteSeoContent(env, s, credentials);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = real;
  }
});
