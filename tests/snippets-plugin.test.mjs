import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function call(fn, ...args) {
  const result = spawnSync("php", ["tests/php/snippets.php"], {
    input: JSON.stringify({ fn, args }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

test("page paths are cleaned to a leading slash without query or spaces", { skip }, () => {
  assert.equal(call("clean_path", "pricing"), "/pricing");
  assert.equal(call("clean_path", "/blog/*?x=1"), "/blog/*");
  assert.equal(call("clean_path", "/has space"), "");
  assert.equal(call("clean_path", ""), "");
});

test("a path matches exactly, ignoring a trailing slash, or by prefix with a star", { skip }, () => {
  assert.equal(call("path_matches", "/pricing/", "/pricing"), true);
  assert.equal(call("path_matches", "/pricing/extra", "/pricing"), false);
  assert.equal(call("path_matches", "/blog/post-1/", "/blog/*"), true);
  assert.equal(call("path_matches", "/shop", "/blog/*"), false);
  assert.equal(call("path_matches", "/", "/"), true);
  assert.equal(call("path_matches", "/anything", "/*"), true);
});

test("a snippet applies by its switch and scope", { skip }, () => {
  const base = { enabled: true, scope: "all", paths: [] };
  assert.equal(call("applies", base, "/x"), true);
  assert.equal(call("applies", { ...base, enabled: false }, "/x"), false);
  assert.equal(call("applies", { ...base, scope: "only", paths: ["/pricing"] }, "/pricing"), true);
  assert.equal(call("applies", { ...base, scope: "only", paths: ["/pricing"] }, "/other"), false);
  assert.equal(call("applies", { ...base, scope: "except", paths: ["/checkout/*"] }, "/checkout/pay"), false);
  assert.equal(call("applies", { ...base, scope: "except", paths: ["/checkout/*"] }, "/home"), true);
  // A scope with no paths is the whole site rather than nothing.
  assert.equal(call("applies", { ...base, scope: "only", paths: [] }, "/x"), true);
});

test("a snippet keeps only known values and its code exactly as written", { skip }, () => {
  const code = '<script async src="https://example.com/a.js"></script>\n<script>window.x = "</div>";</script>';
  const out = call("clean_snippet", {
    id: "abc123def",
    name: "  Tracking\u0007 ",
    code,
    location: "nowhere",
    enabled: 1,
    scope: "bogus",
    paths: ["pricing", "pricing", 5],
    extra: "dropped",
  });
  assert.equal(out.code, code);
  assert.equal(out.name, "Tracking");
  assert.equal(out.location, "head");
  assert.equal(out.enabled, true);
  assert.equal(out.scope, "all");
  assert.deepEqual(out.paths, ["/pricing"]);
  assert.equal("extra" in out, false);
  assert.equal(call("clean_snippet", { id: "bad id!" }).id, "");
});

test("a snippet needs a name and code, and the code has a size limit", { skip }, () => {
  const make = (name, code) => call("clean_snippet", { name, code });
  assert.match(call("snippet_error", make("", "<b></b>")), /name/);
  assert.match(call("snippet_error", make("A", "   ")), /no code/);
  assert.match(call("snippet_error", make("A", "x".repeat(30001))), /longer than/);
  assert.equal(call("snippet_error", make("A", "<b></b>")), "");
});

test("settings give every snippet a unique id, skip editors by default, and cap the count", { skip }, () => {
  const out = call("clean", {
    snippets: [{ id: "dup12345", name: "A", code: "a" }, { id: "dup12345", name: "B", code: "b" }, { name: "C", code: "c" }],
  }, null);
  assert.equal(out.skip_editors, true);
  assert.equal(new Set(out.snippets.map((s) => s.id)).size, 3);
  assert.equal(out.snippets[0].id, "dup12345");
  assert.equal(call("clean", { skip_editors: false, snippets: [] }, null).skip_editors, false);
  const many = Array.from({ length: 60 }, (_, i) => ({ name: `n${i}`, code: "c" }));
  assert.equal(call("clean", { snippets: many }, null).snippets.length, 50);
});

test("the page source label cannot close the comment", { skip }, () => {
  assert.equal(call("label", "Tracking --> <script>"), "Tracking script");
});

test("snippets are picked by location and path in saved order", { skip }, () => {
  const s = (name, location, enabled = true) => ({ name, location, enabled, scope: "all", paths: [] });
  const out = call("for_location", [s("a", "head"), s("b", "footer"), s("c", "head"), s("d", "head", false)], "head", "/");
  assert.deepEqual(out.map((x) => x.name), ["a", "c"]);
});
