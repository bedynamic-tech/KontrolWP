import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { linksTable, toCsv, toXlsx } from "../src/web/export.ts";

const link = (over) => ({
  url: "https://example.com/gone",
  status: "broken",
  http_status: 404,
  error: null,
  checked_at: 1790000000,
  ignored: false,
  refs: [
    {
      post_id: 1,
      post_title: "Hello, world",
      post_type: "post",
      permalink: "https://site.test/hello",
      link_text: "x",
      kind: "link",
    },
    {
      post_id: 1,
      post_title: "Hello, world",
      post_type: "post",
      permalink: "https://site.test/hello",
      link_text: "y",
      kind: "image",
    },
  ],
  ...over,
});

test("one row per link, with each post listed once", () => {
  const table = linksTable([
    link({}),
    link({ status: "blocked", http_status: null, error: "Timed out", ignored: true }),
  ]);
  assert.equal(table.length, 3);
  assert.deepEqual(table[1].slice(0, 4), ["Broken", "404", "", "https://example.com/gone"]);
  assert.equal(table[1][5], "Hello, world");
  assert.equal(table[2][0], "Couldn't check (ignored)");
  assert.equal(table[2][2], "Timed out");
});

test("csv quotes cells, uses a byte order mark and defuses formulas", () => {
  const csv = toCsv([
    ["a", "b"],
    ['say "hi", ok', "=SUM(1)"],
  ]);
  assert.equal(csv, '﻿a,b\r\n"say ""hi"", ok",\'=SUM(1)\r\n');
});

test("xlsx is a valid zip holding the sheet", () => {
  const bytes = toXlsx([
    ["Status", "URL"],
    ["Broken", "https://a.test/?x=1&y=<2>"],
  ]);
  const dir = mkdtempSync(join(tmpdir(), "xlsx-"));
  const file = join(dir, "links.xlsx");
  writeFileSync(file, bytes);
  const listing = execFileSync("unzip", ["-t", file]).toString();
  assert.match(listing, /No errors detected/);
  const sheet = execFileSync("unzip", ["-p", file, "xl/worksheets/sheet1.xml"]).toString();
  assert.match(sheet, /https:\/\/a\.test\/\?x=1&amp;y=&lt;2&gt;/);
  assert.ok(readFileSync(file).length > 100);
});
