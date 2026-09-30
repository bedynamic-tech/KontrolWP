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
  const key = { keyId: randomToken(9), secret: randomToken(32) };
  const encoded = encodeConnectionKey(key);
  assert.match(encoded, /^presser2\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeConnectionKey(`  ${encoded}\n`), key);
  // Copying out of a wrapped textarea can add line breaks.
  assert.deepEqual(decodeConnectionKey(encoded.slice(0, 20) + "\n" + encoded.slice(20)), key);
  assert.equal(decodeConnectionKey("presser2.not-json"), null);
  assert.equal(decodeConnectionKey(encoded.slice("presser2.".length)), null);
  assert.equal(decodeConnectionKey(encodeConnectionKey({ keyId: key.keyId, secret: randomToken(16) })), null);
  assert.equal(decodeConnectionKey(encodeConnectionKey({ keyId: "bad id!", secret: key.secret })), null);
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

test("the dashboard reads keys the plugin makes", { skip: !hasPhp && "php is not installed" }, async () => {
  const { connection_key } = php({ create_key: true, requests: [] });
  const key = decodeConnectionKey(connection_key);
  assert.ok(key, connection_key);
  assert.equal(Buffer.from(key.secret, "base64url").length, 32);
});

test("the plugin accepts dashboard signatures and rejects tampering", { skip: !hasPhp && "php is not installed" }, async () => {
  const keyId = randomToken(9);
  const secret = randomToken(32);
  const credentials = { key_id: keyId, secret, created_at: 0 };
  const route = "/presser/v1/comments/moderate";
  const body = JSON.stringify({ id: 12, action: "approve" });
  const sign = (overrides = {}) => signedHeaders({ keyId, secret, method: "POST", route, body, ...overrides });

  const valid = await sign();
  const { results } = php({
    credentials,
    requests: [
      { method: "POST", route, body, headers: valid },
      { method: "POST", route, body, headers: { ...valid } },
      { method: "POST", route, body: body.replace("approve", "trash"), headers: await sign() },
      { method: "POST", route: "/presser/v1/updates/apply", body, headers: await sign() },
      { method: "GET", route, body, headers: await sign() },
      { method: "POST", route, body, headers: await sign({ now: Math.floor(Date.now() / 1000) - 600 }) },
      { method: "POST", route, body, headers: await sign({ keyId: randomToken(9) }) },
      { method: "POST", route, body, headers: await sign({ secret: randomToken(32) }) },
      { method: "POST", route, body, headers: {} },
    ],
  });
  assert.equal(results[0], "ok");
  assert.match(results[1], /already used/);
  for (const result of results.slice(2, 5)) assert.match(result, /signature did not match/);
  assert.match(results[5], /expired/);
  assert.match(results[6], /newer Connection Key/);
  assert.match(results[7], /signature did not match/);
  assert.match(results[8], /not signed/);
});

test("the plugin refuses everything before it has a key", { skip: !hasPhp && "php is not installed" }, async () => {
  const route = "/presser/v1/status";
  const headers = await signedHeaders({ keyId: randomToken(9), secret: randomToken(32), method: "GET", route, body: "" });
  const { results } = php({ credentials: null, requests: [{ method: "GET", route, body: "", headers }] });
  assert.match(results[0], /no Connection Key/);
});
