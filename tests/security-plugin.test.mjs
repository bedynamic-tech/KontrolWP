import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

const ROLES = {
  administrator: { name: "Administrator", caps: { read: true, manage_options: true, edit_posts: true } },
  author: { name: "Author", caps: { read: true, edit_posts: true, publish_posts: true, upload_files: true } },
  subscriber: { name: "Subscriber", caps: { read: true, level_0: true } },
  customer: { name: "Customer", caps: { read: true } },
};

function signupRole(options, multisite = false) {
  const result = spawnSync("php", ["tests/php/security.php"], {
    input: JSON.stringify({ multisite, options, roles: ROLES }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

test("open sign-ups are reported only when new users get more than a reader's role", { skip }, () => {
  assert.equal(signupRole({ users_can_register: "1", default_role: "administrator" }), "Administrator");
  assert.equal(signupRole({ users_can_register: "1", default_role: "author" }), "Author");
  assert.equal(signupRole({ users_can_register: "1", default_role: "subscriber" }), "");
  assert.equal(signupRole({ users_can_register: "1", default_role: "customer" }), "");
  assert.equal(signupRole({ users_can_register: "1", default_role: "missing" }), "");
  assert.equal(signupRole({ users_can_register: "0", default_role: "administrator" }), "");
  assert.equal(signupRole({ users_can_register: "1", default_role: "administrator" }, true), "");
});
