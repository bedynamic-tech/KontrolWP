import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function call(fn, ...args) {
  const result = spawnSync("php", ["tests/php/update-emails.php"], {
    input: JSON.stringify({ fn, args }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

test("update emails are suppressed unless the dashboard turned them back on", { skip }, () => {
  assert.equal(call("suppressed", ""), true);
  assert.equal(call("suppressed", false), true);
  assert.equal(call("suppressed", "disable"), true);
  assert.equal(call("suppressed", "allow"), false);
});
