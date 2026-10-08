import assert from "node:assert/strict";
import test from "node:test";
import { correlate, describe, pearson, toDaily } from "../src/shared/correlation.ts";

test("pearson", () => {
  assert.equal(Math.round(pearson([1, 2, 3, 4], [2, 4, 6, 8]) * 100), 100);
  assert.equal(Math.round(pearson([1, 2, 3, 4], [8, 6, 4, 2]) * 100), -100);
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
  assert.equal(pearson([1], [1]), null);
});

test("toDaily adds hourly points into days", () => {
  const days = toDaily(
    [{ label: "2026-10-01 01:00:00", n: 2 }, { label: "2026-10-01 02:00:00", n: 3 }, { label: "bad", n: 9 }],
    (p) => p.n,
  );
  assert.deepEqual([...days], [["2026-10-01", 5]]);
});

test("correlate uses shared days and skips short overlaps", () => {
  const mk = (name, values, start = 1) =>
    ({ name, source: name, days: new Map(values.map((v, i) => [`2026-10-${String(start + i).padStart(2, "0")}`, v])) });
  const result = correlate([mk("a", [1, 2, 3, 4, 5, 6]), mk("b", [2, 4, 6, 8, 10, 12]), mk("c", [1, 2], 1)]);
  assert.equal(result.length, 1);
  assert.equal(Math.round(result[0].r * 100), 100);
  assert.equal(describe(result[0].r), "Very strong positive");
  assert.equal(describe(0.05), "No clear link");
});
