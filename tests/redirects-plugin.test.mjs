import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function call(fn, ...args) {
  const result = spawnSync("php", ["tests/php/redirects.php"], {
    input: JSON.stringify({ fn, args }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

test("paths are reduced to one lower case-able form", { skip }, () => {
  assert.equal(call("normalize_path", "https://example.com/Old/Page/?a=1#x"), "/Old/Page");
  assert.equal(call("normalize_path", "old//page/"), "/old/page");
  assert.equal(call("normalize_path", ""), "/");
  assert.equal(call("key", "/Old/Page/"), "/old/page");
});

test("a rule keeps only known fields and defaults to a 301", { skip }, () => {
  const [rule, error] = call("clean_rule", { source: "/old/", target: "/new", bogus: 1 });
  assert.equal(error, "");
  assert.deepEqual(rule, { source: "/old", match_type: "exact", target: "/new", status_code: 301, enabled: true });
});

test("rules that cannot work are refused with a reason", { skip }, () => {
  assert.ok(call("clean_rule", { source: "", target: "/x" })[1]);
  assert.ok(call("clean_rule", { source: "/a", target: "" })[1]);
  assert.ok(call("clean_rule", { source: "/a", target: "javascript:alert(1)" })[1]);
  assert.ok(call("clean_rule", { source: "/a", target: "/A/" })[1]);
  assert.ok(call("clean_rule", { source: "(", match_type: "regex", target: "/x" })[1]);
});

test("410 and 451 rules need no target", { skip }, () => {
  const [rule, error] = call("clean_rule", { source: "/gone", status_code: 410 });
  assert.equal(error, "");
  assert.equal(rule.target, "");
  assert.equal(rule.status_code, 410);
});

test("exact rules ignore case and a trailing slash", { skip }, () => {
  const rule = { source: "/old", match_type: "exact", target: "/new", status_code: 301 };
  assert.deepEqual(call("match_rule", rule, "/OLD/"), ["/new", 301]);
  assert.equal(call("match_rule", rule, "/old/more"), null);
});

test("prefix rules carry the rest of the path into $1", { skip }, () => {
  const rule = { source: "/blog", match_type: "prefix", target: "/news/$1", status_code: 302 };
  assert.deepEqual(call("match_rule", rule, "/blog/a/b"), ["/news/a/b", 302]);
  assert.deepEqual(call("match_rule", rule, "/blog"), ["/news/", 302]);
  assert.equal(call("match_rule", rule, "/blogger"), null);
});

test("regex rules substitute their groups", { skip }, () => {
  const rule = { source: "^/p/(\\d+)/(.*)$", match_type: "regex", target: "/post-$1/$2", status_code: 301 };
  assert.deepEqual(call("match_rule", rule, "/p/12/hello"), ["/post-12/hello", 301]);
  assert.equal(call("match_rule", rule, "/q/12/hello"), null);
});

test("an address becomes a path on the site, without the site's own folder", { skip }, () => {
  assert.equal(call("relative_path", "https://a.test/blog/Old-Page/?x=1", "https://a.test"), "/blog/Old-Page");
  assert.equal(call("relative_path", "https://a.test/blog/old", "https://a.test/blog"), "/old");
  assert.equal(call("relative_path", "https://a.test/", "https://a.test"), "/");
  assert.equal(call("relative_path", "https://a.test/blogger", "https://a.test/blog"), "/blogger");
});

test("an address on another host has no path on this site", { skip }, () => {
  assert.equal(call("relative_path", "https://other.test/x", "https://a.test"), "");
});

test("a redirect target is a full address or a path on the site", { skip }, () => {
  assert.equal(call("target_ok", "/new"), true);
  assert.equal(call("target_ok", "https://a.test/new"), true);
  assert.equal(call("target_ok", "javascript:alert(1)"), false);
  assert.equal(call("target_ok", "new"), false);
});

test("a new rule covers the logged paths it answers, whatever its kind", { skip }, () => {
  const logged = ["/old-page", "/Blog/2020/post", "/blog", "/other"];
  const exact = { source: "/old-page/", match_type: "exact", target: "/new", status_code: 301, enabled: true };
  assert.deepEqual(call("covered_paths", exact, logged), ["/old-page"]);
  const prefix = { source: "/blog", match_type: "prefix", target: "/news", status_code: 301, enabled: true };
  assert.deepEqual(call("covered_paths", prefix, logged), ["/Blog/2020/post", "/blog"]);
  const regex = { source: "^/o(ld|ther)", match_type: "regex", target: "/x", status_code: 301, enabled: true };
  assert.deepEqual(call("covered_paths", regex, logged), ["/old-page", "/other"]);
  assert.deepEqual(call("covered_paths", exact, []), []);
});
