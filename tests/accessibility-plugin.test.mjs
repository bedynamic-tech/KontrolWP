import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function transform(html, fixes) {
  const result = spawnSync("php", ["tests/php/accessibility.php"], { input: JSON.stringify({ html, fixes }), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout;
}

const page = (body, head = "") => `<!doctype html><html lang="en"><head><title>T</title>${head}</head><body class="home">${body}</body></html>`;

test("images without alt are marked decorative, and described ones are left alone", { skip }, () => {
  const out = transform(page('<img src="a.png"><img src="b.png" alt="A cat"><img src="c.png" alt="">'), ["image_alt"]);
  assert.match(out, /<img src="a\.png" alt="">/);
  assert.match(out, /<img src="b\.png" alt="A cat">/);
  assert.equal(out.match(/alt=""/g).length, 2);
});

test("a viewport that blocks zooming is rewritten", { skip }, () => {
  const head = '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">';
  const out = transform(page("", head), ["viewport_zoom"]);
  assert.match(out, /content="width=device-width, initial-scale=1"/);
  const fine = '<meta name="viewport" content="width=device-width, initial-scale=1">';
  assert.ok(transform(page("", fine), ["viewport_zoom"]).includes(fine));
});

test("frames without a title are named for their site", { skip }, () => {
  const out = transform(page('<iframe src="https://www.youtube.com/embed/x"></iframe><iframe src="https://a.test" title="Map"></iframe>'), ["frame_titles"]);
  assert.match(out, /title="Embedded content from www\.youtube\.com"/);
  assert.match(out, /title="Map"/);
});

test("fields are named from their placeholder unless something already labels them", { skip }, () => {
  const body =
    '<label for="a">A</label><input id="a" type="text">' +
    '<label>Wrapped <input type="text"></label>' +
    '<input type="email" placeholder="Your email">' +
    '<input type="text" aria-label="Done">' +
    '<input type="hidden" placeholder="no">' +
    '<input type="submit" placeholder="no">' +
    '<input type="text">';
  const out = transform(page(body), ["form_labels"]);
  assert.match(out, /<input type="email" placeholder="Your email" aria-label="Your email">/);
  assert.equal(out.match(/aria-label=/g).length, 2);
  assert.ok(out.includes('<label>Wrapped <input type="text"></label>'));
});

test("icon-only links get a name, and named links are left alone", { skip }, () => {
  const body =
    '<a href="https://www.facebook.com/x"><svg></svg></a>' +
    '<a href="mailto:a@b.test"><i class="icon"></i></a>' +
    '<a href="https://example.com/z"><svg></svg></a>' +
    '<a href="/about">About</a>' +
    '<a href="/x"><img src="l.png" alt="Home"></a>' +
    '<a href="/y"><span class="screen-reader-text">Read</span></a>';
  const out = transform(page(body), ["link_names"]);
  assert.match(out, /<a href="https:\/\/www\.facebook\.com\/x" aria-label="Facebook"><svg><\/svg><\/a>/);
  assert.match(out, /aria-label="Email"/);
  assert.equal(out.match(/aria-label=/g).length, 2);
});

test("a skip link goes to the main content, once", { skip }, () => {
  const out = transform(page('<header>H</header><main><p>Hi</p></main>'), ["skip_link"]);
  assert.match(out, /<body class="home"><style>.*<\/style><a class="kontrolwp-skip-link" href="#kontrolwp-main">Skip to content<\/a>/);
  assert.match(out, /<main id="kontrolwp-main">/);
  const again = transform(out, ["skip_link"]);
  assert.equal(again.match(/kontrolwp-skip-link" href/g).length, 1);
  const own = transform(page('<main id="content">x</main>'), ["skip_link"]);
  assert.match(own, /href="#content"/);
  const none = page("<div>nothing to jump to</div>");
  assert.equal(transform(none, ["skip_link"]), none);
});

test("with no fixes on, a page is unchanged", { skip }, () => {
  const html = page('<img src="a.png"><a href="https://facebook.com/x"><svg></svg></a>');
  assert.equal(transform(html, []), html);
});
