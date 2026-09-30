import assert from "node:assert/strict";
import test from "node:test";
import { randomToken } from "../src/shared/protocol.ts";
import { applyMigrations } from "../src/worker/db/migrate.ts";
import { encryptSecret } from "../src/worker/sites/secrets.ts";
import { enqueueUpdate, runNextUpdate } from "../src/worker/sites/updates.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

const SITE = "https://example.com";

/** A database with one site, and a stubbed Presser Connect behind fetch. */
async function setup(handleApply) {
  const db = fakeD1();
  await applyMigrations(db, migrations);
  const key = randomToken(32);
  db.sqlite.prepare("INSERT INTO sites (id, name, url, key_id, secret) VALUES (1, 'Example', ?, 'key-id-1', '')").run(SITE);
  db.sqlite.prepare("UPDATE sites SET secret = ? WHERE id = 1").run(await encryptSecret(key, 1, randomToken(32)));
  const sent = [];
  const env = { DB: db, SITE_SECRETS_KEY: key, SYNC_QUEUE: { send: async (body, options) => sent.push({ body, options }) } };

  const applied = [];
  let inFlight = 0;
  let maxInFlight = 0;
  globalThis.fetch = async (url, init) => {
    const route = new URL(url).searchParams.get("rest_route");
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (route === "/presser/v1/updates/apply") {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        const body = JSON.parse(init.body);
        applied.push(body.slug);
        return await handleApply(body, json);
      } finally {
        inFlight--;
      }
    }
    if (route === "/presser/v1/status") {
      return json({ name: "Example", wp_version: "6.8", php_version: "8.3", plugin_version: "0.2.0", theme: "T" });
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
