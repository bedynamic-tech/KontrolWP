import assert from "node:assert/strict";
import test from "node:test";
import { findIcon } from "../src/worker/sites/icons.ts";

const page = "https://example.com/blog/";

test("finds the icon a theme or SEO plugin declares, preferring the largest", () => {
  const html = `<html><head>
    <link rel="stylesheet" href="/style.css">
    <link rel="shortcut icon" href="/wp-content/uploads/favicon.ico">
    <link rel='icon' href='https://cdn.example.com/icon-32.png' sizes='32x32'>
    <link rel="icon" href="/wp-content/uploads/icon-192.png?v=1&amp;x=2" sizes="192x192">
    <link rel="apple-touch-icon" href="touch.png">
  </head><body><link rel="icon" href="/late.svg"></body></html>`;
  assert.equal(findIcon(html, page), "https://example.com/wp-content/uploads/icon-192.png?v=1&x=2");
});

test("prefers SVG and resolves relative links against the page", () => {
  assert.equal(findIcon('<head><link rel="icon" type="image/svg+xml" href="logo.svg"><link rel="icon" href="/a.png" sizes="512x512">', page), "https://example.com/blog/logo.svg");
});

test("ignores data and http icons, and pages without any", () => {
  assert.equal(findIcon('<head><link rel="icon" href="data:image/png;base64,AAAA"><link rel="icon" href="http://example.com/x.png">', page), null);
  assert.equal(findIcon("<html><head><title>Hi</title></head></html>", page), null);
});
