import assert from "node:assert/strict";
import test from "node:test";
import { applyMigrations } from "../src/worker/db/migrate.ts";
import { linkScanSchedule, localTime, runScheduledLinkScans, saveLinkScanSettings } from "../src/worker/sites/link-schedule.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

const at = (iso) => Date.parse(iso) / 1000;

async function setup(settings) {
  const db = fakeD1();
  await applyMigrations(db, migrations);
  for (const [id, version] of [[1, "0.9.3"], [2, "0.8.0"], [3, "0.9.0"], [4, "0.9.3"]]) {
    db.sqlite.prepare("INSERT INTO sites (id, name, url, key_id, secret, plugin_version) VALUES (?, 'S', ?, 'k', 'x', ?)").run(id, `https://site${id}.example.com`, version);
  }
  const sent = [];
  const env = { DB: db, SYNC_QUEUE: { send: async (body, options) => sent.push({ body, options }) } };
  if (settings) await saveLinkScanSettings(env, settings);
  return { db, env, sent };
}

test("localTime reads the date and hour in the chosen zone", () => {
  assert.deepEqual(localTime(at("2026-10-02T05:05:00Z"), "America/Chicago"), { date: "2026-10-02", hour: 0 });
  assert.deepEqual(localTime(at("2026-10-02T04:55:00Z"), "America/Chicago"), { date: "2026-10-01", hour: 23 });
  assert.deepEqual(localTime(at("2026-10-02T00:10:00Z"), null), { date: "2026-10-02", hour: 0 });
});

test("scheduled checks start at local midnight, queued a couple of minutes apart, every N days", async () => {
  const { env, sent } = await setup({ interval_days: 3, time_zone: "America/Chicago" });
  assert.equal(await runScheduledLinkScans(env, at("2026-10-01T18:00:00Z")), false, "1 PM is not midnight");
  assert.equal(await runScheduledLinkScans(env, at("2026-10-02T05:05:00Z")), true, "00:05 in Chicago");
  // Sites on KontrolWP Connect 0.9.0 or later only, spaced through the queue.
  assert.deepEqual(
    sent.map(({ body, options }) => [body.type, body.siteId, options?.delaySeconds ?? 0]),
    [["links-collect", 1, 0], ["links-collect", 3, 120], ["links-collect", 4, 240]],
  );
  assert.equal(await runScheduledLinkScans(env, at("2026-10-02T05:20:00Z")), false, "once per night");
  assert.equal(await runScheduledLinkScans(env, at("2026-10-04T05:05:00Z")), false, "two days later is too soon");
  assert.equal(await runScheduledLinkScans(env, at("2026-10-05T05:05:00Z")), true, "three days later");
});

test("the next check is shown at local midnight, and Off stops them", async () => {
  const { env } = await setup({ interval_days: 7, time_zone: "America/Chicago" });
  const now = at("2026-10-01T16:00:00Z");
  assert.equal((await linkScanSchedule(env, now)).next_run_at, at("2026-10-02T05:00:00Z"));
  await runScheduledLinkScans(env, at("2026-10-02T05:05:00Z"));
  assert.equal((await linkScanSchedule(env, at("2026-10-02T06:00:00Z"))).next_run_at, at("2026-10-09T05:00:00Z"));

  await saveLinkScanSettings(env, { interval_days: 0, time_zone: "America/Chicago" });
  assert.equal((await linkScanSchedule(env, now)).next_run_at, null);
  assert.equal(await runScheduledLinkScans(env, at("2026-10-16T05:05:00Z")), false);
});

test("without a saved zone, midnight is UTC", async () => {
  const { env, sent } = await setup(null);
  assert.equal(await runScheduledLinkScans(env, at("2026-10-02T00:05:00Z")), true);
  assert.equal(sent.length, 3);
});
