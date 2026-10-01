import assert from "node:assert/strict";
import test from "node:test";
import { applyMigrations } from "../src/worker/db/migrate.ts";
import { runScheduledSync } from "../src/worker/sites/sync.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

async function setup() {
  const db = fakeD1();
  await applyMigrations(db, migrations);
  db.sqlite.exec("INSERT INTO sites (name, url, secret) VALUES ('A', 'https://a.test', 'x')");
  const sent = [];
  const env = { DB: db, SYNC_QUEUE: { sendBatch: async (messages) => sent.push(...messages) } };
  return { db, env, sent };
}

test("the scheduled sync runs every hour unless Settings says otherwise", async () => {
  const { db, env, sent } = await setup();
  const start = 1_800_000_000;
  assert.equal(await runScheduledSync(env, start), true, "the first tick syncs");
  assert.equal(sent.length, 1);
  assert.equal(await runScheduledSync(env, start + 15 * 60), false, "15 minutes later is too soon");
  assert.equal(await runScheduledSync(env, start + 59 * 60), true, "a late tick near the hour still runs");

  db.sqlite.exec(`INSERT OR REPLACE INTO settings (name, value) VALUES ('sync', '{"interval_minutes":15}')`);
  assert.equal(await runScheduledSync(env, start + 74 * 60), true, "every 15 minutes when chosen");
  assert.equal(sent.length, 3);
});

test("an older KontrolWP Connect is queued on every tick, not only when a sync is due", async () => {
  const { db, env, sent } = await setup();
  const start = 1_800_000_000;
  await runScheduledSync(env, start);
  sent.length = 0;
  const sends = [];
  env.SYNC_QUEUE.send = async (message) => sends.push(message);
  db.sqlite.exec("UPDATE sites SET plugin_version = '0.7.2'");
  assert.equal(await runScheduledSync(env, start + 15 * 60), false, "no full sync yet");
  assert.deepEqual(sends, [{ type: "update", siteId: 1 }]);
  assert.equal(db.sqlite.prepare("SELECT status FROM update_jobs").get().status, "queued");
  await runScheduledSync(env, start + 30 * 60);
  assert.equal(sends.length, 1, "an update already queued is not queued twice");
});
