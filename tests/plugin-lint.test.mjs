import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { KONTROLWP_CONNECT_VERSION } from "../src/shared/plugin-version.ts";

const hasPhp = spawnSync("php", ["-v"]).status === 0;

function phpFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? phpFiles(path) : path.endsWith(".php") ? [path] : [];
  });
}

test("every KontrolWP Connect PHP file parses", { skip: !hasPhp && "php is not installed" }, () => {
  for (const file of phpFiles("plugin/kontrolwp-connect")) {
    const result = spawnSync("php", ["-l", file], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}\n${result.stdout}${result.stderr}`);
  }
});

test("the dashboard offers the plugin version it ships", () => {
  const main = readFileSync("plugin/kontrolwp-connect/kontrolwp-connect.php", "utf8");
  const readme = readFileSync("plugin/kontrolwp-connect/readme.txt", "utf8");
  assert.equal(main.match(/^ \* Version:\s+(\S+)/m)?.[1], KONTROLWP_CONNECT_VERSION);
  assert.equal(main.match(/define\( 'KONTROLWP_CONNECT_VERSION', '([^']+)' \)/)?.[1], KONTROLWP_CONNECT_VERSION);
  assert.equal(readme.match(/^Stable tag:\s+(\S+)/m)?.[1], KONTROLWP_CONNECT_VERSION);
});
