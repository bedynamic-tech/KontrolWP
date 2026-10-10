import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function call(fn, ...args) {
  const result = spawnSync("php", ["tests/php/maintenance.php"], {
    input: JSON.stringify({ fn, args }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

test("maintenance mode is off until the dashboard turns it on", { skip }, () => {
  assert.deepEqual(call("clean", null), {
    enabled: false,
    headline: "",
    message: "",
    since: 0,
    logo: "site",
    background: "",
    accent: "",
  });
  assert.deepEqual(
    call("clean", { enabled: true, headline: "  Back\nsoon  ", message: "Hi", since: 5, logo: "login", background: "#FFAA00", accent: "red" }),
    { enabled: true, headline: "Back soon", message: "Hi", since: 5, logo: "login", background: "#ffaa00", accent: "" },
  );
  assert.equal(call("clean", { logo: "elsewhere" }).logo, "site");
});

test("the message keeps its paragraphs but not control characters", { skip }, () => {
  assert.equal(call("trim_text", "One\r\n\r\n\r\n\r\nTwo\u0007", 1000, true), "One\n\nTwo");
  assert.equal(call("trim_text", "x".repeat(200), 120, false).length, 120);
});

test("only visitors who cannot edit get the page, and never robots.txt", { skip }, () => {
  const on = { enabled: true };
  assert.equal(call("applies", on, false, false, false), true);
  assert.equal(call("applies", on, false, true, false), false);
  assert.equal(call("applies", on, false, false, true), false);
  assert.equal(call("applies", { enabled: false }, false, false, false), false);
  // A preview shows the page even while it is off, and to editors.
  assert.equal(call("applies", { enabled: false }, true, true, false), true);
});

test("the page escapes what the owner typed and falls back to the defaults", { skip }, () => {
  const settings = { enabled: true, headline: "", message: "", since: 0, logo: "site", background: "", accent: "" };
  const plain = call("page", settings, "Acme & Co", ["", 0, 0], "en-US");
  assert.match(plain, /<h1>We will be back soon<\/h1>/);
  assert.match(plain, /<p class="name">Acme &amp; Co<\/p>/);
  assert.match(plain, /<meta name="robots" content="noindex">/);
  assert.match(plain, /lang="en-US"/);

  const custom = call(
    "page",
    { ...settings, headline: "<script>x</script>", message: "Line one\nline two\n\nNext" },
    "Acme",
    ["https://example.com/logo.png?a=1&b=2", 100, 50],
    "",
  );
  assert.doesNotMatch(custom, /<script>/);
  assert.match(custom, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(custom, /<p>Line one<br>\nline two<\/p><p>Next<\/p>/);
  assert.match(custom, /<img class="logo" src="https:\/\/example.com\/logo.png\?a=1&amp;b=2" alt="Acme">/);
  assert.doesNotMatch(custom, /class="name"/);
});

test("the owner's colors brand the page", { skip }, () => {
  const settings = { enabled: true, headline: "", message: "", since: 0, logo: "site", background: "", accent: "" };
  assert.doesNotMatch(call("page", settings, "Acme", ["", 0, 0], "en"), /border-top:6px/);
  const branded = call("page", { ...settings, background: "#123456", accent: "#ff6600" }, "Acme", ["", 0, 0], "en");
  assert.match(branded, /body\{background:#123456\}/);
  assert.match(branded, /main\{border-top:6px solid #ff6600\}/);
});
