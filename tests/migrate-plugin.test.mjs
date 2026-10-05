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

test("Twitter card types and what the site is map to KontrolWP's choices", { skip }, () => {
  assert.equal(call("card_type", "summary_large_image"), "summary_large_image");
  assert.equal(call("card_type", "summary_card"), "summary");
  assert.equal(call("card_type", "summary"), "summary");
  assert.equal(call("card_type", "player"), "");
  assert.equal(call("schema_kind", "company"), "organization");
  assert.equal(call("schema_kind", "organization"), "organization");
  assert.equal(call("schema_kind", "person"), "person");
  assert.equal(call("schema_kind", "other"), "");
});

test("a focus keyword is the first of a comma-separated list", { skip }, () => {
  assert.equal(call("first_keyword", "blue widgets, red widgets"), "blue widgets");
  assert.equal(call("first_keyword", " , cloud backup"), "cloud backup");
  assert.equal(call("first_keyword", ""), "");
  assert.equal(call("first_keyword", ["a", "b"]), "a");
});

test("All in One SEO reads the focus keyword from its column or the legacy JSON", { skip }, () => {
  assert.equal(call("aioseo_keyword", { focus: "cloud backup", keyphrases: "" }), "cloud backup");
  assert.equal(call("aioseo_keyword", { focus: "", keyphrases: '{"focus":{"keyphrase":"old phrase"}}' }), "old phrase");
  assert.equal(call("aioseo_keyword", { focus: "", keyphrases: "not json" }), "");
});

test("profile and logo helpers keep only usable values", { skip }, () => {
  assert.equal(call("handle_url", "@kontrol_wp"), "https://x.com/kontrol_wp");
  assert.equal(call("handle_url", "not a handle!"), "");
  assert.equal(call("entity_text", "&raquo;"), "»");
  assert.deepEqual(
    call("web_addresses", ["https://a.test/x", "nope", "https://a.test/x", "https://b.test/\nhttps://c.test/\nmailto:x@y.z", ["https://d.test/"]]),
    ["https://a.test/x", "https://b.test/", "https://c.test/", "https://d.test/"],
  );
});

test("lists and templates are added to, never replaced", { skip }, () => {
  assert.deepEqual(call("merge_list", ["post_tag"], ["page", "post_tag"]), ["post_tag", "page"]);
  const kept = { post: { title: "Mine", description: "" } };
  const merged = call("merge_templates", kept, { post: { title: "Theirs", description: "" }, event: { title: "Event %title%", description: "" } });
  assert.equal(merged.post.title, "Mine");
  assert.equal(merged.event.title, "Event %title%");
});

test("content settings fill defaults only, switch on only, and add profile links", { skip }, () => {
  const defaults = { schema_type: "organization", schema_name: "", breadcrumb_home: "Home", external_new_tab: false, schema_same_as: [] };
  const current = { schema_type: "organization", schema_name: "Mine", breadcrumb_home: "Home", external_new_tab: false, schema_same_as: ["https://a.test/"] };
  const [next, changed] = call("merge_content", current, defaults, {
    schema_type: "person",
    schema_name: "Theirs",
    breadcrumb_home: "Start",
    external_new_tab: true,
    schema_same_as: ["https://a.test/", "https://b.test/"],
    unknown_key: "x",
  });
  assert.equal(next.schema_type, "person");
  assert.equal(next.schema_name, "Mine");
  assert.equal(next.breadcrumb_home, "Start");
  assert.equal(next.external_new_tab, true);
  assert.deepEqual(next.schema_same_as, ["https://a.test/", "https://b.test/"]);
  assert.deepEqual(changed.sort(), ["breadcrumb_home", "external_new_tab", "schema_same_as", "schema_type"]);
  const [again, none] = call("merge_content", next, defaults, { schema_type: "organization", external_new_tab: false });
  assert.equal(again.schema_type, "person");
  assert.deepEqual(none, []);
});

test("found settings read back as text for the preview", { skip }, () => {
  assert.equal(call("describe", true), "On");
  assert.equal(call("describe", ["page", "event"]), "page, event");
  assert.equal(call("describe", { event: { title: "x", description: "" } }), "event");
  assert.equal(call("describe", "Home"), "Home");
});
