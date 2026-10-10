import assert from "node:assert/strict";
import test from "node:test";
import { applyMigrations } from "../src/worker/db/migrate.ts";
import { siteRowChanges } from "../src/worker/db/site-rows.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

test("only new, changed and removed rows are written", async () => {
  const db = fakeD1();
  await applyMigrations(db, migrations);
  db.sqlite.prepare("INSERT INTO sites (id, name, url, key_id, secret) VALUES (1, 'Example', 'https://example.com', 'k', '')").run();
  const spec = (rows) => ({
    table: "site_users",
    siteId: 1,
    key: ["user_id"],
    columns: ["user_id", "login", "email", "display_name", "roles", "registered"],
    rows,
  });
  const alice = [1, "alice", "a@example.com", "Alice", "administrator", 100];
  const bob = [2, "bob", "b@example.com", "Bob", "editor", 200];
  await db.batch(await siteRowChanges(db, spec([alice, bob])));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM site_users").get().n, 2);

  assert.deepEqual(await siteRowChanges(db, spec([bob, alice])), []);

  const changes = await siteRowChanges(db, spec([[1, "alice", "a@example.com", "Alice", "editor", 100], [3, "cy", "", "", "", 0]]));
  assert.equal(changes.length, 3);
  await db.batch(changes);
  assert.deepEqual(
    db.sqlite.prepare("SELECT user_id, roles FROM site_users ORDER BY user_id").all().map((row) => ({ ...row })),
    [{ user_id: 1, roles: "editor" }, { user_id: 3, roles: "" }],
  );
});
