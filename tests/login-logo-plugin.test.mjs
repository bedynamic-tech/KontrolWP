import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function call(fn, ...args) {
  const result = spawnSync("php", ["tests/php/login-logo.php"], {
    input: JSON.stringify({ fn, args }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

// A 1 by 1 PNG and a 1 by 1 GIF.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

test("the saved setting is cleaned, with medium as the default size", { skip }, () => {
  assert.deepEqual(call("clean", null), { enabled: false, size: "medium", attachment: 0, width: 0, height: 0 });
  assert.deepEqual(call("clean", { enabled: 1, size: "huge", attachment: "12", width: -3, height: "40" }), {
    enabled: true,
    size: "medium",
    attachment: 12,
    width: 0,
    height: 40,
  });
  assert.equal(call("clean", { size: "large" }).size, "large");
});

test("the logo fits its size's box, keeps its shape and is never enlarged", { skip }, () => {
  assert.deepEqual(call("fit", 400, 200, "medium"), [200, 100]);
  assert.deepEqual(call("fit", 1000, 100, "large"), [320, 32]);
  assert.deepEqual(call("fit", 200, 400, "small"), [42, 84]);
  assert.deepEqual(call("fit", 50, 30, "large"), [50, 30]);
  assert.deepEqual(call("fit", 0, 0, "small"), [84, 84]);
});

test("only PNG, JPEG, GIF and WebP images up to 1 MB are taken", { skip }, () => {
  assert.deepEqual(call("inspect", PNG), { mime: "image/png", ext: "png", width: 1, height: 1 });
  assert.equal(call("inspect", GIF).ext, "gif");
  assert.equal(typeof call("inspect", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64")), "string");
  assert.equal(typeof call("inspect", Buffer.from("not an image").toString("base64")), "string");
  assert.equal(typeof call("inspect", ""), "string");
});

test("the login page CSS swaps the logo at the drawn size", { skip }, () => {
  const css = call("css", "https://example.com/logo.png", 200, 100);
  assert.match(css, /#login h1 a/);
  assert.match(css, /background-image: url\("https:\/\/example\.com\/logo\.png"\)/);
  assert.match(css, /width: 200px; height: 100px;/);
});
