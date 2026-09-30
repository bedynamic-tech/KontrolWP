import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { applyMigrations, MigrationError, splitStatements } from "../src/worker/db/migrate.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

const columns = (sqlite, table) => sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

test("splitStatements ignores semicolons in comments and strings", () => {
  assert.deepEqual(
    splitStatements("-- a; b\nCREATE TABLE t (x TEXT DEFAULT 'a;b');\n/* c; */ ALTER TABLE t ADD COLUMN y TEXT;"),
    ["CREATE TABLE t (x TEXT DEFAULT 'a;b')", "ALTER TABLE t ADD COLUMN y TEXT"],
  );
});

test("a fresh database gets every migration, recorded like Wrangler does", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const ran = await applyMigrations(fakeD1(sqlite), migrations);
  assert.deepEqual(ran, migrations.map((m) => m.name).sort());
  assert.ok(columns(sqlite, "sites").includes("key_id"));
  assert.deepEqual(await applyMigrations(fakeD1(sqlite), migrations), [], "a second run does nothing");
});

test("a database left on 0001 by a deploy that skipped migrations is brought up to date", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = fakeD1(sqlite);
  // What `wrangler d1 migrations apply` leaves behind after the first migration.
  await applyMigrations(db, migrations.slice(0, 1));
  assert.equal(columns(sqlite, "sites").includes("key_id"), false);
  assert.deepEqual(await applyMigrations(db, migrations), migrations.slice(1).map((m) => m.name));
  assert.ok(columns(sqlite, "sites").includes("key_id"));
  const recorded = sqlite.prepare("SELECT name FROM d1_migrations ORDER BY id").all().map((r) => r.name);
  assert.deepEqual(recorded, migrations.map((m) => m.name));
});

test("a failing migration rolls back and names itself", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const bad = [{ name: "0001_bad.sql", sql: "CREATE TABLE a (x TEXT); ALTER TABLE missing ADD COLUMN y TEXT;" }];
  await assert.rejects(applyMigrations(fakeD1(sqlite), bad), (error) => {
    assert.ok(error instanceof MigrationError);
    assert.match(error.message, /0001_bad\.sql/);
    return true;
  });
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'a'").get().n, 0);
});
