import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function call(fn, ...args) {
  const result = spawnSync("php", ["tests/php/seo-content.php"], {
    input: JSON.stringify({ fn, args }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

test("settings keep only known values and start with sensible defaults", { skip }, () => {
  const out = call("clean", {});
  assert.equal(out.schema, true);
  assert.equal(out.image_alt, true);
  assert.equal(out.external_new_tab, false);
  assert.equal(out.external_nofollow, false);
  assert.match(out.feed_footer, /%title%/);
  const bad = call("clean", {
    schema_type: "alien",
    schema_logo: "javascript:x",
    schema_same_as: ["https://x.test/a", "nope", "https://x.test/a"],
    breadcrumb_sep: "~",
    breadcrumb_home: "  ",
  });
  assert.equal(bad.schema_type, "organization");
  assert.equal(bad.schema_logo, "");
  assert.deepEqual(bad.schema_same_as, ["https://x.test/a"]);
  assert.equal(bad.breadcrumb_sep, "›");
  assert.equal(bad.breadcrumb_home, "Home");
});

test("only links that leave the site are external", { skip }, () => {
  assert.equal(call("is_external", "https://other.test/x", "a.test"), true);
  assert.equal(call("is_external", "//other.test/x", "a.test"), true);
  assert.equal(call("is_external", "https://a.test/x", "a.test"), false);
  assert.equal(call("is_external", "https://www.a.test/x", "a.test"), false);
  assert.equal(call("is_external", "https://a.test/x", "www.a.test"), false);
  assert.equal(call("is_external", "/relative", "a.test"), false);
  assert.equal(call("is_external", "mailto:x@y.test", "a.test"), false);
  assert.equal(call("is_external", "#top", "a.test"), false);
});

test("rel tokens are added once and what was there is kept", { skip }, () => {
  assert.equal(call("merge_rel", "", ["nofollow", "noopener"]), "nofollow noopener");
  assert.equal(call("merge_rel", "Noopener sponsored", ["nofollow", "noopener"]), "noopener sponsored nofollow");
});

test("alt text comes from real titles, not camera file names", { skip }, () => {
  assert.equal(call("alt_from_title", "Fresh sourdough loaf"), "Fresh sourdough loaf");
  assert.equal(call("alt_from_title", "fresh-sourdough_loaf"), "fresh sourdough loaf");
  assert.equal(call("alt_from_title", "IMG_1234"), "");
  assert.equal(call("alt_from_title", "DSC 0042"), "");
  assert.equal(call("alt_from_title", "photo.jpg"), "");
  assert.equal(call("alt_from_title", "1234"), "");
});

test("the feed footer fills its tokens", { skip }, () => {
  assert.equal(
    call("feed_footer", "The post %title% first appeared on %sitename%. %link%", {
      title: "Hi",
      sitename: "Acme",
      link: "https://a.test/hi",
    }),
    "The post Hi first appeared on Acme. https://a.test/hi",
  );
});

test("breadcrumbs become schema and a list with the current page unlinked", { skip }, () => {
  const trail = [
    ["Home", "https://a.test/"],
    ["News", "https://a.test/news/"],
    ["Story <b>", "https://a.test/news/story/"],
  ];
  const schema = call("breadcrumb_schema", trail);
  assert.equal(schema["@type"], "BreadcrumbList");
  assert.equal(schema.itemListElement[1].position, 2);
  assert.equal(schema.itemListElement[2].item, "https://a.test/news/story/");
  const html = call("breadcrumb_html", trail, "›");
  assert.match(html, /<a href="https:\/\/a\.test\/news\/">News<\/a>/);
  assert.match(html, /aria-current="page">Story &lt;b&gt;</);
  assert.equal(call("breadcrumb_html", [["Home", "https://a.test/"]], "›"), "");
});

const settings = call("clean", { schema_same_as: ["https://x.test/me"] });
const site = {
  name: "Acme",
  url: "https://a.test/",
  language: "en-US",
  logo: "https://a.test/icon.png",
  description: "Bread",
};

test("the site graph names the website and the organization behind it", { skip }, () => {
  const [website, org] = call("site_graph", settings, site);
  assert.equal(website["@type"], "WebSite");
  assert.equal(website.publisher["@id"], "https://a.test/#organization");
  assert.equal(org["@type"], "Organization");
  assert.equal(org.logo.url, "https://a.test/icon.png");
  assert.deepEqual(org.sameAs, ["https://x.test/me"]);
});

test("a person is described without an organization logo object", { skip }, () => {
  const [, person] = call("site_graph", { ...settings, schema_type: "person", schema_name: "Sam" }, site);
  assert.equal(person["@type"], "Person");
  assert.equal(person.name, "Sam");
  assert.equal(person.logo, "https://a.test/icon.png");
});

test("an article names its author and publisher, and leaves out what it lacks", { skip }, () => {
  const node = call("article_node", settings, site, {
    url: "https://a.test/hi/",
    title: "Hi",
    description: "",
    image: "",
    published: "2026-01-01T00:00:00+00:00",
    modified: "2026-01-02T00:00:00+00:00",
    author_name: "Sam",
    author_url: "",
  });
  assert.equal(node["@type"], "Article");
  assert.equal(node.publisher["@id"], "https://a.test/#organization");
  assert.equal(node.author.name, "Sam");
  assert.equal("description" in node, false);
  assert.equal("image" in node, false);
  assert.equal("url" in node.author, false);
});
