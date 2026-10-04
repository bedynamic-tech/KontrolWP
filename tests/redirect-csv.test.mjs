import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, redirectsFromCsv, redirectsToCsv } from "../src/shared/redirect-csv.ts";

test("quoted cells keep commas, quotes and line breaks", () => {
  assert.deepEqual(parseCsv('a,"b,c","say ""hi""","x\ny"\r\nd,e,f,g\n'), [
    ["a", "b,c", 'say "hi"', "x\ny"],
    ["d", "e", "f", "g"],
  ]);
});

test("a header row maps columns by name, in any order", () => {
  const rules = redirectsFromCsv("To,From,Code\n/new,/old,302\n");
  assert.deepEqual(rules, [{ match_type: "exact", status_code: 302, source: "/old", target: "/new" }]);
});

test("without a header the columns are source, target, code and match type", () => {
  const rules = redirectsFromCsv("/blog,/news/$1,308,prefix\n/gone,,410\n");
  assert.equal(rules[0].match_type, "prefix");
  assert.equal(rules[0].status_code, 308);
  assert.equal(rules[1].status_code, 410);
  assert.equal(rules[1].target, undefined);
});

test("an unknown code is dropped, so the default applies", () => {
  assert.equal(redirectsFromCsv("/a,/b,999\n")[0].status_code, 301);
});

test("exported rules read back the same", () => {
  const rule = {
    id: 1,
    source: "/a,b",
    target: "/c",
    status_code: 301,
    match_type: "exact",
    enabled: false,
    hits: 3,
    last_hit: 0,
  };
  const [back] = redirectsFromCsv(redirectsToCsv([rule]));
  assert.deepEqual(back, { source: "/a,b", target: "/c", status_code: 301, match_type: "exact", enabled: false });
});
