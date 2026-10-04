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

const business = {
  id: "abcd1234",
  type: "Dentist",
  name: "Smile Co",
  phone: "+1 555 0100",
  street: "1 Main St",
  city: "Austin",
  postal: "78701",
  country: "US",
  latitude: "30.2672",
  longitude: "-97.7431",
  hours: {
    mon: { open: "09:00", close: "17:00" },
    tue: { open: "9:00", close: "17:00" },
    sun: { open: "", close: "" },
  },
  same_as: ["https://facebook.com/smile", "javascript:alert(1)", "https://facebook.com/smile"],
};

test("a location is cleaned: bad types, times, coordinates and links are dropped", { skip }, () => {
  const out = call("clean_location", { ...business, type: "Hacker", latitude: "200", page_id: "12", extra: 1 });
  assert.equal(out.type, "LocalBusiness");
  assert.equal(out.latitude, "");
  assert.equal(out.longitude, "-97.7431");
  assert.equal(out.page_id, 12);
  assert.equal(out.id, "abcd1234");
  assert.deepEqual(out.hours, { mon: { open: "09:00", close: "17:00" } });
  assert.deepEqual(out.same_as, ["https://facebook.com/smile"]);
  assert.equal("extra" in out, false);
  assert.equal(call("clean_location", business).type, "Dentist");
  assert.equal(call("clean_location", { page_id: -3 }).page_id, 0);
});

test("locations get unique ids, are capped, and the one-business shape becomes one location", { skip }, () => {
  const two = call("clean_local", { enabled: true, locations: [business, business, "junk"] });
  assert.equal(two.locations.length, 2);
  assert.notEqual(two.locations[0].id, two.locations[1].id);
  const many = call("clean_local", { locations: Array.from({ length: 60 }, () => ({ name: "x", phone: "1" })) });
  assert.equal(many.locations.length, 50);
  const old = call("clean_local", { enabled: true, ...business, id: undefined });
  assert.equal(old.enabled, true);
  assert.equal(old.locations.length, 1);
  assert.equal(old.locations[0].name, "Smile Co");
  assert.deepEqual(call("clean_local", {}), { enabled: false, locations: [] });
});

test("business schema needs a name and a phone or street, and describes the business", { skip }, () => {
  const location = call("clean_location", business);
  const schema = call("business_schema", location, "Acme", "https://a.test/");
  assert.equal(schema["@type"], "Dentist");
  assert.equal(schema.name, "Smile Co");
  assert.equal(schema.address.streetAddress, "1 Main St");
  assert.deepEqual(schema.geo, { "@type": "GeoCoordinates", latitude: 30.2672, longitude: -97.7431 });
  assert.equal(schema.openingHoursSpecification.length, 1);
  assert.equal(schema.openingHoursSpecification[0].dayOfWeek, "Monday");
  assert.deepEqual(schema.sameAs, ["https://facebook.com/smile"]);
  const bare = call("clean_location", { name: "Only a name" });
  assert.equal(call("business_schema", bare, "Acme", "https://a.test/"), null);
  const named = call("clean_location", { phone: "555" });
  assert.equal(call("business_schema", named, "Acme", "https://a.test/").name, "Acme");
});

const loc = (id, extra = {}) => ({ id, name: `Shop ${id}`, phone: "555", ...extra });
const homePage = { ...page, kind: "home", url: "https://a.test/", home_url: "https://a.test/", post_id: 0 };
const local = (...locations) => ({ ...defaults, local: call("clean_local", { enabled: true, locations }) });

test("locations without a page go on the home page, in one graph when there are several", { skip }, () => {
  const one = call("head_html", local(loc("aaaa1111")), homePage);
  assert.match(
    one,
    /<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"LocalBusiness"/,
  );
  const two = call("head_html", local(loc("aaaa1111"), loc("bbbb2222")), homePage);
  assert.match(two, /"@graph":\[/);
  assert.equal(two.match(/"@type":"LocalBusiness"/g).length, 2);
  assert.ok(!call("head_html", local(loc("aaaa1111")), page).includes("ld+json"));
  assert.ok(!call("head_html", defaults, homePage).includes("ld+json"));
});

test("a location with a page is marked up on that page only, with that page's address", { skip }, () => {
  const settings = local(loc("aaaa1111", { page_id: 7 }), loc("bbbb2222"));
  const there = call("head_html", settings, { ...page, kind: "singular", post_id: 7, url: "https://a.test/austin/" });
  assert.match(there, /"name":"Shop aaaa1111"/);
  assert.match(there, /"url":"https:\/\/a\.test\/austin\/"/);
  assert.ok(!there.includes("Shop bbbb2222"));
  const elsewhere = call("head_html", settings, { ...page, kind: "singular", post_id: 8 });
  assert.ok(!elsewhere.includes("ld+json"));
  const home = call("head_html", settings, homePage);
  assert.ok(home.includes("Shop bbbb2222") && !home.includes("Shop aaaa1111"));
});

test("the schema script cannot be closed from a business name", { skip }, () => {
  const evil = local(loc("aaaa1111", { name: "</script><script>alert(1)</script>" }));
  assert.ok(!call("head_html", evil, homePage).includes("</script><script>"));
});

test("new settings default to hidden tags and attachments, and keep only valid names", { skip }, () => {
  assert.deepEqual(defaults.hidden_taxonomies, ["post_tag"]);
  assert.deepEqual(defaults.hidden_types, []);
  assert.equal(defaults.noindex_attachment, true);
  assert.equal(defaults.noindex_author_single, true);
  const out = call("clean", { hidden_taxonomies: ["category", "Bad Name", "category", 5], hidden_types: "page" });
  assert.deepEqual(out.hidden_taxonomies, ["category"]);
  assert.deepEqual(out.hidden_types, defaults.hidden_types);
});

const noindex = (settings, ctx) => call("wants_noindex", { ...defaults, ...settings }, ctx);

test("a page is hidden when a setting or its own flag says so", { skip }, () => {
  assert.equal(noindex({}, {}), false);
  assert.equal(noindex({}, { flagged: true }), true);
  assert.equal(noindex({}, { search: true }), true);
  assert.equal(noindex({}, { attachment: true }), true);
  assert.equal(noindex({ noindex_attachment: false }, { attachment: true }), false);
  assert.equal(noindex({}, { taxonomy: "post_tag" }), true);
  assert.equal(noindex({}, { taxonomy: "category" }), false);
  assert.equal(noindex({ hidden_types: ["page"] }, { post_type: "page" }), true);
});

test("an author page is hidden on a one-author site unless that is switched off", { skip }, () => {
  const ctx = { author: true, single_author: true };
  assert.equal(noindex({ noindex_author: false }, ctx), true);
  assert.equal(noindex({ noindex_author: false, noindex_author_single: false }, ctx), false);
  assert.equal(noindex({ noindex_author: false }, { author: true, single_author: false }), false);
  assert.equal(noindex({ noindex_author: true }, { author: true, single_author: false }), true);
});

test("the placeholder tagline is not used, and later pages get a page number", { skip }, () => {
  assert.equal(call("usable_tagline", "Just another WordPress site"), "");
  assert.equal(call("usable_tagline", " Fresh bread daily "), "Fresh bread daily");
  assert.equal(call("with_page_number", "Blog | Shop", "|", 1, "Page %s"), "Blog | Shop");
  assert.equal(call("with_page_number", "Blog | Shop", "|", 3, "Page %s"), "Blog | Shop | Page 3");
});
