import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  decodeConnectionKey,
  encodeConnectionKey,
  normalizeSiteUrl,
  randomToken,
  restUrl,
  signedHeaders,
} from "../src/shared/protocol.ts";

const hasPhp = spawnSync("php", ["-v"]).status === 0;

function php(input) {
  const result = spawnSync("php", ["tests/php/verify.php"], { input: JSON.stringify(input), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("connection keys round-trip and reject anything else", () => {
  const key = { siteId: 7, secret: randomToken(32), dashboard: "https://presser.example.com" };
  const encoded = encodeConnectionKey(key);
  assert.match(encoded, /^presser1\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeConnectionKey(`  ${encoded}\n`), key);
  assert.equal(decodeConnectionKey("presser1.not-json"), null);
  assert.equal(decodeConnectionKey(encoded.slice("presser1.".length)), null);
});

test("site URLs must be public https addresses", () => {
  assert.equal(normalizeSiteUrl("https://example.com/"), "https://example.com");
  assert.equal(normalizeSiteUrl(" https://example.com/blog/?x=1#top "), "https://example.com/blog");
  for (const bad of ["http://example.com", "https://localhost", "https://10.0.0.1", "https://[::1]", "https://user:pw@example.com", "https://example.com:8443", "ftp://example.com", "nope"]) {
    assert.equal(normalizeSiteUrl(bad), null, bad);
  }
});

test("REST URLs use rest_route so any permalink setting works", () => {
  assert.equal(restUrl("https://example.com", "/presser/v1/status"), "https://example.com/?rest_route=%2Fpresser%2Fv1%2Fstatus");
  assert.equal(restUrl("https://example.com/blog", "/presser/v1/status"), "https://example.com/blog/?rest_route=%2Fpresser%2Fv1%2Fstatus");
});

test("the plugin decodes dashboard connection keys", { skip: !hasPhp && "php is not installed" }, () => {
  const secret = randomToken(32);
  const parsed = php({ connection_key: encodeConnectionKey({ siteId: 3, secret, dashboard: "https://presser.example.com" }) });
  assert.deepEqual(parsed, { site_id: 3, secret, dashboard: "https://presser.example.com" });
  assert.deepEqual(php({ connection_key: "presser1.e30" }), { error: "presser_invalid_key" });
});

test("the plugin accepts dashboard signatures and rejects tampering", { skip: !hasPhp && "php is not installed" }, async () => {
  const secret = randomToken(32);
  const connection = { site_id: 5, secret, dashboard: "https://presser.example.com", connected_at: 0 };
  const route = "/presser/v1/comments/moderate";
  const body = JSON.stringify({ id: 12, action: "approve" });
  const sign = (overrides = {}) => signedHeaders({ siteId: 5, secret, method: "POST", route, body, ...overrides });

  const valid = await sign();
  const replayed = { ...valid };
  const stale = await sign({ now: Math.floor(Date.now() / 1000) - 600 });
  const otherSite = await signedHeaders({ siteId: 6, secret, method: "POST", route, body });
  const otherSecret = await sign({ secret: randomToken(32) });
  const unsigned = {};

  const results = php({
    connection,
    requests: [
      { method: "POST", route, body, headers: valid },
      { method: "POST", route, body, headers: replayed },
      { method: "POST", route, body: body.replace("approve", "trash"), headers: await sign() },
      { method: "POST", route: "/presser/v1/updates/apply", body, headers: await sign() },
      { method: "GET", route, body, headers: await sign() },
      { method: "POST", route, body, headers: stale },
      { method: "POST", route, body, headers: otherSite },
      { method: "POST", route, body, headers: otherSecret },
      { method: "POST", route, body, headers: unsigned },
    ],
  });
  assert.equal(results[0], "ok");
  assert.match(results[1], /already used/);
  for (const result of results.slice(2, 5)) assert.match(result, /signature did not match/);
  assert.match(results[5], /expired/);
  assert.match(results[6], /different Presser site/);
  assert.match(results[7], /signature did not match/);
  assert.match(results[8], /not signed/);
});
