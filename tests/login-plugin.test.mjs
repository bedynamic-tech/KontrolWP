import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function createLink(options) {
  const result = spawnSync("php", ["tests/php/login.php"], { input: JSON.stringify({ options }), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

test("making a Magic Login link clears old links and nothing else", { skip }, () => {
  const expired = `kontrolwp_connect_login_${"a".repeat(64)}`;
  const current = `kontrolwp_connect_login_${"b".repeat(64)}`;
  const names = createLink({
    blogname: "Example",
    // Settings that share the links' prefix: the custom login address and the login logo.
    kontrolwp_connect_login_url: { enabled: true, slug: "my-door", redirect: "404" },
    kontrolwp_connect_login_logo: { enabled: true, source: "upload", attachment: 42 },
    [expired]: { user_id: 1, post_id: 0, expires: 1 },
    [current]: { user_id: 1, post_id: 0, expires: 4102444800 },
  });
  assert.ok(names.includes("kontrolwp_connect_login_url"));
  assert.ok(names.includes("kontrolwp_connect_login_logo"));
  assert.ok(names.includes("blogname"));
  assert.ok(names.includes(current));
  assert.ok(!names.includes(expired));
  assert.equal(names.filter((name) => /^kontrolwp_connect_login_[0-9a-f]{64}$/.test(name)).length, 2);
});
