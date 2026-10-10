import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { DATABASE_ITEMS } from "../src/shared/types.ts";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const skip = !hasPhp && "php is not installed";

function call(fn, ...args) {
  const result = spawnSync("php", ["tests/php/database.php"], {
    input: JSON.stringify({ fn, args }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

test("cleanup items keep only known keys, once, in the usual order", { skip }, () => {
  assert.deepEqual(call("clean_items", ["spam_comments", "revisions", "drop_tables", "revisions"]), [
    "revisions",
    "spam_comments",
  ]);
  assert.deepEqual(call("clean_items", "revisions"), []);
  assert.deepEqual(call("clean_items", DATABASE_ITEMS), [...DATABASE_ITEMS]);
});

test("table totals add data, indexes and free space, largest first", { skip }, () => {
  const rows = [
    { Name: "wp_options", Rows: "300", Data_length: "1000", Index_length: "500", Data_free: "0", Engine: "InnoDB" },
    { Name: "wp_posts", Rows: "50", Data_length: "4000", Index_length: "1000", Data_free: "2048", Engine: "InnoDB" },
    { Name: "", Data_length: "99" },
  ];
  const summary = call("summarize_tables", rows);
  assert.equal(summary.size, 6500);
  assert.equal(summary.overhead, 2048);
  assert.equal(summary.count, 2);
  assert.deepEqual(
    summary.largest.map((table) => [table.name, table.bytes, table.rows]),
    [
      ["wp_posts", 5000, 50],
      ["wp_options", 1500, 300],
    ],
  );
  assert.deepEqual(call("summarize_tables", []), { size: 0, overhead: 0, count: 0, largest: [] });
});
