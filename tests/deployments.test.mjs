import assert from "node:assert/strict";
import test from "node:test";
import { visibleDeployments } from "../src/shared/deployments.ts";

const dep = (ref, created_at) => ({ type: "deployment", ref, created_at, status: "live", message: "", author: "", source: "wrangler", branch: "", commit_hash: "" });
const build = (ref, created_at, status = "success") => ({ type: "build", ref, created_at, status, message: "", author: "", source: "", branch: "main", commit_hash: "abc1234" });

test("only builds are listed, and the build behind the live version is marked", () => {
  const rows = [dep("d2", 1000), build("b2", 990), dep("d1", 500), build("b1", 490)];
  const shown = visibleDeployments(rows);
  assert.deepEqual(shown.rows.map((r) => r.ref), ["b2", "b1"]);
  assert.equal(shown.live, "b2");
});

test("a newer build that has not gone live yet is not marked", () => {
  const rows = [build("b3", 2000, "building"), dep("d2", 1000), build("b2", 990), build("b1", 490)];
  const shown = visibleDeployments(rows);
  assert.deepEqual(shown.rows.map((r) => r.ref), ["b3", "b2", "b1"]);
  assert.equal(shown.live, "b2");
});

test("a failed build is never the live one", () => {
  const rows = [dep("d1", 1000), build("b2", 990, "failed"), build("b1", 490)];
  assert.equal(visibleDeployments(rows).live, "b1");
});

test("a live version no build explains stays in the list, and a site with no builds keeps its deployments", () => {
  const manual = visibleDeployments([dep("d1", 1000), build("b1", 5000)]);
  assert.deepEqual(manual.rows.map((r) => r.ref), ["d1", "b1"]);
  assert.equal(manual.live, "d1");
  const only = visibleDeployments([dep("d2", 2), dep("d1", 1)]);
  assert.deepEqual(only.rows.map((r) => r.ref), ["d2", "d1"]);
  assert.equal(only.live, "d2");
  assert.deepEqual(visibleDeployments([]), { rows: [], live: null });
});
