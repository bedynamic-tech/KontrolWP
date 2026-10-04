import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function archives(fn, ...args) {
  const result = spawnSync("php", ["tests/php/seo-archives.php"], {
    input: JSON.stringify({ fn, args }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

function seo(fn, ...args) {
  const result = spawnSync("php", ["tests/php/seo.php"], {
    input: JSON.stringify({ fn, args }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

function content(fn, ...args) {
  const result = spawnSync("php", ["tests/php/seo-content.php"], {
    input: JSON.stringify({ fn, args }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

test(
  "the category base is dropped only from an address that has it right after the home address",
  { skip },
  () => {
    assert.equal(
      archives(
        "strip_category_base",
        "https://a.test/category/news/",
        "https://a.test/",
        "category",
      ),
      "https://a.test/news/",
    );
    assert.equal(
      archives(
        "strip_category_base",
        "https://a.test/category/news/local/",
        "https://a.test",
        "category",
      ),
      "https://a.test/news/local/",
    );
    assert.equal(
      archives(
        "strip_category_base",
        "https://a.test/blog/category/news/",
        "https://a.test/",
        "category",
      ),
      "https://a.test/blog/category/news/",
    );
    assert.equal(
      archives(
        "strip_category_base",
        "https://a.test/topics/news/",
        "https://a.test/",
        "/topics/",
      ),
      "https://a.test/news/",
    );
    assert.equal(
      archives(
        "strip_category_base",
        "https://a.test/category/news/",
        "https://a.test/",
        "",
      ),
      "https://a.test/category/news/",
    );
  },
);

test(
  "the old path redirects to the new one, keeping the page number and query",
  { skip },
  () => {
    assert.equal(
      archives(
        "strip_category_base_path",
        "/category/news/page/2/?x=1",
        "",
        "category",
      ),
      "/news/page/2/?x=1",
    );
    assert.equal(
      archives(
        "strip_category_base_path",
        "/site/category/news/",
        "/site",
        "category",
      ),
      "/site/news/",
    );
    assert.equal(
      archives("strip_category_base_path", "/news/", "", "category"),
      "/news/",
    );
  },
);

test(
  "a category never takes the address of a page, a post or a WordPress path",
  { skip },
  () => {
    const out = archives(
      "eligible_categories",
      [
        { id: 1, path: "news" },
        { id: 2, path: "about" },
        { id: 3, path: "feed" },
        { id: 4, path: "news/local" },
        { id: 5, path: "tag/odd" },
      ],
      ["about"],
    );
    assert.deepEqual(out.eligible, { 1: "news", 4: "news/local" });
    assert.deepEqual(out.skipped, ["about", "feed", "tag/odd"]);
    const capped = archives(
      "eligible_categories",
      [
        { id: 1, path: "a" },
        { id: 2, path: "b" },
      ],
      [],
      1,
    );
    assert.deepEqual(capped.eligible, { 1: "a" });
    assert.deepEqual(capped.skipped, ["b"]);
  },
);

test(
  "each category gets rules for its page, feed and later pages",
  { skip },
  () => {
    const rules = archives("category_rules", ["news", "news/local"]);
    assert.equal(rules["^news/?$"], "index.php?category_name=news");
    assert.equal(
      rules["^news/page/?([0-9]{1,})/?$"],
      "index.php?category_name=news&paged=$matches[1]",
    );
    assert.equal(
      rules["^news/feed/(feed|rdf|rss|rss2|atom)/?$"],
      "index.php?category_name=news&feed=$matches[1]",
    );
    assert.equal(
      rules["^news\\/local/?$"],
      "index.php?category_name=news/local",
    );
  },
);

test(
  "the new SEO settings are off by default and keep only valid values",
  { skip },
  () => {
    const defaults = seo("clean", {});
    assert.equal(defaults.strip_category_base, false);
    assert.equal(defaults.author_archives, "keep");
    assert.deepEqual(defaults.type_templates, []);
    const out = seo("clean", {
      strip_category_base: true,
      author_archives: "bogus",
      type_templates: {
        product: {
          title: "<b>%title%</b> | Shop",
          description: "Buy %title%. %excerpt%",
        },
        "Bad Name": { title: "x" },
        empty: { title: "", description: "" },
        notAnObject: "x",
      },
    });
    assert.equal(out.strip_category_base, true);
    assert.equal(out.author_archives, "keep");
    assert.deepEqual(Object.keys(out.type_templates), ["product"]);
    assert.equal(out.type_templates.product.title, "%title% | Shop");
    assert.equal(
      seo("clean", { author_archives: "404" }).author_archives,
      "404",
    );
    assert.equal(
      seo("clean", { author_archives: "redirect" }).author_archives,
      "redirect",
    );
  },
);

test(
  "a content type uses its own templates and falls back to the site-wide title",
  { skip },
  () => {
    const settings = seo("clean", {
      title_template: "%title% %sep% Acme",
      type_templates: {
        product: { title: "%title% | Shop", description: "Buy %title%" },
      },
    });
    assert.equal(
      seo("title_template_for", settings, "product"),
      "%title% | Shop",
    );
    assert.equal(
      seo("title_template_for", settings, "post"),
      "%title% %sep% Acme",
    );
    assert.equal(
      seo("description_template_for", settings, "product"),
      "Buy %title%",
    );
    assert.equal(seo("description_template_for", settings, "post"), "");
    const own = seo("clean", {
      type_templates: { product: { description: "Only a description" } },
    });
    assert.equal(seo("title_template_for", own, "product"), own.title_template);
  },
);

test("the excerpt token fills in a description template", { skip }, () => {
  assert.equal(
    seo("fill_template", "Buy %title%. %excerpt%", {
      title: "Mug",
      excerpt: "A fine mug.",
    }),
    "Buy Mug. A fine mug.",
  );
});

test(
  "image titles come from the library title or the file name, never a camera name",
  { skip },
  () => {
    assert.equal(content("image_title_text", "Blue mug", "x.jpg"), "Blue mug");
    assert.equal(
      content("image_title_text", "IMG_1234", "blue-mug.jpg"),
      "blue mug",
    );
    assert.equal(content("image_title_text", "IMG_1234", "IMG_1234.jpg"), "");
    assert.equal(content("clean", {}).image_title, false);
    assert.equal(content("clean", { image_title: true }).image_title, true);
  },
);
