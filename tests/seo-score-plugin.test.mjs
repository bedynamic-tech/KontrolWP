import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function call(fn, ...args) {
  const result = spawnSync("php", ["tests/php/seo-score.php"], {
    input: JSON.stringify({ fn, args }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

const sentence =
  "The quick brown fox jumps over the lazy dog near the river bank today. ";
const good = {
  keyword: "Blue Mug",
  title: "The best blue mug for tea",
  description:
    "A hand made blue mug that keeps tea warm for longer, with a handle that stays cool in your hand all day.",
  content: `<p>${sentence.repeat(12)}</p><h2>Care</h2><p>${sentence.repeat(12)} <a href="/shop">Shop</a> <a href="https://other.test/x">Source</a></p><img src="a.jpg" alt="A blue mug">`,
  home_host: "a.test",
};
const byId = (out) =>
  Object.fromEntries(out.checks.map((c) => [c.id, c.status]));

test("a well made page is good, with every check passing", { skip }, () => {
  const out = call("analyze", good);
  assert.equal(out.status, "good");
  assert.deepEqual(byId(out), {
    keyword_title: "good",
    description_length: "good",
    headings: "good",
    internal_links: "good",
    external_links: "good",
    image_alt: "good",
    readability: "good",
  });
});

test("checks that need a keyword are skipped without one", { skip }, () => {
  const out = call("analyze", { ...good, keyword: "" });
  assert.equal(byId(out).keyword_title, "skipped");
  assert.equal(out.status, "good");
});

test("each problem is reported and makes the page need work", { skip }, () => {
  const out = call("analyze", {
    keyword: "red teapot",
    title: "Tea things",
    description: "Short.",
    content: `<p>${sentence.repeat(30)}</p><img src="a.jpg"><img src="b.jpg" alt="">`,
    home_host: "a.test",
  });
  const ids = byId(out);
  assert.equal(out.status, "needs_work");
  assert.equal(ids.keyword_title, "improve");
  assert.equal(ids.description_length, "improve");
  assert.equal(ids.headings, "improve");
  assert.equal(ids.internal_links, "improve");
  assert.equal(ids.image_alt, "improve");
});

test(
  "a missing outside link is optional and does not change the status",
  { skip },
  () => {
    const out = call("analyze", {
      ...good,
      content: good.content.replace(/<a href="https:[^>]*>Source<\/a>/, ""),
    });
    assert.equal(byId(out).external_links, "improve");
    assert.equal(
      out.checks.find((c) => c.id === "external_links").optional,
      true,
    );
    assert.equal(out.status, "good");
  },
);

test(
  "a short page is not asked for headings, links or readability",
  { skip },
  () => {
    const out = call("analyze", {
      ...good,
      content: "<p>Short and sweet.</p>",
    });
    const ids = byId(out);
    assert.equal(ids.headings, "skipped");
    assert.equal(ids.internal_links, "skipped");
    assert.equal(ids.readability, "skipped");
    assert.equal(ids.image_alt, "skipped");
  },
);

test("very long sentences hurt readability", { skip }, () => {
  const long = Array(40).fill("word").join(" ") + ". ";
  const out = call("analyze", { ...good, content: `<p>${long.repeat(5)}</p>` });
  assert.equal(byId(out).readability, "improve");
});

test(
  "a description is too long at 161 characters and too short at 69",
  { skip },
  () => {
    assert.equal(
      byId(call("analyze", { ...good, description: "x".repeat(161) }))
        .description_length,
      "improve",
    );
    assert.equal(
      byId(call("analyze", { ...good, description: "x".repeat(69) }))
        .description_length,
      "improve",
    );
    assert.equal(
      byId(call("analyze", { ...good, description: "x".repeat(160) }))
        .description_length,
      "good",
    );
    assert.equal(
      byId(call("analyze", { ...good, description: "x".repeat(70) }))
        .description_length,
      "good",
    );
    assert.equal(
      byId(call("analyze", { ...good, description: "" })).description_length,
      "improve",
    );
  },
);

test(
  "links are told apart by host, and anchors and mail links are ignored",
  { skip },
  () => {
    const html =
      '<a href="/a">1</a><a href="https://www.a.test/b">2</a><a href="//a.test/c">3</a><a href="https://other.test/">4</a><a href="#top">5</a><a href="mailto:x@a.test">6</a><a href="tel:1">7</a>';
    assert.deepEqual(call("count_links", html, "a.test"), {
      internal: 3,
      external: 1,
    });
  },
);

test(
  "an image with an empty alt counts as decoration, one with none does not",
  { skip },
  () => {
    assert.deepEqual(
      call(
        "count_images",
        '<img src="a"><img src="b" alt=""><img src="c" alt="x"><IMG SRC=d ALT=y>',
      ),
      { total: 4, missing: 1 },
    );
  },
);

test(
  "a keyword is plain text on one line and at most 80 characters",
  { skip },
  () => {
    assert.equal(call("clean_keyword", "  <b>blue</b>\n  mug "), "blue mug");
    assert.equal(call("clean_keyword", "x".repeat(200)).length, 80);
  },
);
