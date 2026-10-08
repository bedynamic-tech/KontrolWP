import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function call(fn, ...args) {
  const result = spawnSync("php", ["tests/php/login-url.php"], {
    input: JSON.stringify({ fn, args }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

test("a login address is cleaned to lower case letters, digits, hyphens and underscores", { skip }, () => {
  assert.equal(call("normalize_slug", " /My Login/ "), "my-login");
  assert.equal(call("normalize_slug", "secure_door-2"), "secure_door-2");
  assert.equal(call("normalize_slug", "wp-login.php"), "wp-login-php");
  assert.equal(call("normalize_slug", ""), "");
});

test("empty, short, long and reserved addresses are refused", { skip }, () => {
  assert.notEqual(call("slug_error", ""), "");
  assert.notEqual(call("slug_error", "--"), "");
  assert.notEqual(call("slug_error", "ab"), "");
  assert.notEqual(call("slug_error", "a".repeat(61)), "");
  for (const reserved of ["wp-admin", "wp-login-php", "login", "admin", "wp-json", "feed", "dashboard", "wp_admin"]) {
    assert.notEqual(call("slug_error", reserved), "", reserved);
  }
  assert.equal(call("slug_error", "my-door"), "");
});

test("the request path is read below the home address", { skip }, () => {
  assert.equal(call("relative_path", "/my-door/", ""), "my-door");
  assert.equal(call("relative_path", "/My-Door?x=1", "/"), "my-door");
  assert.equal(call("relative_path", "/blog/my-door/", "/blog"), "my-door");
  assert.equal(call("relative_path", "/index.php/my-door", ""), "my-door");
  assert.equal(call("relative_path", "/blogger/my-door", "/blog"), "blogger/my-door");
});

test("the login address matches as a path, or as a ?name without pretty permalinks", { skip }, () => {
  assert.equal(call("is_login_request", "my-door", "my-door", []), true);
  assert.equal(call("is_login_request", "", "my-door", ["my-door"]), true);
  assert.equal(call("is_login_request", "my-door/extra", "my-door", []), false);
  assert.equal(call("is_login_request", "", "", [""]), false);
  assert.equal(call("is_login_request", "", "my-door", ["other"]), false);
});

test("only a password form and a Magic Login link still reach wp-login.php directly", { skip }, () => {
  const token = "a".repeat(64);
  assert.equal(call("direct_allowed", { action: "postpass" }, { post_password: "x" }), true);
  assert.equal(call("direct_allowed", { action: "postpass" }, []), false);
  assert.equal(call("direct_allowed", { action: "kontrolwp_login", token }, []), true);
  assert.equal(call("direct_allowed", { action: "kontrolwp_login", token: "short" }, []), false);
  assert.equal(call("direct_allowed", { action: "lostpassword" }, []), false);
  assert.equal(call("direct_allowed", [], []), false);
});

test("a signed-out request to some wp-admin files carries on", { skip }, () => {
  for (const file of ["admin-ajax.php", "admin-post.php", "load-styles.php", "load-scripts.php", "upgrade.php"])
    assert.equal(call("admin_open", file), true, file);
  for (const file of ["index.php", "options.php", "plugins.php", "profile.php"]) assert.equal(call("admin_open", file), false, file);
});

test("links to wp-login.php point at the custom address and keep their query", { skip }, () => {
  const login = "https://example.com/my-door/";
  assert.equal(call("rewrite_url", "https://example.com/wp-login.php", login), login);
  assert.equal(
    call("rewrite_url", "https://example.com/wp-login.php?action=lostpassword&redirect_to=%2F", login),
    "https://example.com/my-door/?action=lostpassword&redirect_to=%2F",
  );
  assert.equal(
    call("rewrite_url", "https://example.com/blog/wp-login.php?action=rp", "https://example.com/?my-door"),
    "https://example.com/?my-door&action=rp",
  );
  assert.equal(call("rewrite_url", "https://example.com/wp-login.php?action=postpass", login), "https://example.com/wp-login.php?action=postpass");
  assert.equal(call("rewrite_url", "https://example.com/wp-admin/", login), "https://example.com/wp-admin/");
  assert.equal(call("rewrite_url", "https://example.com/my-wp-login.php.html", login), "https://example.com/my-wp-login.php.html");
});

test("saved settings are cleaned, with the default hiding pages as not found", { skip }, () => {
  assert.deepEqual(call("clean", []), { enabled: false, slug: "", redirect: "404" });
  assert.deepEqual(call("clean", { enabled: true, slug: " My Door ", redirect: "home" }), { enabled: true, slug: "my-door", redirect: "home" });
  assert.deepEqual(call("clean", { enabled: true, slug: "x", redirect: "elsewhere" }), { enabled: true, slug: "x", redirect: "404" });
});
