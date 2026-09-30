import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { deployWithSecretsKey, KEY_NAME, parseSecretList } from "../scripts/deploy.mjs";

const config = { name: "presser-test", configPath: "/project/dist/presser/wrangler.json" };
const json = (value) => ({ status: 0, stdout: JSON.stringify(value), stderr: "" });

function fixture({ listed = json([]), deployStatus = 0 } = {}) {
  const calls = [];
  let uploaded;
  let file;
  const run = (args, options) => {
    calls.push(args);
    assert.deepEqual(args.slice(args.indexOf("--config"), args.indexOf("--config") + 2), ["--config", config.configPath]);
    if (args[0] === "secret") return listed;
    assert.equal(args[0], "deploy");
    assert.equal(options.inherit, true);
    const index = args.indexOf("--secrets-file");
    if (index !== -1) {
      file = args[index + 1];
      assert.equal(statSync(file).mode & 0o777, 0o600);
      uploaded = JSON.parse(readFileSync(file, "utf8"));
    }
    return { status: deployStatus };
  };
  return {
    calls,
    get uploaded() { return uploaded; },
    get file() { return file; },
    deploy: () => deployWithSecretsKey({ config, run, log: () => {} }),
  };
}

test("the first deploy creates a 32-byte key and removes the temporary file", async () => {
  const f = fixture();
  await f.deploy();
  assert.equal(Buffer.from(f.uploaded[KEY_NAME], "base64url").length, 32);
  assert.equal(existsSync(f.file), false);
});

test("a brand new Worker also gets a key", async () => {
  const f = fixture({
    listed: { status: 1, stdout: "", stderr: `Worker "presser-test" not found. If this is a new Worker, run \`wrangler deploy\` first to create it.` },
  });
  await f.deploy();
  assert.ok(f.uploaded[KEY_NAME]);
});

test("an existing key is never replaced", async () => {
  const f = fixture({ listed: json([{ name: KEY_NAME, type: "secret_text" }]) });
  await f.deploy();
  assert.equal(f.uploaded, undefined);
  assert.equal(f.calls.at(-1).includes("--secrets-file"), false);
});

test("an unreadable secret list stops the deploy instead of risking a new key", async () => {
  for (const listed of [{ status: 1, stdout: "", stderr: "Authentication error" }, { status: 0, stdout: "not json", stderr: "" }, json({})]) {
    const f = fixture({ listed });
    await assert.rejects(f.deploy(), /secret/i);
    assert.equal(f.calls.some((args) => args[0] === "deploy"), false);
  }
});

test("a failed deploy is reported", async () => {
  const f = fixture({ deployStatus: 1 });
  await assert.rejects(f.deploy(), /deployment failed/);
  assert.equal(existsSync(f.file), false);
});

test("notices Wrangler prints around the JSON do not hide an existing key", async () => {
  // Wrangler 4.124.0 prints this on stdout when the config has fields it does not know.
  const stdout = [
    "There is a newer version of Wrangler available (current: 4.124.0, latest: 4.145.0). Try upgrading, as it might support this configuration option.",
    JSON.stringify([{ name: KEY_NAME, type: "secret_text" }], null, 2),
    "",
  ].join("\n");
  const f = fixture({ listed: { status: 0, stdout, stderr: "" } });
  await f.deploy();
  assert.equal(f.uploaded, undefined);
});

test("the secret list parser finds only a real JSON array", () => {
  assert.deepEqual(parseSecretList("[]"), []);
  assert.deepEqual(parseSecretList("notice\n[\n  {\"name\": \"A\"}\n]\nmore"), [{ name: "A" }]);
  assert.equal(parseSecretList("[not json]"), null);
  assert.equal(parseSecretList("{}"), null);
  assert.equal(parseSecretList(""), null);
});
