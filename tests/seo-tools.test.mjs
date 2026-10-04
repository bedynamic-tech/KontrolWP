import assert from "node:assert/strict";
import test from "node:test";
import { saveSeoTools, siteSeoTools } from "../src/worker/sites/seo-tools.ts";
import { SeoError } from "../src/worker/sites/seo.ts";

const site = (extra = {}) => ({
  id: 1,
  url: "https://a.test/",
  kind: "wordpress",
  plugin_version: "0.20.0",
  ...extra,
});
const credentials = {
  id: 1,
  url: "https://a.test/",
  keyId: "k",
  secret: "c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0MTIzNDU2",
};
const settings = {
  verify: { google: "g", bing: "", yandex: "", baidu: "", pinterest: "" },
  robots_mode: "default",
  robots_text: "",
  llms_mode: "auto",
  llms_text: "",
  indexnow: false,
};

test("the tools are refused for static sites, missing keys and old plugins", async () => {
  await assert.rejects(
    siteSeoTools(setup(), site({ kind: "static" }), credentials),
    SeoError,
  );
  await assert.rejects(siteSeoTools(setup(), site(), null), SeoError);
  await assert.rejects(
    siteSeoTools(setup(), site({ plugin_version: "0.19.0" }), credentials),
    /0\.20\.0/,
  );
});

test("the tools are kept, a save goes to the site and clears them", async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path =
      new URL(url).searchParams.get("rest_route") ?? new URL(url).pathname;
    calls.push({ path, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ settings }), {
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const env = setup();
    await siteSeoTools(env, site(), credentials);
    await siteSeoTools(env, site(), credentials);
    assert.equal(calls.length, 1);
    await saveSeoTools(env, site(), credentials, settings);
    assert.equal(calls.length, 2);
    assert.match(calls[0].path, /seo\/tools$/);
    assert.match(calls[1].path, /seo\/tools\/save$/);
    assert.deepEqual(calls[1].body, settings);
    await siteSeoTools(env, site(), credentials);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = real;
  }
});

import { probeFile } from "../src/worker/sites/seo-tools.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";
function setup() {
  const db = fakeD1();
  for (const m of migrations) db.sqlite.exec(m.sql);
  db.sqlite.exec(
    "INSERT INTO sites (id, name, url, key_id, secret) VALUES (1, 'A', 'https://a.test/', 'k', 'x')",
  );
  return { DB: db };
}

async function probeWith(response) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => response;
  try {
    return await probeFile("https://a.test/llms.txt");
  } finally {
    globalThis.fetch = real;
  }
}

test("a file served as plain text passes the live check", async () => {
  const check = await probeWith(
    new Response("# Acme", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }),
  );
  assert.equal(check.ok, true);
});

test("a redirect is reported with where it goes", async () => {
  const check = await probeWith(
    new Response(null, {
      status: 301,
      headers: { Location: "https://a.test/" },
    }),
  );
  assert.equal(check.ok, false);
  assert.match(check.detail, /redirects it to https:\/\/a\.test\//);
});

test("a page or an error is not the file", async () => {
  assert.match(
    (
      await probeWith(
        new Response("<html>", { headers: { "Content-Type": "text/html" } }),
      )
    ).detail,
    /text\/html/,
  );
  assert.match(
    (await probeWith(new Response("no", { status: 404 }))).detail,
    /404/,
  );
});
