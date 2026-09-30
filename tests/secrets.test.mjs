import assert from "node:assert/strict";
import test from "node:test";
import { randomToken } from "../src/shared/protocol.ts";
import { decryptSecret, encryptSecret, SecretsKeyError } from "../src/worker/sites/secrets.ts";

const key = randomToken(32);

test("site secrets round-trip and are not stored in the clear", async () => {
  const secret = randomToken(32);
  const stored = await encryptSecret(key, 4, secret);
  assert.match(stored, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(stored.includes(secret), false);
  assert.notEqual(await encryptSecret(key, 4, secret), stored, "each encryption uses a fresh IV");
  assert.equal(await decryptSecret(key, 4, stored), secret);
});

test("a ciphertext only opens for its own site and key", async () => {
  const stored = await encryptSecret(key, 4, "secret");
  await assert.rejects(decryptSecret(key, 5, stored), SecretsKeyError);
  await assert.rejects(decryptSecret(randomToken(32), 4, stored), SecretsKeyError);
  const [v, iv, sealed] = stored.split(".");
  const flipped = sealed.slice(0, -2) + (sealed.at(-2) === "A" ? "B" : "A") + sealed.at(-1);
  await assert.rejects(decryptSecret(key, 4, [v, iv, flipped].join(".")), SecretsKeyError);
  await assert.rejects(decryptSecret(key, 4, "plaintext-secret"), SecretsKeyError);
});

test("a missing or malformed key is refused", async () => {
  for (const bad of [undefined, "", "short", randomToken(16)]) {
    await assert.rejects(encryptSecret(bad, 1, "secret"), SecretsKeyError);
  }
});

test("keys are accepted in base64url or standard base64, as openssl prints them", async () => {
  const { isValidSecretsKey } = await import("../src/worker/sites/secrets.ts");
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const standard = Buffer.from(bytes).toString("base64");
  assert.equal(isValidSecretsKey(Buffer.from(bytes).toString("base64url")), true);
  assert.equal(isValidSecretsKey(standard), true);
  assert.equal(isValidSecretsKey(` ${standard}\n`), true);
  const stored = await encryptSecret(standard, 1, "secret");
  assert.equal(await decryptSecret(`${standard}\n`, 1, stored), "secret");
  for (const bad of [undefined, "", "not a key", Buffer.from(bytes.slice(0, 16)).toString("base64")]) {
    assert.equal(isValidSecretsKey(bad), false);
  }
});
