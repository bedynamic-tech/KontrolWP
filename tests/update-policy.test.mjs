import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanSchedule,
  DEFAULT_SCHEDULE,
  effectiveSchedule,
  globalPolicyView,
  isDue,
  nextRunAt,
  runScheduledUpdates,
  saveGlobalPolicy,
  saveSitePolicy,
  sitePolicyFrom,
  sitePolicyView,
} from "../src/worker/sites/update-policy.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

// 2026-10-04 is a Sunday.
const at = (iso) => Math.floor(Date.parse(iso) / 1000);
const weekly = { ...DEFAULT_SCHEDULE, frequency: "weekly", weekday: 0, hour: 3 };

test("a schedule is due from its hour on a day it runs, once per day", () => {
  const sunday3 = at("2026-10-04T03:10:00Z");
  assert.equal(isDue(weekly, "UTC", sunday3, null), true);
  assert.equal(isDue(weekly, "UTC", at("2026-10-04T02:50:00Z"), null), false);
  assert.equal(isDue(weekly, "UTC", at("2026-10-04T22:00:00Z"), null), true);
  assert.equal(isDue(weekly, "UTC", sunday3, "2026-10-04"), false);
  assert.equal(isDue(weekly, "UTC", at("2026-10-05T03:10:00Z"), "2026-10-04"), false);
  assert.equal(isDue({ ...weekly, frequency: "daily" }, "UTC", at("2026-10-05T04:00:00Z"), "2026-10-04"), true);
  assert.equal(isDue({ ...weekly, frequency: "monthly", day: 5 }, "UTC", at("2026-10-05T04:00:00Z"), null), true);
  assert.equal(isDue({ ...weekly, frequency: "monthly", day: 5 }, "UTC", at("2026-10-06T04:00:00Z"), null), false);
});

test("the time zone decides the day and hour", () => {
  // 02:30 UTC Sunday is still Saturday evening in Chicago.
  assert.equal(isDue(weekly, "America/Chicago", at("2026-10-04T08:30:00Z"), null), true);
  assert.equal(isDue(weekly, "America/Chicago", at("2026-10-04T02:30:00Z"), null), false);
});

test("the next run is now when due, otherwise the next scheduled hour", () => {
  const now = at("2026-10-01T12:00:00Z");
  assert.equal(nextRunAt(weekly, "UTC", now, null), at("2026-10-04T03:00:00Z"));
  assert.equal(nextRunAt(weekly, "UTC", at("2026-10-04T05:00:00Z"), null), at("2026-10-04T05:00:00Z"));
  assert.equal(nextRunAt(weekly, "UTC", at("2026-10-04T05:00:00Z"), "2026-10-04"), at("2026-10-11T03:00:00Z"));
  assert.equal(nextRunAt({ ...weekly, frequency: "monthly", day: 15 }, "UTC", now, null), at("2026-10-15T03:00:00Z"));
});

test("bad values fall back to the defaults", () => {
  const cleaned = cleanSchedule({ core: "yes", frequency: "hourly", weekday: 9, day: 31, hour: -1 });
  assert.deepEqual(cleaned, DEFAULT_SCHEDULE);
  assert.equal(sitePolicyFrom("not json").mode, "inherit");
});

test("a site follows the global policy, its own, or none", () => {
  const global = { ...weekly, enabled: true, excluded_plugins: [] };
  const site = (mode) => ({ mode, schedule: { ...weekly, hour: 9 }, excluded_plugins: [] });
  assert.equal(effectiveSchedule(global, site("inherit")).source, "global");
  assert.equal(effectiveSchedule(global, site("custom")).schedule.hour, 9);
  assert.equal(effectiveSchedule(global, site("off")).schedule, null);
  assert.equal(effectiveSchedule({ ...global, enabled: false }, site("inherit")).schedule, null);
  assert.equal(effectiveSchedule({ ...global, enabled: false }, site("custom")).source, "custom");
});

function setup() {
  const db = fakeD1();
  for (const m of migrations) db.sqlite.exec(m.sql);
  const sent = [];
  const env = { DB: db, SYNC_QUEUE: { send: async (message, options) => sent.push({ message, options }) } };
  const site = (id, extra = "") =>
    db.sqlite.exec(
      `INSERT INTO sites (id, name, url, key_id, secret, plugin_version, status) VALUES (${id}, 'Site ${id}', 'https://s${id}.test', 'k', 'x', '0.14.0', 'connected')${extra}`,
    );
  const update = (siteId, kind, slug, name, version) =>
    db.sqlite.exec(
      `INSERT INTO site_updates (site_id, kind, slug, name, current_version, new_version) VALUES (${siteId}, '${kind}', '${slug}', '${name}', '1', '${version}')`,
    );
  const jobs = (siteId) =>
    db.sqlite
      .prepare("SELECT kind, slug, version, status FROM update_jobs WHERE site_id = ? ORDER BY id")
      .all(siteId)
      .map((row) => ({ ...row }));
  return { env, db, sent, site, update, jobs };
}

const sunday = at("2026-10-04T03:30:00Z");

test("a due site gets its waiting updates queued, plugins first, then core, minus excluded plugins", async () => {
  const { env, sent, site, update, jobs } = setup();
  site(1);
  update(1, "core", "wordpress", "WordPress", "6.9");
  update(1, "plugin", "akismet/akismet.php", "Akismet", "5.4");
  update(1, "plugin", "woo/woo.php", "Woo", "9.0");
  update(1, "theme", "twenty", "Twenty", "2.0");
  await saveGlobalPolicy(env, { ...weekly, enabled: true, core: true, excluded_plugins: ["woo/woo.php"] });
  assert.equal(await runScheduledUpdates(env, sunday), 1);
  assert.deepEqual(jobs(1), [
    { kind: "plugin", slug: "akismet/akismet.php", version: null, status: "queued" },
    { kind: "theme", slug: "twenty", version: null, status: "queued" },
    { kind: "core", slug: "wordpress", version: "6.9", status: "queued" },
  ]);
  assert.equal(sent.length, 1);
  // The home page is looked at before the updates start.
  assert.deepEqual(sent[0].message, { type: "update-check", siteId: 1, runId: 1, phase: "before" });
  const view = await globalPolicyView(env, sunday);
  assert.equal(view.runs[0].queued, 3);
  assert.equal(view.runs[0].skipped, 1);
});

test("a site runs once a day, and not before the hour or on other days", async () => {
  const { env, site, update, jobs } = setup();
  site(1);
  update(1, "plugin", "a/a.php", "A", "2");
  await saveGlobalPolicy(env, { ...weekly, enabled: true });
  assert.equal(await runScheduledUpdates(env, at("2026-10-04T02:00:00Z")), 0);
  assert.equal(await runScheduledUpdates(env, at("2026-10-03T12:00:00Z")), 0);
  assert.equal(await runScheduledUpdates(env, sunday), 1);
  assert.equal(await runScheduledUpdates(env, sunday + 900), 0);
  assert.equal(jobs(1).length, 1);
});

test("a disabled global policy runs nothing, but a site's own schedule still does", async () => {
  const { env, site, update, jobs } = setup();
  site(1);
  site(2);
  update(1, "plugin", "a/a.php", "A", "2");
  update(2, "plugin", "a/a.php", "A", "2");
  await saveGlobalPolicy(env, { ...weekly, enabled: false });
  await saveSitePolicy(env, 2, { mode: "custom", schedule: { ...weekly, hour: 3 }, excluded_plugins: [] });
  assert.equal(await runScheduledUpdates(env, sunday), 1);
  assert.equal(jobs(1).length, 0);
  assert.equal(jobs(2).length, 1);
});

test("a site set to off, an excluded site and a site in error are left alone", async () => {
  const { env, db, site, update, jobs } = setup();
  site(1);
  site(2);
  site(3);
  for (const id of [1, 2, 3]) update(id, "plugin", "a/a.php", "A", "2");
  await saveSitePolicy(env, 1, { mode: "off", schedule: weekly, excluded_plugins: [] });
  db.sqlite.exec("UPDATE sites SET updates_excluded = 1 WHERE id = 2");
  db.sqlite.exec("UPDATE sites SET status = 'error' WHERE id = 3");
  await saveGlobalPolicy(env, { ...weekly, enabled: true });
  assert.equal(await runScheduledUpdates(env, sunday), 0);
  assert.deepEqual(
    [1, 2, 3].map((id) => jobs(id).length),
    [0, 0, 0],
  );
  // The site in error is not marked as run, so it runs once it recovers the same day.
  db.sqlite.exec("UPDATE sites SET status = 'connected' WHERE id = 3");
  assert.equal(await runScheduledUpdates(env, sunday + 3600), 1);
});

test("a site's own exclusions add to the global ones, and its own schedule picks what updates", async () => {
  const { env, site, update, jobs } = setup();
  site(1);
  update(1, "plugin", "a/a.php", "A", "2");
  update(1, "plugin", "b/b.php", "B", "2");
  update(1, "plugin", "c/c.php", "C", "2");
  update(1, "theme", "t", "T", "2");
  await saveGlobalPolicy(env, { ...weekly, enabled: true, excluded_plugins: ["a/a.php"] });
  await saveSitePolicy(env, 1, {
    mode: "custom",
    schedule: { ...weekly, plugins: true, themes: false, core: false },
    excluded_plugins: ["b/b.php"],
  });
  await runScheduledUpdates(env, sunday);
  assert.deepEqual(
    jobs(1).map((job) => job.slug),
    ["c/c.php"],
  );
});

test("sites start a couple of minutes apart", async () => {
  const { env, sent, site, update } = setup();
  for (const id of [1, 2, 3]) {
    site(id);
    update(id, "plugin", "a/a.php", "A", "2");
  }
  await saveGlobalPolicy(env, { ...weekly, enabled: true });
  assert.equal(await runScheduledUpdates(env, sunday), 3);
  assert.deepEqual(
    sent.map((s) => s.options.delaySeconds),
    [0, 120, 240],
  );
});

test("the site view says which schedule applies and keeps a plain site unstored", async () => {
  const { env, db, site } = setup();
  site(1);
  await saveGlobalPolicy(env, { ...weekly, enabled: true });
  let view = await sitePolicyView(env, 1, sunday - 86400 * 2);
  assert.equal(view.effective, "global");
  assert.equal(view.next_run_at, at("2026-10-04T03:00:00Z"));
  await saveSitePolicy(env, 1, { mode: "inherit", schedule: weekly, excluded_plugins: [] });
  assert.equal(db.sqlite.prepare("SELECT update_policy FROM sites WHERE id = 1").get().update_policy, null);
  await saveSitePolicy(env, 1, { mode: "off", schedule: weekly, excluded_plugins: [] });
  view = await sitePolicyView(env, 1, sunday);
  assert.equal(view.effective, "off");
  assert.equal(view.next_run_at, null);
});

test("scheduled updates skip a version the owner reverted, but not a newer one", async () => {
  const { env, db, site, update, jobs } = setup();
  site(1);
  update(1, "plugin", "akismet/akismet.php", "Akismet", "5.3");
  update(1, "plugin", "woo/woo.php", "Woo", "9.0");
  db.sqlite.exec(
    `INSERT INTO update_holds (site_id, kind, slug, version) VALUES (1, 'plugin', 'akismet/akismet.php', '5.3'), (1, 'plugin', 'woo/woo.php', '8.9')`,
  );
  await saveGlobalPolicy(env, { ...weekly, enabled: true });
  assert.equal(await runScheduledUpdates(env, sunday), 1);
  assert.deepEqual(jobs(1), [{ kind: "plugin", slug: "woo/woo.php", version: null, status: "queued" }]);
});
