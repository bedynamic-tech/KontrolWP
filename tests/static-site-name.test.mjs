import assert from "node:assert/strict";
import test from "node:test";
import { siteNameFromHtml } from "../src/worker/sites/static.ts";

test("prefers og:site_name", () => {
  const html =
    '<head><title>Home | Acme</title><meta property="og:site_name" content="Acme &amp; Co"></head>';
  assert.equal(siteNameFromHtml(html), "Acme & Co");
});

test("falls back to the title without its tagline or a generic word", () => {
  assert.equal(
    siteNameFromHtml("<title>Acme Plumbing | Fast repairs in Austin</title>"),
    "Acme Plumbing",
  );
  assert.equal(siteNameFromHtml("<title>Home - Acme</title>"), "Acme");
  assert.equal(siteNameFromHtml("<title>Acme</title>"), "Acme");
  assert.equal(siteNameFromHtml("<p>no title</p>"), "");
});
