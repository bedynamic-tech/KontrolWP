import assert from "node:assert/strict";
import test from "node:test";
import { cachedDomain } from "../src/worker/domain-cache.ts";
import { fetchIcon, isProxyableIconUrl } from "../src/worker/icon-proxy.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

test("only public https addresses are proxied", () => {
  assert.ok(isProxyableIconUrl("https://example.com/favicon.ico"));
  for (const bad of [
    undefined,
    "",
    "http://example.com/a.png",
    "https://127.0.0.1/a.png",
    "https://localhost/a.png",
    "https://example.com:8443/a.png",
    "https://user:pw@example.com/a.png",
    "https://[::1]/a.png",
    "nonsense",
  ]) {
    assert.equal(isProxyableIconUrl(bad), null, String(bad));
  }
});

test("icons are cached for a week, and non-images and oversized files are refused", async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
    const ok = await fetchIcon(new URL("https://example.com/a.png"));
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("Cache-Control"), /max-age=604800/);
    globalThis.fetch = async () => new Response("<html>", { headers: { "Content-Type": "text/html" } });
    assert.equal((await fetchIcon(new URL("https://example.com/a.png"))).status, 404);
    globalThis.fetch = async () =>
      new Response(new Uint8Array(600 * 1024), { headers: { "Content-Type": "image/png" } });
    assert.equal((await fetchIcon(new URL("https://example.com/a.png"))).status, 404);
    globalThis.fetch = async () => {
      throw new Error("down");
    };
    assert.equal((await fetchIcon(new URL("https://example.com/a.png"))).status, 404);
  } finally {
    globalThis.fetch = real;
  }
});

test("a domain lookup is kept for a day unless refreshed", async () => {
  const db = fakeD1();
  for (const m of migrations) db.sqlite.exec(m.sql);
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("{}", { status: 500 });
  };
  try {
    const now = Date.UTC(2026, 9, 1);
    await cachedDomain(db, 1, "https://example.com", false, now);
    const first = calls;
    assert.ok(first > 0);
    await cachedDomain(db, 1, "https://example.com", false, now + 3600_000);
    assert.equal(calls, first);
    await cachedDomain(db, 1, "https://example.com", true, now + 3600_000);
    assert.ok(calls > first);
    const before = calls;
    await cachedDomain(db, 1, "https://example.com", false, now + 3600_000 + 25 * 3600_000);
    assert.ok(calls > before);
  } finally {
    globalThis.fetch = real;
  }
});
