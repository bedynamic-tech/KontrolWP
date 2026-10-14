import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function call(fn, ...args) {
  const result = spawnSync("php", ["tests/php/posts.php"], { input: JSON.stringify({ fn, args }), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("a new post keeps its HTML and only known fields", { skip }, () => {
  const html = '<p>Hi</p><iframe src="https://www.youtube.com/embed/x"></iframe>';
  assert.deepEqual(
    call("clean_post", { type: "post", title: " Hello ", content: html, status: "publish", author: "3", categories: [2, "2", -1, 0, 5], tags: [" a ", "", "a", "b", 4], bogus: 1 }, ["post", "page"]),
    { type: "post", title: "Hello", content: html, status: "publish", author: 3, categories: [2, 5], tags: ["a", "b"], featured: 0 },
  );
});

test("a new post needs a known type and status, and a title to publish", { skip }, () => {
  assert.match(call("clean_post", { type: "product", title: "x" }, ["post"]), /no content type/);
  assert.match(call("clean_post", { type: "post", title: "x", status: "future" }, ["post"]), /draft or publish/);
  assert.match(call("clean_post", { type: "post", title: " ", content: "" }, ["post"]), /title or some content/);
  assert.match(call("clean_post", { type: "post", content: "<p>x</p>", status: "publish" }, ["post"]), /title before publishing/);
  assert.equal(call("clean_post", { type: "post", content: "<p>x</p>" }, ["post"]).status, "draft");
});

test("the upload limit leaves room for base64 in the request", { skip }, () => {
  assert.equal(call("upload_limit", 2 * 1048576, 8 * 1048576), 2 * 1048576);
  assert.equal(call("upload_limit", 64 * 1048576, 8 * 1048576), Math.floor((8 * 1048576 - 65536) * 3 / 4));
  assert.equal(call("upload_limit", 0, 0), 10 * 1048576);
});

test("only images within the limit are taken", { skip }, () => {
  assert.deepEqual(call("inspect", PNG, 1000), { mime: "image/png", ext: "png" });
  assert.match(call("inspect", PNG, 10), /larger than this site accepts \(0 MB\)/);
  assert.match(call("inspect", Buffer.from("<svg/>").toString("base64"), 1000), /JPEG, PNG/);
  assert.match(call("inspect", "", 1000), /Choose an image/);
});

test("file names are made safe and match the image", { skip }, () => {
  assert.equal(call("file_name", "My Photo (1).JPG", "png"), "My-Photo-1.png");
  assert.equal(call("file_name", "../../evil.php", "jpg"), "evil.jpg");
  assert.equal(call("file_name", "", "gif"), "image.gif");
});
