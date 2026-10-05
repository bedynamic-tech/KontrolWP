import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function call(fn, ...args) {
  const result = spawnSync("php", ["tests/php/links.php"], {
    input: JSON.stringify({ fn, args }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

const BASE = "https://example.test/guide/";

test("extract lists links and images, made absolute", { skip }, () => {
  const out = call(
    "extract",
    '<p><a href="/a/">A</a> <a href="b">B</a> <img src="//cdn.test/x.png" alt="X"> <a href="#top">top</a> <a href="mailto:x@y.z">m</a></p>',
    BASE,
  );
  assert.deepEqual(
    out.map((link) => [link.kind, link.url]),
    [
      ["link", "https://example.test/a/"],
      ["link", "https://example.test/guide/b"],
      ["image", "https://cdn.test/x.png"],
    ],
  );
});

test(
  "merge keeps each address once per kind and keeps links that only the rendered page has",
  { skip },
  () => {
    const saved = call(
      "extract",
      '<a href="/a/">A</a><img src="/i.png">',
      BASE,
    );
    const rendered = call(
      "extract",
      '<a href="/a/">A</a><a href="/services/cloud-solutions/">Cloud</a><img src="/i.png">',
      BASE,
    );
    const merged = call("merge", saved, rendered);
    assert.deepEqual(
      merged.map((link) => `${link.kind} ${link.url}`),
      [
        "link https://example.test/a/",
        "image https://example.test/i.png",
        "link https://example.test/services/cloud-solutions/",
      ],
    );
    assert.deepEqual(call("merge", [], []), []);
  },
);
