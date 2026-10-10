import assert from "node:assert/strict";
import test from "node:test";
import { applyMigrations } from "../src/worker/db/migrate.ts";
import {
  afterUpdates,
  changedShare,
  checkAfterUpdates,
  checkBeforeUpdates,
  homeUrl,
  regression,
  UpdateCheckError,
} from "../src/worker/sites/update-check.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

/** A grid of one colour, with the first `painted` blocks in black. */
function grid(cols, rows, painted = 0) {
  const pixels = new Uint8Array(cols * rows * 4).fill(255);
  for (let i = 0; i < painted; i++) pixels.set([0, 0, 0, 255], i * 4);
  return { cols, rows, pixels };
}

const fine = { status: 200, critical: false, grid: grid(10, 10), error: null };

test("only real changes count, and a longer page counts its new part", () => {
  assert.equal(changedShare(grid(10, 10), grid(10, 10)), 0);
  const noisy = grid(10, 10);
  noisy.pixels[0] = 230;
  assert.equal(changedShare(grid(10, 10), noisy), 0);
  assert.equal(changedShare(grid(10, 10), grid(10, 10, 25)), 0.25);
  assert.equal(changedShare(grid(2, 2), grid(2, 3)), 2 / 6);
});

test("a regression is a page that broke, errored or looks very different", () => {
  const before = { status: 200, grid: grid(10, 10) };
  assert.equal(regression(before, fine), null);
  assert.equal(regression(before, { ...fine, grid: grid(10, 10, 20) }), null);
  assert.match(regression(before, { ...fine, grid: grid(10, 10, 40) }), /40% of the home page looked different/);
  assert.match(regression(before, { ...fine, status: 500 }), /HTTP 500/);
  assert.match(regression(before, { ...fine, status: 404 }), /HTTP 404/);
  assert.match(regression(before, { ...fine, critical: true }), /critical error/);
  assert.match(regression(before, { status: null, critical: false, grid: null, error: "did not load" }), /did not load/);
  assert.equal(homeUrl("https://a.test/blog", 5), "https://a.test/blog?kontrolwp_check=5");
});

async function setup() {
  const db = fakeD1();
  await applyMigrations(db, migrations);
  db.sqlite.exec(`
    INSERT INTO sites (id, name, url, secret, status) VALUES (1, 'A', 'https://a.test', 'x', 'connected');
    INSERT INTO update_runs (id, site_id, ran_at, queued, skipped, items) VALUES (7, 1, 100, 2, 0, '[]');
  `);
  const sent = [];
  return { env: { DB: db, SYNC_QUEUE: { send: async (body, options) => sent.push([body, options]) } }, sent };
}

const looker = (...looks) => ({
  urls: [],
  async look(_env, url) {
    this.urls.push(url);
    const next = looks.shift();
    if (next instanceof Error) throw next;
    return next;
  },
});

const run = (env) => env.DB.sqlite.prepare("SELECT check_result, check_note FROM update_runs WHERE id = 7").get();

test("a page that still looks the same passes, and updates start either way", async () => {
  const { env, sent } = await setup();
  const eyes = looker(fine, fine);
  await checkBeforeUpdates(env, 1, 7, eyes, 100);
  assert.deepEqual(sent, [[{ type: "update" , siteId: 1 }, undefined]]);
  assert.deepEqual(eyes.urls, ["https://a.test/?kontrolwp_check=100"]);

  await afterUpdates(env, 1);
  assert.deepEqual(sent[1], [{ type: "update-check", siteId: 1, runId: 7, phase: "after" }, { delaySeconds: 20 }]);
  await checkAfterUpdates(env, 1, eyes, 200);
  assert.deepEqual({ ...run(env) }, { check_result: "passed", check_note: "The home page looked the same after the updates." });
  // Done: nothing waits any more, so later queues (such as updates by hand) are not checked.
  await afterUpdates(env, 1);
  assert.equal(sent.length, 2);
});

test("a page that broke gets the run's plugin and theme updates reverted", async () => {
  const { env, sent } = await setup();
  await checkBeforeUpdates(env, 1, 7, looker(fine), 100);
  env.DB.sqlite.exec(`
    INSERT INTO update_jobs (site_id, kind, slug, status, started_at) VALUES
      (1, 'plugin', 'shop', 'done', 110), (1, 'theme', 'twenty', 'done', 120),
      (1, 'plugin', 'nocopy', 'done', 125), (1, 'core', 'wordpress', 'done', 130),
      (1, 'plugin', 'failed', 'failed', 140), (1, 'plugin', 'older', 'done', 50);
    INSERT INTO site_rollbacks (site_id, kind, slug, name, version, current_version, created_at) VALUES
      (1, 'plugin', 'shop', 'Shop', '1.0', '2.0', 110), (1, 'theme', 'twenty', 'Twenty', '1.0', '1.1', 120);
  `);
  await checkAfterUpdates(env, 1, looker({ ...fine, status: 500 }), 200);
  const result = run(env);
  assert.equal(result.check_result, "reverted");
  assert.equal(
    result.check_note,
    "The home page answered HTTP 500 after the updates, so KontrolWP reverted Shop, Twenty. No previous version of nocopy was kept to revert to.",
  );
  const jobs = env.DB.sqlite.prepare("SELECT slug FROM update_jobs WHERE action = 'rollback' AND status = 'queued' ORDER BY slug").all();
  assert.deepEqual(jobs.map((job) => job.slug), ["shop", "twenty"]);
  assert.ok(sent.some(([body]) => body.type === "update"));
});

test("a run with nothing to revert says so", async () => {
  const { env } = await setup();
  await checkBeforeUpdates(env, 1, 7, looker(fine), 100);
  await checkAfterUpdates(env, 1, looker({ ...fine, critical: true }), 200);
  assert.equal(run(env).check_result, "broken");
  assert.match(run(env).check_note, /critical error after the updates, and there was nothing KontrolWP could revert/);
});

test("no check when the page was already broken or no browser starts", async () => {
  const { env, sent } = await setup();
  await checkBeforeUpdates(env, 1, 7, looker({ ...fine, status: 503 }), 100);
  assert.equal(run(env).check_result, "skipped");
  assert.equal(sent.length, 1);
  await afterUpdates(env, 1);
  assert.equal(sent.length, 1);

  await checkBeforeUpdates(env, 1, 7, looker(new UpdateCheckError("Cloudflare Browser Rendering was busy or out of time for today.")), 100);
  assert.equal(run(env).check_note, "Not checked: Cloudflare Browser Rendering was busy or out of time for today.");
  assert.equal(sent.at(-1)[0].type, "update");
});
