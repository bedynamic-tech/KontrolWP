import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function call(fn, ...args) {
  const result = spawnSync("php", ["tests/php/seo.php"], { input: JSON.stringify({ fn, args }), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

const defaults = call("clean", {});

test("settings keep only known keys of the right type", { skip }, () => {
  const out = call("clean", {
    enabled: 1,
    separator: "|",
    twitter_card: "bogus",
    twitter_site: "@kontrol_wp",
    og_image: "javascript:alert(1)",
    title_template: "<b>%title%</b> %sep% %sitename%",
    nonsense: "x",
  });
  assert.equal(out.enabled, true);
  assert.equal(out.separator, "|");
  assert.equal(out.twitter_card, defaults.twitter_card);
  assert.equal(out.twitter_site, "@kontrol_wp");
  assert.equal(out.og_image, "");
  assert.equal(out.title_template, "%title% %sep% %sitename%");
  assert.equal("nonsense" in out, false);
});

test("an empty title template falls back to the default, and a bad handle is dropped", { skip }, () => {
  const out = call("clean", { title_template: "  ", twitter_site: "not a handle!", separator: "<>" });
  assert.equal(out.title_template, defaults.title_template);
  assert.equal(out.twitter_site, "");
  assert.equal(out.separator, defaults.separator);
});

test("title templates fill in their tokens and drop unknown ones", { skip }, () => {
  const vars = { title: "About", sitename: "Acme", sep: "|", tagline: "Tools" };
  assert.equal(call("fill_template", "%title% %sep% %sitename%", vars), "About | Acme");
  assert.equal(call("fill_template", "%title% %nope% %tagline%", vars), "About %nope% Tools");
  assert.equal(call("fill_template", "%title% %sep% %sitename%", { sitename: "Acme", sep: "-" }), "- Acme");
});

test("descriptions are plain text cut at a word before 160 characters", { skip }, () => {
  assert.equal(call("trim_description", "<p>Hello [gallery] <b>world</b></p>"), "Hello world");
  const long = "word ".repeat(80);
  const out = call("trim_description", long);
  assert.ok(out.length <= 160, String(out.length));
  assert.ok(out.endsWith("…"));
  assert.ok(!out.includes("wor…") && out.slice(0, -1).endsWith("word"));
});

const page = {
  kind: "singular",
  title: 'Tom & "Jerry"',
  description: "A <short> one",
  url: "https://a.test/p/",
  image: "https://a.test/i.jpg",
  type: "article",
  noindex: false,
  site_name: "Acme",
  tagline: "",
  locale: "en_US",
};

test("head tags are escaped and carry canonical, Open Graph and Twitter tags", { skip }, () => {
  const html = call("head_html", { ...defaults, twitter_site: "@acme" }, page);
  assert.match(html, /<meta name="description" content="A &lt;short&gt; one" \/>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/a\.test\/p\/" \/>/);
  assert.match(html, /<meta property="og:title" content="Tom &amp; &quot;Jerry&quot;" \/>/);
  assert.match(html, /<meta property="og:type" content="article" \/>/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.match(html, /<meta name="twitter:site" content="@acme" \/>/);
});

test("a noindex page has no canonical, and switches turn tag groups off", { skip }, () => {
  const noindex = call("head_html", defaults, { ...page, noindex: true });
  assert.ok(!noindex.includes('rel="canonical"'));
  const plain = call("head_html", { ...defaults, og_enabled: false, canonical: false }, page);
  assert.ok(!plain.includes("og:") && !plain.includes("twitter:") && !plain.includes("canonical"));
  assert.match(plain, /name="description"/);
  const noImage = call("head_html", defaults, { ...page, image: "" });
  assert.match(noImage, /twitter:card" content="summary"/);
  assert.ok(!noImage.includes("og:image"));
});
