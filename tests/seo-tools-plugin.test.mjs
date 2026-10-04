import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function call(fn, ...args) {
  const result = spawnSync("php", ["tests/php/seo-tools.php"], {
    input: JSON.stringify({ fn, args }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

test("a verification code can be pasted bare or inside its whole meta tag", { skip }, () => {
  assert.equal(call("clean_code", "abc123_-XYZ"), "abc123_-XYZ");
  assert.equal(call("clean_code", '<meta name="google-site-verification" content="abc123" />'), "abc123");
  assert.equal(call("clean_code", '"><script>alert(1)</script>'), "");
  assert.equal(call("clean_code", ""), "");
});

test("settings keep only known values", { skip }, () => {
  const out = call("clean", {
    verify: { google: "g1", bing: "bad code!", other: "x" },
    robots_mode: "bogus",
    llms_mode: "auto",
    indexnow: 1,
    indexnow_key: "short",
  });
  assert.equal(out.verify.google, "g1");
  assert.equal(out.verify.bing, "");
  assert.equal("other" in out.verify, false);
  assert.equal(out.robots_mode, "default");
  assert.equal(out.llms_mode, "auto");
  assert.equal(out.indexnow, true);
  assert.equal(out.indexnow_key, "");
});

test("robots.txt accepts rules and refuses anything else", { skip }, () => {
  assert.equal(
    call(
      "robots_error",
      "User-agent: *\nDisallow: /private/\nAllow: /private/ok\nSitemap: https://a.test/s.xml\n# note",
    ),
    "",
  );
  assert.match(call("robots_error", "User-agent: *\nhello"), /Line 2/);
  assert.match(call("robots_error", "<script>"), /Line 1/);
  assert.match(call("robots_error", "x".repeat(6000)), /characters/);
});

test("a robots.txt that blocks the whole site for every crawler is refused", { skip }, () => {
  assert.match(call("robots_error", "User-agent: *\nDisallow: /"), /whole site/);
  assert.match(call("robots_error", "User-agent: Googlebot\nUser-agent: *\nDisallow: /"), /whole site/);
  assert.equal(call("robots_error", "User-agent: BadBot\nDisallow: /"), "");
  assert.equal(call("robots_error", "User-agent: *\nDisallow: /wp-admin/"), "");
});

test("custom robots.txt replaces the default, except on a site that discourages search engines", { skip }, () => {
  const def = "User-agent: *\nDisallow: /wp-admin/\n";
  assert.equal(
    call("robots_output", "custom", "User-agent: *\nDisallow: /x/", def, true),
    "User-agent: *\nDisallow: /x/\n",
  );
  assert.equal(call("robots_output", "custom", "User-agent: *\nDisallow: /x/", def, false), def);
  assert.equal(call("robots_output", "default", "User-agent: *", def, true), def);
  assert.equal(call("robots_output", "custom", "  ", def, true), def);
});

test("llms.txt lists the site, its pages and its recent posts", { skip }, () => {
  const text = call(
    "llms_auto",
    "Acme",
    "Fresh bread",
    [["About [us]", "https://a.test/about", ""]],
    [["Hello", "https://a.test/hello", "A first post"]],
  );
  assert.equal(
    text,
    "# Acme\n> Fresh bread\n\n## Pages\n- [About us](https://a.test/about)\n\n## Recent posts\n- [Hello](https://a.test/hello): A first post\n",
  );
  assert.equal(call("llms_auto", "Acme", "", [], []), "# Acme\n");
});

test("an IndexNow submission names the host, key and key file", { skip }, () => {
  assert.deepEqual(
    call("indexnow_payload", "a.test", "k".repeat(32), "https://a.test/key.txt", [
      "https://a.test/x",
      "https://a.test/x",
    ]),
    {
      host: "a.test",
      key: "k".repeat(32),
      keyLocation: "https://a.test/key.txt",
      urlList: ["https://a.test/x"],
    },
  );
});
