import assert from "node:assert/strict";
import test from "node:test";
import { randomToken } from "../src/shared/protocol.ts";
import { PRESSER_CONNECT_VERSION } from "../src/shared/plugin-version.ts";
import { applyMigrations } from "../src/worker/db/migrate.ts";
import { syncSite } from "../src/worker/sites/sync.ts";
import { encryptSecret } from "../src/worker/sites/secrets.ts";
import { getSite, listUpdates } from "../src/worker/sites/store.ts";
import { enqueueUpdate, runNextUpdate } from "../src/worker/sites/updates.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

const SITE = "https://example.com";

/** A database with one site, and a stubbed Presser Connect behind fetch. */
async function setup(handleApply, plugin_version = PRESSER_CONNECT_VERSION) {
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
    if (route === "/presser/v1/updates/apply" || route === "/presser/v1/self-update") {
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
    if (route === "/presser/v1/status") {
      return json({ name: "Example", wp_version: "6.8", php_version: "8.3", plugin_version, theme: "T" });
    }
    if (route === "/presser/v1/updates") return json({ core: null, plugins: [], themes: [] });
    if (route === "/presser/v1/comments") return json({ pending_count: 0, comments: [] });
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
    body.slug === "a/a.php" ? json({ code: "presser_update_failed", message: "Download failed." }, 500) : json({ ok: true }),
  );
  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "a/a.php" });
  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "b/b.php" });
  assert.deepEqual(await runNextUpdate(t.env, 1), { next: "continue" });
  assert.deepEqual(await runNextUpdate(t.env, 1), { next: "idle" });
  assert.deepEqual(t.jobs(), [{ slug: "a/a.php", status: "failed", error: "Download failed." }]);
});

test("an older Presser Connect is updated automatically and never listed", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }), "0.3.0");
  await syncSite(t.env, 1);
  assert.equal(t.env.DB.sqlite.prepare("SELECT count(*) AS n FROM site_updates").get().n, 0);
  assert.deepEqual(t.jobs(), [{ slug: "presser-connect", status: "queued", error: null }]);
  assert.deepEqual(t.sent.at(-1).body, { type: "update", siteId: 1 });

  await syncSite(t.env, 1);
  assert.equal(t.jobs().length, 1, "a second sync does not queue it twice");

  await runNextUpdate(t.env, 1);
  assert.deepEqual(t.applied[0], { version: PRESSER_CONNECT_VERSION, package: "UEsDBA==" });
});

test("a current Presser Connect is left alone", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }));
  await syncSite(t.env, 1);
  assert.deepEqual(t.jobs(), []);
});

test("a failed self-update is not retried by the sync that follows it", async () => {
  const t = await setup(async (_body, json) => json({ code: "presser_update_failed", message: "Disk full." }, 500), "0.3.9");
  await syncSite(t.env, 1);
  const sentBefore = t.sent.length;
  // Fails, then syncs; that sync must not queue it again.
  assert.deepEqual(await runNextUpdate(t.env, 1), { next: "idle" });
  assert.deepEqual(t.jobs(), [{ slug: "presser-connect", status: "failed", error: "Disk full." }]);
  assert.equal(t.sent.length, sentBefore);
});

test("a Presser Connect too old to update itself says how to fix it", async () => {
  const t = await setup(async (_body, json) => json({ code: "rest_no_route", message: "No route" }, 404), "0.3.0");
  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "presser-connect" });
  await runNextUpdate(t.env, 1);
  assert.match(t.jobs()[0].error, /cannot update itself/);
});

test("a Presser Connect updated by hand since the last sync counts as done", async () => {
  const t = await setup(
    async (_body, json) => json({ code: "presser_up_to_date", message: "Presser Connect is already up to date." }, 409),
    "0.3.0",
  );
  await syncSite(t.env, 1);
  await enqueueUpdate(t.env, 1, { kind: "plugin", slug: "presser-connect" });
  assert.deepEqual(await runNextUpdate(t.env, 1), { next: "idle" });
  assert.deepEqual(t.jobs(), [{ slug: "presser-connect", status: "done", error: null }], "not queued again right away");
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

test("a newer Presser Connect is queued at once, even right after the last self-update", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }), "0.0.1");
  // The previous release's self-update finished an hour ago. Jobs from before
  // versions were recorded have none.
  t.env.DB.sqlite
    .prepare("INSERT INTO update_jobs (site_id, kind, slug, status, started_at) VALUES (1, 'plugin', 'presser-connect', 'done', unixepoch() - 3600)")
    .run();
  await syncSite(t.env, 1);
  assert.deepEqual(t.jobs(), [{ slug: "presser-connect", status: "queued", error: null }]);
  assert.deepEqual(t.sent.at(-1).body, { type: "update", siteId: 1 });
});

test("Sync now retries a failed self-update; a scheduled sync waits", async () => {
  const t = await setup(async (_body, json) => json({ code: "presser_update_failed", message: "Disk full." }, 500), "0.0.1");
  await syncSite(t.env, 1);
  await runNextUpdate(t.env, 1);
  assert.equal(t.jobs()[0].status, "failed");

  await syncSite(t.env, 1);
  assert.equal(t.jobs()[0].status, "failed", "a scheduled sync leaves it");

  const site = await getSite(t.env.DB, 1);
  assert.equal(site.self_update_status, "failed");
  assert.equal(site.self_update_error, "Disk full.");
  assert.equal(site.self_update_version, PRESSER_CONNECT_VERSION);

  await syncSite(t.env, 1, { retrySelfUpdate: true });
  assert.deepEqual(t.jobs(), [{ slug: "presser-connect", status: "queued", error: null }]);
});

test("an update to the version already installed is not listed", async () => {
  const t = await setup(async (_body, json) => json({ ok: true }));
  const fetchSite = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (new URL(url).searchParams.get("rest_route") === "/presser/v1/updates") {
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
