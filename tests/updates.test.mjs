import assert from "node:assert/strict";
import test from "node:test";
import { randomToken } from "../src/shared/protocol.ts";
import { compareVersions, KONTROLWP_CONNECT_VERSION } from "../src/shared/plugin-version.ts";
import { applyMigrations } from "../src/worker/db/migrate.ts";
import { syncSite } from "../src/worker/sites/sync.ts";
import { encryptSecret } from "../src/worker/sites/secrets.ts";
import { getSite, listFleetPlugins, listFleetUsers, listRollbacks, listUpdates } from "../src/worker/sites/store.ts";
import { enqueueRollback, enqueueUpdate, RollbackError, runNextUpdate, runResync } from "../src/worker/sites/updates.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

const SITE = "https://example.com";

/** A database with one site, and a stubbed KontrolWP Connect behind fetch. */
async function setup(handleApply, plugin_version = KONTROLWP_CONNECT_VERSION) {
  const db = fakeD1();
  await applyMigrations(db, migrations);
  const key = randomToken(32);
  db.sqlite.prepare("INSERT INTO sites (id, name, url, key_id, secret) VALUES (1, 'Example', ?, 'key-id-1', '')").run(SITE);
  db.sqlite.prepare("UPDATE sites SET secret = ? WHERE id = 1").run(await encryptSecret(key, 1, randomToken(32)));
  const sent = [];
  const env = {
    DB: db,
    SITE_SECRETS_KEY: key,
    SYNC_QUEUE: { send: async (body, options) => sent.push({ body, options }) },
    ASSETS: { fetch: async () => new Response(new Uint8Array([0x50, 0x4b, 3, 4])) },
  };

  const applied = [];
  let inFlight = 0;
  let maxInFlight = 0;
  globalThis.fetch = async (url, init) => {
    const route = new URL(url).searchParams.get("rest_route");
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (route === "/kontrolwp/v1/updates/apply" || route === "/kontrolwp/v1/self-update") {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        const body = JSON.parse(init.body);
        applied.push(body.slug ?? { version: body.version, package: body.package });
        return await handleApply(body, json);
      } finally {
        inFlight--;
      }
    }
    if (route === "/kontrolwp/v1/status") {
      return json({
        name: "Example", wp_version: "6.8", php_version: "8.3", plugin_version, theme: "T",
        ...(compareVersions(plugin_version, "0.7.0") >= 0 ? { core_auto_update: { mode: "all", locked: false } } : {}),
      });
    }
    if (route === "/kontrolwp/v1/updates") return json({ core: null, plugins: [], themes: [] });
    if (route === "/kontrolwp/v1/comments") return json({ pending_count: 0, comments: [] });
    if (route === "/kontrolwp/v1/plugins") {
      return json({
        plugins: [
          { file: "akismet/akismet.php", name: "Akismet", version: "5.3", author: "Automattic", active: true, network_active: false, protected: false, auto_update: true, icon_url: "https://ps.w.org/akismet/assets/icon.svg" },
          { file: "kontrolwp-connect/kontrolwp-connect.php", name: "KontrolWP Connect", version: plugin_version, author: "KontrolWP", active: true, network_active: false, protected: true },
        ],
        can_modify_files: true,
        auto_updates: true,
      });
    }
    if (route === "/kontrolwp/v1/users") {
      return json({
        users: [
          { id: 2, login: "owner", email: "Owner@Example.com", display_name: "Owner", roles: ["administrator"], registered: 1700000000 },
          { id: 9, login: "writer", email: "writer@example.com", display_name: "Writer", roles: ["author"], registered: 1700000500 },
        ],
        roles: [{ slug: "administrator", name: "Administrator" }, { slug: "author", name: "Author" }],
        total: 2,
      });
    }
    if (route === "/kontrolwp/v1/admins") {
      return json({ admins: [{ id: 7, login: "editor-in-chief", display_name: "Chief" }, { id: 2, login: "owner", display_name: "Owner" }] });
    }
    throw new Error(`unexpected ${route}`);
  };
  const jobs = () => db.sqlite.prepare("SELECT slug, status, error FROM update_jobs ORDER BY id").all().map((r) => ({ ...r }));
  return { env, sent, applied, jobs, maxInFlight: () => maxInFlight };
}

test("queued updates run one at a time, then the site syncs once", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }));
  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "a/a.php" });
  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "b/b.php" });
  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "a/a.php" });
  assert.equal(t.jobs().length, 2, "queuing the same update twice keeps one job");

  assert.deepEqual(await runNextUpdate(t.env, 1), { next: "continue" });
  assert.deepEqual(t.applied, ["a/a.php"]);
  assert.deepEqual(await runNextUpdate(t.env, 1), { next: "idle" });
  assert.deepEqual(t.applied, ["a/a.php", "b/b.php"]);
  assert.deepEqual(t.jobs(), [], "the final sync clears finished jobs");
  assert.deepEqual(await runNextUpdate(t.env, 1), { next: "idle" });
});

test("two consumers never update one site at the same time", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const t = await setup(async (_body, json) => {
    await gate;
    return json({ ok: true });
  });
  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "a/a.php" });
  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "b/b.php" });
  const first = runNextUpdate(t.env, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(await runNextUpdate(t.env, 1), { next: "idle" }, "the second consumer finds a running update");
  release();
  assert.deepEqual(await first, { next: "continue" }, "the first one hands on the rest");
  assert.equal(t.maxInFlight(), 1);
});

test("a site in maintenance mode is retried, then reported", async () => {
  const t = await setup(async (_body, json) => json({ code: "maintenance" }, 503));
  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "a/a.php" });
  for (let attempt = 1; attempt < 5; attempt++) {
    assert.deepEqual(await runNextUpdate(t.env, 1), { next: "retry", delaySeconds: 30 });
    assert.equal(t.jobs()[0].status, "queued");
  }
  assert.deepEqual(await runNextUpdate(t.env, 1), { next: "idle" });
  assert.deepEqual(t.jobs(), [{ slug: "a/a.php", status: "failed", error: "The site returned HTTP 503" }]);

  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "a/a.php" });
  assert.equal(t.jobs()[0].status, "queued", "Try again queues a failed update again");
});

test("a failed update does not stop the next one", async () => {
  const t = await setup(async (body, json) =>
    body.slug === "a/a.php" ? json({ code: "kontrolwp_update_failed", message: "Download failed." }, 500) : json({ ok: true }),
  );
  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "a/a.php" });
  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "b/b.php" });
  assert.deepEqual(await runNextUpdate(t.env, 1), { next: "continue" });
  assert.deepEqual(await runNextUpdate(t.env, 1), { next: "idle" });
  assert.deepEqual(t.jobs(), [{ slug: "a/a.php", status: "failed", error: "Download failed." }]);
});

test("an older KontrolWP Connect is updated automatically and never listed", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }), "0.3.0");
  await syncSite(t.env, 1);
  assert.equal(t.env.DB.sqlite.prepare("SELECT count(*) AS n FROM site_updates").get().n, 0);
  assert.deepEqual(t.jobs(), [{ slug: "kontrolwp-connect", status: "queued", error: null }]);
  assert.deepEqual(t.sent.at(-1).body, { type: "update", siteId: 1 });

  await syncSite(t.env, 1);
  assert.equal(t.jobs().length, 1, "a second sync does not queue it twice");

  await runNextUpdate(t.env, 1);
  assert.deepEqual(t.applied[0], { version: KONTROLWP_CONNECT_VERSION, package: "UEsDBA==" });
});

test("a current KontrolWP Connect is left alone", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }));
  await syncSite(t.env, 1);
  assert.deepEqual(t.jobs(), []);
});

test("a failed self-update is not retried by the sync that follows it", async () => {
  const t = await setup(async (_body, json) => json({ code: "kontrolwp_update_failed", message: "Disk full." }, 500), "0.3.9");
  await syncSite(t.env, 1);
  const sentBefore = t.sent.length;
  // Fails, then syncs; that sync must not queue it again.
  assert.deepEqual(await runNextUpdate(t.env, 1), { next: "idle" });
  assert.deepEqual(t.jobs(), [{ slug: "kontrolwp-connect", status: "failed", error: "Disk full." }]);
  assert.equal(t.sent.length, sentBefore);
});

test("a KontrolWP Connect too old to update itself says how to fix it", async () => {
  const t = await setup(async (_body, json) => json({ code: "rest_no_route", message: "No route" }, 404), "0.3.0");
  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "kontrolwp-connect" });
  await runNextUpdate(t.env, 1);
  assert.match(t.jobs()[0].error, /cannot update itself/);
});

test("a KontrolWP Connect updated by hand since the last sync counts as done", async () => {
  const t = await setup(
    async (_body, json) => json({ code: "kontrolwp_up_to_date", message: "KontrolWP Connect is already up to date." }, 409),
    "0.3.0",
  );
  await syncSite(t.env, 1);
  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "kontrolwp-connect" });
  assert.deepEqual(await runNextUpdate(t.env, 1), { next: "idle" });
  assert.deepEqual(t.jobs(), [{ slug: "kontrolwp-connect", status: "done", error: null }], "not queued again right away");
});

test("updates count as active until the sync after them clears the row", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }));
  const db = t.env.DB;
  const insert = db.sqlite.prepare(
    "INSERT INTO site_updates (site_id, kind, slug, name, current_version, new_version) VALUES (1, 'plugin', ?, ?, '1.0', '2.0')",
  );
  for (const slug of ["idle", "queued", "running", "done-now", "done-old", "failed"]) insert.run(slug, slug);
  const job = db.sqlite.prepare(
    "INSERT INTO update_jobs (site_id, kind, slug, status, started_at) VALUES (1, 'plugin', ?, ?, unixepoch() - ?)",
  );
  job.run("queued", "queued", 0);
  job.run("running", "running", 10);
  job.run("done-now", "done", 30);
  job.run("done-old", "done", 3600);
  job.run("failed", "failed", 30);

  const active = Object.fromEntries((await listUpdates(db)).map((u) => [u.slug, u.job_active]));
  assert.deepEqual(active, {
    idle: false,
    queued: true,
    running: true,
    "done-now": true,
    "done-old": false,
    failed: false,
  });
  assert.equal((await listUpdates(db, 1)).length, 6);
});

test("a newer KontrolWP Connect is queued at once, even right after the last self-update", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }), "0.0.1");
  // The previous release's self-update finished an hour ago. Jobs from before
  // versions were recorded have none.
  t.env.DB.sqlite
    .prepare("INSERT INTO update_jobs (site_id, kind, slug, status, started_at) VALUES (1, 'plugin', 'kontrolwp-connect', 'done', unixepoch() - 3600)")
    .run();
  await syncSite(t.env, 1);
  assert.deepEqual(t.jobs(), [{ slug: "kontrolwp-connect", status: "queued", error: null }]);
  assert.deepEqual(t.sent.at(-1).body, { type: "update", siteId: 1 });
});

test("Sync now retries a failed self-update; a scheduled sync waits", async () => {
  const t = await setup(async (_body, json) => json({ code: "kontrolwp_update_failed", message: "Disk full." }, 500), "0.0.1");
  await syncSite(t.env, 1);
  await runNextUpdate(t.env, 1);
  assert.equal(t.jobs()[0].status, "failed");

  await syncSite(t.env, 1);
  assert.equal(t.jobs()[0].status, "failed", "a scheduled sync leaves it");

  const site = await getSite(t.env.DB, 1);
  assert.equal(site.self_update_status, "failed");
  assert.equal(site.self_update_error, "Disk full.");
  assert.equal(site.self_update_version, KONTROLWP_CONNECT_VERSION);

  await syncSite(t.env, 1, { retrySelfUpdate: true });
  assert.deepEqual(t.jobs(), [{ slug: "kontrolwp-connect", status: "queued", error: null }]);
});

test("an update to the version already installed is not listed", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }));
  const fetchSite = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (new URL(url).searchParams.get("rest_route") === "/kontrolwp/v1/updates") {
      return new Response(
        JSON.stringify({
          core: { current: "7.1.2", new_version: "7.1.2" },
          plugins: [
            { slug: "a/a.php", name: "A", current_version: "1.0", new_version: "1.0" },
            { slug: "b/b.php", name: "B", current_version: "1.0", new_version: "1.1" },
          ],
          themes: [],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    return fetchSite(url, init);
  };
  await syncSite(t.env, 1);
  const rows = t.env.DB.sqlite.prepare("SELECT slug FROM site_updates").all().map((r) => r.slug);
  assert.deepEqual(rows, ["b/b.php"]);
});

test("Magic Login defaults to the site's first administrator, and keeps the owner's choice", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }));
  const user = () => ({ ...t.env.DB.sqlite.prepare("SELECT login_user_id, login_user_name FROM sites WHERE id = 1").get() });
  await syncSite(t.env, 1);
  assert.deepEqual(user(), { login_user_id: 2, login_user_name: "Owner" });

  t.env.DB.sqlite.prepare("UPDATE sites SET login_user_id = 7, login_user_name = 'Chief' WHERE id = 1").run();
  await syncSite(t.env, 1);
  assert.deepEqual(user(), { login_user_id: 7, login_user_name: "Chief" });
});

test("a KontrolWP Connect without Magic Login is not asked for administrators", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }), "0.4.1");
  await syncSite(t.env, 1);
  assert.equal(t.env.DB.sqlite.prepare("SELECT login_user_id FROM sites WHERE id = 1").get().login_user_id, null);
});

test("a site excluded from update checks is not asked for updates but still updates KontrolWP Connect", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }), "0.0.1");
  const asked = [];
  const fetchSite = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    asked.push(new URL(url).searchParams.get("rest_route"));
    return fetchSite(url, init);
  };
  t.env.DB.sqlite.prepare("UPDATE sites SET updates_excluded = 1 WHERE id = 1").run();
  t.env.DB.sqlite
    .prepare("INSERT INTO site_updates (site_id, kind, slug, name, current_version, new_version) VALUES (1, 'plugin', 'a/a.php', 'A', '1', '2')")
    .run();
  await syncSite(t.env, 1);
  assert.ok(!asked.includes("/kontrolwp/v1/updates"));
  assert.deepEqual(
    t.jobs().map((job) => job.slug),
    ["kontrolwp-connect"],
    "only KontrolWP Connect's own update",
  );
  assert.equal(t.env.DB.sqlite.prepare("SELECT count(*) AS n FROM site_updates").get().n, 0);
  assert.equal((await getSite(t.env.DB, 1)).updates_excluded, true);
});

test("sync keeps each site's plugins for the Plugins page, with their updates", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }));
  const fetchSite = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (new URL(url).searchParams.get("rest_route") === "/kontrolwp/v1/updates") {
      return new Response(
        JSON.stringify({ core: null, plugins: [{ slug: "akismet/akismet.php", name: "Akismet", current_version: "5.3", new_version: "5.4" }], themes: [] }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    return fetchSite(url, init);
  };
  await syncSite(t.env, 1);
  const fleet = await listFleetPlugins(t.env.DB);
  assert.deepEqual(
    fleet.plugins.map((p) => [p.file, p.active, p.protected, p.auto_update, p.new_version, p.icon_url, p.site_name]),
    [
      ["akismet/akismet.php", true, false, true, "5.4", "https://ps.w.org/akismet/assets/icon.svg", "Example"],
      ["kontrolwp-connect/kontrolwp-connect.php", true, true, false, null, null, "Example"],
    ],
  );
  assert.deepEqual(fleet.unsupported_sites, []);
});

test("a site whose KontrolWP Connect cannot list plugins is reported, not listed", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }), "0.5.1");
  await syncSite(t.env, 1);
  const fleet = await listFleetPlugins(t.env.DB);
  assert.deepEqual(fleet.plugins, []);
  assert.deepEqual(fleet.unsupported_sites.map((s) => ({ ...s })), [{ id: 1, name: "Example", plugin_version: "0.5.1" }]);
});

test("sync keeps WordPress's auto-update settings, and an older KontrolWP Connect leaves them unknown", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }));
  await syncSite(t.env, 1);
  const site = await getSite(t.env.DB, 1);
  assert.equal(site.core_auto_update, "all");
  assert.equal(site.core_auto_update_locked, false);
  assert.equal(site.plugin_auto_updates, true);

  const old = await setup(async (_body, json) => json({ ok: true }), "0.6.1");
  await syncSite(old.env, 1);
  assert.equal((await getSite(old.env.DB, 1)).core_auto_update, null);
});

test("sync keeps each site's users and roles for the Users page", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }));
  await syncSite(t.env, 1);
  const fleet = await listFleetUsers(t.env.DB);
  assert.deepEqual(
    fleet.users.map((user) => [user.user_id, user.login, user.roles, user.magic_login]),
    [
      [2, "owner", ["administrator"], true],
      [9, "writer", ["author"], false],
    ],
  );
  assert.deepEqual(fleet.roles.map((role) => role.slug), ["administrator", "author"]);
  assert.deepEqual(fleet.unsupported_sites, []);
});

test("a site whose KontrolWP Connect cannot manage users is reported, not asked", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }), "0.7.2");
  await syncSite(t.env, 1);
  const fleet = await listFleetUsers(t.env.DB);
  assert.deepEqual(fleet.users, []);
  assert.deepEqual(fleet.unsupported_sites.map((site) => site.id), [1]);
});

test("a sync that fails right after an update is tried again until it works", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }));
  const real = globalThis.fetch;
  let down = true;
  globalThis.fetch = async (url, init) =>
    down && new URL(url).searchParams.get("rest_route") === "/kontrolwp/v1/status"
      ? new Response(JSON.stringify({ code: "rest_no_route" }), { status: 404, headers: { "Content-Type": "application/json" } })
      : real(url, init);
  t.env.DB.sqlite
    .prepare("INSERT INTO site_updates (site_id, kind, slug, name, current_version, new_version) VALUES (1, 'plugin', 'a/a.php', 'A', '1', '2')")
    .run();
  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "a/a.php" });

  assert.deepEqual(await runNextUpdate(t.env, 1), { next: "resync", delaySeconds: 45 });
  assert.equal(t.env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM site_updates").get().n, 1, "the old list stays until a sync works");
  assert.equal(await runResync(t.env, 1, 1), 45, "still down: asked to try again, a little later");
  assert.equal(await runResync(t.env, 1, 4), 180);
  assert.equal(await runResync(t.env, 1, 5), null, "the tries are used up");

  down = false;
  assert.equal(await runResync(t.env, 1, 2), null);
  assert.equal(t.env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM site_updates").get().n, 0, "the finished update leaves the list");
  assert.deepEqual(t.jobs(), []);
});

/**
 * A site that kept Akismet 5.2 when it updated it to 5.3. Reverting puts 5.2
 * back, after which the site offers 5.3 again and keeps no copy.
 */
async function setupRollback() {
  const t = await setup(async (_body, json) => json({ ok: true }));
  const site = { reverted: false, latest: "5.3", rollbacks: [] };
  const base = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const route = new URL(url).searchParams.get("rest_route");
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (route === "/kontrolwp/v1/updates/rollback") {
      site.rollbacks.push(JSON.parse(init.body));
      site.reverted = true;
      return json({ ok: true, version: "5.2" });
    }
    if (route === "/kontrolwp/v1/updates") {
      const installed = site.reverted ? "5.2" : "5.3";
      return json({
        core: null,
        plugins:
          installed === site.latest
            ? []
            : [{ slug: "akismet/akismet.php", name: "Akismet", current_version: installed, new_version: site.latest }],
        themes: [],
        rollbacks: site.reverted
          ? []
          : [{ kind: "plugin", slug: "akismet/akismet.php", name: "Akismet", version: "5.2", current_version: "5.3", created_at: 1700000000 }],
      });
    }
    return base(url, init);
  };
  return { ...t, site };
}

const holds = (db) => db.sqlite.prepare("SELECT kind, slug, version FROM update_holds").all().map((r) => ({ ...r }));

test("a revert runs in the Update Queue, then the reverted version is marked for scheduled updates to skip", async () => {
  const t = await setupRollback();
  const db = t.env.DB;
  await syncSite(t.env, 1);
  const [kept] = await listRollbacks(db, 1);
  assert.deepEqual(
    { ...kept },
    {
      site_id: 1, kind: "plugin", slug: "akismet/akismet.php", name: "Akismet", version: "5.2", current_version: "5.3",
      created_at: 1700000000, job_status: null, job_error: null,
    },
  );

  await enqueueRollback(t.env, 1, { kind: "plugin", slug: "akismet/akismet.php" });
  await enqueueRollback(t.env, 1, { kind: "plugin", slug: "akismet/akismet.php" });
  assert.equal(t.jobs().length, 1, "a second click keeps one job");
  assert.equal((await listRollbacks(db, 1))[0].job_status, "queued");
  assert.deepEqual(t.sent.at(-1).body, { type: "update", siteId: 1 });

  assert.deepEqual(await runNextUpdate(t.env, 1), { next: "idle" });
  assert.deepEqual(t.site.rollbacks, [{ kind: "plugin", slug: "akismet/akismet.php" }]);
  assert.deepEqual(t.applied, [], "a revert is not an update");
  // The sync after it: no copy left, 5.3 offered again and held back from schedules.
  assert.deepEqual(await listRollbacks(db, 1), []);
  assert.deepEqual(t.jobs(), []);
  assert.deepEqual(holds(db), [{ kind: "plugin", slug: "akismet/akismet.php", version: "5.3" }]);
  const [update] = await listUpdates(db, 1);
  assert.equal(update.new_version, "5.3");
  assert.equal(update.held, true);
  assert.equal(update.job_status, null);

  // A newer release is not the version the owner reverted, so the hold goes.
  t.site.latest = "5.4";
  await syncSite(t.env, 1);
  assert.deepEqual(holds(db), []);
  assert.equal((await listUpdates(db, 1))[0].held, false);
});

test("a revert needs a kept copy and waits for no update of the same plugin", async () => {
  const t = await setupRollback();
  await assert.rejects(enqueueRollback(t.env, 1, { kind: "plugin", slug: "akismet/akismet.php" }), RollbackError);
  await syncSite(t.env, 1);
  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "akismet/akismet.php" });
  await assert.rejects(
    enqueueRollback(t.env, 1, { kind: "plugin", slug: "akismet/akismet.php" }),
    /An update of this is in the queue/,
  );
  assert.equal((await listRollbacks(t.env.DB, 1))[0].job_status, null, "the update's job is not the revert's");
});

test("a failed revert is reported on its row and can be tried again", async () => {
  const t = await setupRollback();
  await syncSite(t.env, 1);
  const base = globalThis.fetch;
  globalThis.fetch = async (url, init) =>
    new URL(url).searchParams.get("rest_route") === "/kontrolwp/v1/updates/rollback"
      ? new Response(JSON.stringify({ code: "kontrolwp_no_rollback", message: "The previous version is no longer on the site." }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      : base(url, init);
  await enqueueRollback(t.env, 1, { kind: "plugin", slug: "akismet/akismet.php" });
  await runNextUpdate(t.env, 1);
  const [row] = await listRollbacks(t.env.DB, 1);
  assert.equal(row.job_status, "failed");
  assert.equal(row.job_error, "The previous version is no longer on the site.");
  assert.deepEqual(holds(t.env.DB), []);
  globalThis.fetch = base;
  await enqueueRollback(t.env, 1, { kind: "plugin", slug: "akismet/akismet.php" });
  assert.equal((await listRollbacks(t.env.DB, 1))[0].job_status, "queued");
});
