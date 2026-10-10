import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const hasZip = hasPhp && spawnSync("php", ["-r", "exit(class_exists('ZipArchive') ? 0 : 1);"]).status === 0;
const skip = !hasZip && "php with the zip extension is not installed";

/** A wp-content with Akismet in its own folder and a single-file plugin. */
function content() {
  const dir = mkdtempSync(join(tmpdir(), "kontrolwp-rollback-"));
  mkdirSync(join(dir, "plugins/akismet/views"), { recursive: true });
  writeFileSync(join(dir, "plugins/akismet/akismet.php"), "<?php // Akismet 5.2");
  writeFileSync(join(dir, "plugins/akismet/views/notice.php"), "<?php // notice");
  writeFileSync(join(dir, "plugins/hello.php"), "<?php // Hello Dolly");
  return dir;
}

const installed = (version) => ({
  "akismet/akismet.php": { Name: "Akismet", Version: version },
  "hello.php": { Name: "Hello Dolly", Version: "1.7" },
  "kontrolwp-connect/kontrolwp-connect.php": { Name: "KontrolWP Connect", Version: "1.0" },
});

function run(dir, steps) {
  const result = spawnSync("php", ["tests/php/rollback.php"], {
    input: JSON.stringify({ content: dir, steps }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

test("an update keeps the installed plugin as a zip WordPress can install, listed once the new version is in", { skip }, () => {
  const dir = content();
  try {
    const [, backup, , after, files] = run(dir, [
      ["plugins", installed("5.2")],
      ["prepare_commit", "plugin", "akismet/akismet.php"],
      ["plugins", installed("5.3")],
      ["items"],
      ["files"],
    ]);
    assert.equal(backup.version, "5.2");
    assert.equal(backup.name, "Akismet");
    assert.match(backup.file, /^plugin-akismet-[0-9a-f]{20}\.zip$/);
    const [zipEntries] = run(dir, [["zip_entries", backup.file]]);
    assert.deepEqual(zipEntries, ["akismet/", "akismet/akismet.php", "akismet/views/", "akismet/views/notice.php"]);
    assert.equal(after.length, 1);
    assert.deepEqual(
      { ...after[0], created_at: 0 },
      { kind: "plugin", slug: "akismet/akismet.php", name: "Akismet", version: "5.2", current_version: "5.3", created_at: 0 },
    );
    // Guards keep the folder from being served.
    assert.ok(files.includes(".htaccess") && files.includes("index.php"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a later update replaces the kept copy, and a failed one leaves it", { skip }, () => {
  const dir = content();
  try {
    const [, first, , second, failed, items, files] = run(dir, [
      ["plugins", installed("5.2")],
      ["prepare_commit", "plugin", "akismet/akismet.php"],
      ["plugins", installed("5.3")],
      ["prepare_commit", "plugin", "akismet/akismet.php"],
      ["prepare_discard", "plugin", "akismet/akismet.php"],
      ["items"],
      ["files"],
    ]);
    assert.equal(first.version, "5.2");
    assert.equal(second.version, "5.3");
    assert.equal(failed.version, "5.3");
    // Installed is still 5.3, the same as the kept copy, so it is dropped as already in place.
    assert.deepEqual(items, []);
    assert.deepEqual(files.filter((name) => name.endsWith(".zip")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("single-file plugins and KontrolWP Connect are not kept; old or removed copies are deleted", { skip }, () => {
  const dir = content();
  try {
    const [, single, self, , , , old, kept, , , removed, files] = run(dir, [
      ["plugins", installed("5.2")],
      ["prepare_commit", "plugin", "hello.php"],
      ["prepare_commit", "plugin", "kontrolwp-connect/kontrolwp-connect.php"],
      ["prepare_commit", "plugin", "akismet/akismet.php"],
      ["plugins", installed("5.3")],
      ["age", 31],
      ["items"],
      ["prepare_commit", "plugin", "akismet/akismet.php"],
      ["plugins", installed("5.4")],
      ["plugins", { "hello.php": { Name: "Hello Dolly", Version: "1.7" } }],
      ["items"],
      ["files"],
    ]);
    assert.equal(single, null);
    assert.equal(self, null);
    assert.deepEqual(old, []);
    assert.equal(kept.version, "5.3");
    assert.deepEqual(removed, []);
    assert.deepEqual(files.filter((name) => name.endsWith(".zip")), []);
    assert.ok(!existsSync(join(dir, "kontrolwp-rollback", kept.file)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uninstall removes the folder and the list", { skip }, () => {
  const dir = content();
  try {
    run(dir, [
      ["plugins", installed("5.2")],
      ["prepare_commit", "plugin", "akismet/akismet.php"],
      ["delete_all"],
    ]);
    assert.ok(!existsSync(join(dir, "kontrolwp-rollback")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
