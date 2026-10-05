import assert from "node:assert/strict";
import test from "node:test";
import { randomToken } from "../src/shared/protocol.ts";
import { applyMigrations } from "../src/worker/db/migrate.ts";
import { encryptSecret } from "../src/worker/sites/secrets.ts";
import { syncSite } from "../src/worker/sites/sync.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

const json = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

/** A site whose first `failures` status requests fail the way a dropped connection does. */
async function setup(failures) {
  const db = fakeD1();
  await applyMigrations(db, migrations);
  const key = randomToken(32);
  db.sqlite
    .prepare("INSERT INTO sites (id, name, url, key_id, secret) VALUES (1, 'Example', 'https://example.com', 'k', '')")
    .run();
  db.sqlite.prepare("UPDATE sites SET secret = ? WHERE id = 1").run(await encryptSecret(key, 1, randomToken(32)));
  let left = failures;
  globalThis.fetch = async (url) => {
    const route = new URL(url).searchParams.get("rest_route");
    if (!route) return new Response("<html></html>"); // the icon lookup
    if (route === "/kontrolwp/v1/status") {
      if (left-- > 0) throw new TypeError("Network connection lost");
      return json({ name: "Example", wp_version: "6.8", php_version: "8.3", plugin_version: "0.1.0", theme: "T" });
    }
    if (route === "/kontrolwp/v1/updates") return json({ core: null, plugins: [], themes: [] });
    if (route === "/kontrolwp/v1/comments") return json({ pending_count: 0, comments: [] });
    return new Response("{}", { status: 404 });
  };
  const env = { DB: db, SITE_SECRETS_KEY: key, SYNC_QUEUE: { send: async () => {} } };
  const site = () => db.sqlite.prepare("SELECT status, last_error FROM sites WHERE id = 1").get();
  return { env, site };
}

test("a site that drops one connection is tried again before it is marked unreachable", async () => {
  const { env, site } = await setup(1);
  assert.deepEqual(await syncSite(env, 1, { retryDelayMs: 0 }), { ok: true });
  assert.equal(site().status, "connected");
});

test("a site that fails twice in a row is marked unreachable", async () => {
  const { env, site } = await setup(2);
  const result = await syncSite(env, 1, { retryDelayMs: 0 });
  assert.equal(result.ok, false);
  assert.equal(site().status, "error");
  assert.equal(site().last_error, "Could not reach the site");
});

test("a database that is down is not asked again at once, and the message is plain", async () => {
  const { env, site } = await setup(0);
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(new URL(url).searchParams.get("rest_route") ?? "page");
    return new Response(
      JSON.stringify({ code: "internal_server_error", message: "<h1>Error establishing a database connection</h1>" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  };
  const result = await syncSite(env, 1, { retryDelayMs: 0 });
  assert.equal(result.ok, false);
  assert.deepEqual(asked, ["/kontrolwp/v1/status"]);
  assert.match(site().last_error, /database is not answering/);
  assert.doesNotMatch(site().last_error, /</);
});

test("a site's home page is loaded for its icon once a week, not on every sync", async () => {
  const { env } = await setup(0);
  let pages = 0;
  const inner = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (!new URL(url).searchParams.get("rest_route")) pages++;
    return inner(url);
  };
  await syncSite(env, 1);
  await syncSite(env, 1);
  assert.equal(pages, 1);
});

test("WordPress's maintenance page is explained instead of shown as it came", async () => {
  const { env, site } = await setup(0);
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ code: "maintenance", message: "Briefly unavailable for scheduled maintenance. Check back in a minute." }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  const result = await syncSite(env, 1, { retryDelayMs: 0 });
  assert.equal(result.ok, false);
  assert.match(site().last_error, /maintenance mode/);
  assert.match(site().last_error, /\.maintenance/);
});
