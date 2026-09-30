import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;

function phpFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? phpFiles(path) : path.endsWith(".php") ? [path] : [];
  });
}

test("every Presser Connect PHP file parses", { skip: !hasPhp && "php is not installed" }, () => {
  for (const file of phpFiles("plugin/presser-connect")) {
    const result = spawnSync("php", ["-l", file], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}\n${result.stdout}${result.stderr}`);
  }
});
