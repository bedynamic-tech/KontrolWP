import assert from "node:assert/strict";
import test from "node:test";
import { randomToken } from "../src/shared/protocol.ts";
import { buildStatus, fetchBuildLog, listWorkers, saveCloudflareToken } from "../src/worker/cloudflare.ts";
import { applyMigrations } from "../src/worker/db/migrate.ts";
import { syncSite } from "../src/worker/sites/sync.ts";
import { getSite, listDeployments, getCredentials } from "../src/worker/sites/store.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

const cf = (result) =>
  new Response(JSON.stringify({ success: true, result }), { headers: { "Content-Type": "application/json" } });

/** A static site that deploys from the Worker "web" in account "acc", with Cloudflare answering from `routes`. */
async function setup({ siteStatus = 200, routes = {} } = {}) {
  const db = fakeD1();
  await applyMigrations(db, migrations);
  const key = randomToken(32);
  const env = { DB: db, SITE_SECRETS_KEY: key, SYNC_QUEUE: { send: async () => {} } };
  db.sqlite
    .prepare(
      "INSERT INTO sites (id, kind, name, url, secret, cf_account_id, cf_worker) VALUES (1, 'static', 'Docs', 'https://docs.example.com', '', 'acc', 'web')",
    )
    .run();
  await saveCloudflareToken(env, "cf-token");
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    if (u.hostname === "docs.example.com") {
      return new Response('<html><head><link rel="icon" href="/icon.svg"></head></html>', {
        status: siteStatus,
        headers: { "Content-Type": "text/html" },
      });
    }
    const route = routes[u.pathname.replace("/client/v4", "")];
    return route ? route(u) : new Response("{}", { status: 404 });
  };
  return { env, db, calls };
}

const WORKER_ROUTES = {
  "/accounts/acc/workers/scripts": () => cf([{ id: "web", tag: "tag-1" }]),
  "/accounts/acc/workers/scripts/web/deployments": () =>
    cf({
      deployments: [
        {
          id: "d1",
          source: "wrangler",
          author_email: "a@example.com",
          created_on: "2026-09-01T10:00:00Z",
          annotations: { "workers/message": "Fix nav" },
        },
        { id: "d2", source: "api", author_email: "b@example.com", created_on: "2026-09-02T10:00:00Z", annotations: {} },
      ],
    }),
  "/accounts/acc/builds/workers/tag-1/builds": () =>
    cf([
      {
        build_uuid: "b1",
        created_on: "2026-09-02T09:59:00Z",
        status: "stopped",
        build_outcome: "fail",
        build_trigger_metadata: {
          author: "Kyle",
          branch: "main",
          commit_hash: "abc1234def",
          commit_message: "Update docs\n\nlong body",
          build_trigger_source: "push",
        },
      },
    ]),
};

test("a static site is checked over HTTP and its deployments and builds are stored", async () => {
  const { env, db, calls } = await setup({ routes: WORKER_ROUTES });
  assert.deepEqual(await syncSite(env, 1), { ok: true });
  const site = await getSite(db, 1);
  assert.equal(site.kind, "static");
  assert.equal(site.status, "connected");
  assert.equal(site.icon_url, "https://docs.example.com/icon.svg");
  assert.equal(site.cf_error, null);
  assert.equal(site.last_deployed_at, Date.parse("2026-09-02T10:00:00Z") / 1000);
  const rows = await listDeployments(db, 1);
  assert.deepEqual(
    rows.map((row) => [row.type, row.ref, row.status]),
    [
      ["deployment", "d2", "live"],
      ["build", "b1", "failed"],
      ["deployment", "d1", "live"],
    ],
  );
  assert.equal(rows.find((row) => row.ref === "d1").message, "Fix nav");
  const build = rows.find((row) => row.ref === "b1");
  assert.equal(build.message, "Update docs");
  assert.equal(build.branch, "main");
  // The API token is only ever sent to Cloudflare, as a bearer token.
  const cloudflare = calls.filter((call) => call.url.hostname === "api.cloudflare.com");
  assert.ok(cloudflare.length >= 2);
  assert.ok(cloudflare.every((call) => call.init.headers.Authorization === "Bearer cf-token"));
  // A static site has no connection key, so nothing can sign requests to it.
  assert.equal(await getCredentials(env, 1), null);
});

test("a site that answers with an error is marked down, and the Cloudflare data still loads", async () => {
  const { env, db } = await setup({ siteStatus: 503, routes: WORKER_ROUTES });
  assert.deepEqual(await syncSite(env, 1), { ok: false, error: "The site answered HTTP 503" });
  const site = await getSite(db, 1);
  assert.equal(site.status, "error");
  assert.equal(site.last_error, "The site answered HTTP 503");
  assert.equal((await listDeployments(db, 1)).length, 3);
});

test("a token that cannot read builds still shows deployments, with the reason", async () => {
  const { env, db } = await setup({
    routes: {
      ...WORKER_ROUTES,
      "/accounts/acc/builds/workers/tag-1/builds": () => new Response("{}", { status: 403 }),
    },
  });
  assert.equal((await syncSite(env, 1)).ok, true);
  const site = await getSite(db, 1);
  assert.match(site.cf_error, /Workers Builds Configuration/);
  assert.equal((await listDeployments(db, 1)).length, 2);
});

test("a Cloudflare failure leaves the site up and the last deployments in place", async () => {
  const { env, db } = await setup({ routes: WORKER_ROUTES });
  await syncSite(env, 1);
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) =>
    new URL(url).hostname === "api.cloudflare.com" ? new Response("{}", { status: 401 }) : original(url, init);
  assert.equal((await syncSite(env, 1)).ok, true);
  const site = await getSite(db, 1);
  assert.equal(site.status, "connected");
  assert.match(site.cf_error, /did not accept that API token/);
  assert.equal((await listDeployments(db, 1)).length, 3);
});

test("build outcomes map to a status", () => {
  assert.equal(buildStatus({ status: "queued" }), "queued");
  assert.equal(buildStatus({ status: "running" }), "building");
  assert.equal(buildStatus({ status: "stopped", build_outcome: "success" }), "success");
  assert.equal(buildStatus({ status: "stopped", build_outcome: "fail" }), "failed");
  assert.equal(buildStatus({ status: "stopped", build_outcome: "terminated" }), "cancelled");
  assert.equal(buildStatus({ status: "stopped", build_outcome: "skipped" }), "skipped");
});

test("a build log is read a page at a time", async () => {
  await setup({
    routes: {
      "/accounts/acc/builds/builds/b1/logs": (u) =>
        cf(
          u.searchParams.get("cursor")
            ? { lines: [], cursor: "end", truncated: false }
            : {
                lines: [
                  [1636472400, "Building worker..."],
                  [1636472401000, "Done"],
                ],
                cursor: "c2",
                truncated: true,
              },
        ),
    },
  });
  const first = await fetchBuildLog("t", "acc", "b1");
  assert.deepEqual(first, {
    lines: [
      { time: 1636472400, text: "Building worker..." },
      { time: 1636472401, text: "Done" },
    ],
    cursor: "c2",
    truncated: true,
  });
  assert.equal((await fetchBuildLog("t", "acc", "b1", "c2")).cursor, null);
});

test("Workers are listed across accounts, and a token with no account is refused", async () => {
  await setup({
    routes: {
      "/accounts": () =>
        cf([
          { id: "acc", name: "Main" },
          { id: "two", name: "Other" },
        ]),
      "/accounts/acc/workers/scripts": () => cf([{ id: "web", tag: "t1" }]),
      "/accounts/two/workers/scripts": () => cf([{ id: "api", tag: "t2" }]),
    },
  });
  assert.deepEqual(
    (await listWorkers("t")).map((worker) => [worker.account_name, worker.name]),
    [
      ["Main", "web"],
      ["Other", "api"],
    ].sort((a, b) => a[1].localeCompare(b[1])),
  );
  globalThis.fetch = async () => cf([]);
  await assert.rejects(listWorkers("t"), /cannot see any Cloudflare account/);
});
