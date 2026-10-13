import assert from "node:assert/strict";
import test from "node:test";
import { applyMigrations } from "../src/worker/db/migrate.ts";
import { runScheduledSync, syncAllOnOpen } from "../src/worker/sites/sync.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

async function setup() {
  const db = fakeD1();
  await applyMigrations(db, migrations);
  db.sqlite.exec("INSERT INTO sites (name, url, secret) VALUES ('A', 'https://a.test', 'x')");
  const sent = [];
  const env = { DB: db, SYNC_QUEUE: { sendBatch: async (messages) => sent.push(...messages) } };
  return { db, env, sent };
}

test("the scheduled sync runs once a day, on the first tick after midnight", async () => {
  const { db, env, sent } = await setup();
  // 2027-01-15 00:00 UTC
  const midnight = Date.UTC(2027, 0, 15) / 1000;
  assert.equal(await runScheduledSync(env, midnight - 15 * 60), false, "not before midnight");
  assert.equal(await runScheduledSync(env, midnight), true, "the midnight tick syncs");
  assert.equal(sent.length, 1);
  assert.equal(await runScheduledSync(env, midnight + 15 * 60), false, "once that day");
  assert.equal(await runScheduledSync(env, midnight + 12 * 3600), false, "not at noon");
  assert.equal(await runScheduledSync(env, midnight + 86400 + 15 * 60), true, "a late tick the next night still runs");
  assert.equal(sent.length, 2);

  // Midnight is in the saved time zone.
  db.sqlite.exec(`INSERT INTO settings (name, value) VALUES ('link_scan', '{"interval_days":7,"time_zone":"America/Chicago"}')`);
  assert.equal(await runScheduledSync(env, midnight + 2 * 86400), false, "UTC midnight is evening in Chicago");
  assert.equal(await runScheduledSync(env, midnight + 2 * 86400 + 6 * 3600), true, "Chicago midnight");
});

test("opening the dashboard syncs every site, once in a few minutes", async () => {
  const { env, sent } = await setup();
  const start = 1_800_000_000;
  assert.equal(await syncAllOnOpen(env, start), true);
  assert.equal(sent.length, 1);
  assert.equal(await syncAllOnOpen(env, start + 60), false, "another tab right after does not");
  assert.equal(await syncAllOnOpen(env, start + 11 * 60), true);
  assert.equal(sent.length, 2);
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
