import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function call(fn, ...args) {
  const result = spawnSync("php", ["tests/php/migrate.php"], { input: JSON.stringify({ fn, args }), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

test("each plugin's title tokens become KontrolWP's, and unknown ones are dropped", { skip }, () => {
  assert.equal(call("convert_tokens", "%%title%% %%page%% %%sep%% %%sitename%%", "yoast"), "%title% %sep% %sitename%");
  assert.equal(
    call("convert_tokens", "%title% %sep% %sitename% %sitedesc%", "rankmath"),
    "%title% %sep% %sitename% %tagline%",
  );
  assert.equal(call("convert_tokens", "#post_title #separator_sa #site_title", "aioseo"), "%title% %sep% %sitename%");
  assert.equal(
    call("convert_tokens", "%%post_title%% %%sep%% %%sitetitle%% %%currentyear%%", "seopress"),
    "%title% %sep% %sitename%",
  );
  assert.equal(call("convert_tokens", "Plain text", "yoast"), "Plain text");
  assert.equal(call("convert_tokens", "%%title%%", "nonsense"), "");
});

test("separators map to the ones KontrolWP offers", { skip }, () => {
  assert.equal(call("map_separator", "sc-pipe"), "|");
  assert.equal(call("map_separator", "sc-ndash"), "-");
  assert.equal(call("map_separator", "»"), "»");
  assert.equal(call("map_separator", "–"), "-");
  assert.equal(call("map_separator", "~"), "");
  assert.equal(call("map_separator", null), "");
});

test("a value that hides a page is recognised across plugins", { skip }, () => {
  assert.equal(call("is_noindex", "1"), true);
  assert.equal(call("is_noindex", "yes"), true);
  assert.equal(call("is_noindex", ["index", "noindex"]), true);
  assert.equal(call("is_noindex", ["index"]), false);
  assert.equal(call("is_noindex", "2"), false);
  assert.equal(call("is_noindex", ""), false);
});

const serialized = (pattern, comparison) =>
  `a:1:{i:0;a:2:{s:7:"pattern";s:${Buffer.byteLength(pattern)}:"${pattern}";s:10:"comparison";s:${comparison.length}:"${comparison}";}}`;

test("Rank Math rows become one rule per source", { skip }, () => {
  const rules = call("rankmath_rules", {
    sources: serialized("old-page", "exact"),
    url_to: "/new",
    header_code: 301,
    status: "active",
  });
  assert.deepEqual(rules, [
    { source: "old-page", match_type: "exact", target: "/new", status_code: 301, enabled: true },
  ]);
  assert.equal(
    call("rankmath_rules", {
      sources: serialized("blog", "start"),
      url_to: "/news",
      header_code: 302,
      status: "inactive",
    })[0].match_type,
    "prefix",
  );
  assert.equal(
    call("rankmath_rules", {
      sources: serialized("blog", "start"),
      url_to: "/news",
      header_code: 302,
      status: "inactive",
    })[0].enabled,
    false,
  );
});

test("Rank Math's contains, ends-with and regex comparisons become regular expressions", { skip }, () => {
  const rule = (pattern, comparison) =>
    call("rankmath_rules", {
      sources: serialized(pattern, comparison),
      url_to: "/x",
      header_code: 301,
      status: "active",
    })[0];
  assert.deepEqual([rule("a.b", "contains").match_type, rule("a.b", "contains").source], ["regex", "a\\.b"]);
  assert.equal(rule("a.b", "end").source, "a\\.b$");
  assert.equal(rule("^old/(.*)", "regex").source, "^/?old/(.*)");
});

test("bad Rank Math rows give no rules", { skip }, () => {
  assert.deepEqual(call("rankmath_rules", { sources: "garbage", url_to: "/x" }), []);
  assert.deepEqual(call("rankmath_rules", {}), []);
});

test("nested values are found by path", { skip }, () => {
  assert.equal(call("dig", { a: { b: { c: "x" } } }, ["a", "b", "c"]), "x");
  assert.equal(call("dig", { a: 1 }, ["a", "b"]), null);
});
