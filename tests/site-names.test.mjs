import assert from "node:assert/strict";
import test from "node:test";
import { randomToken } from "../src/shared/protocol.ts";
import { applyMigrations } from "../src/worker/db/migrate.ts";
import { encryptSecret } from "../src/worker/sites/secrets.ts";
import { getSite, setSiteName } from "../src/worker/sites/store.ts";
import { syncSite } from "../src/worker/sites/sync.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

const json = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

async function setup() {
  const db = fakeD1();
  await applyMigrations(db, migrations);
  const key = randomToken(32);
  db.sqlite.prepare("INSERT INTO sites (id, name, url, key_id, secret) VALUES (1, 'Old title', 'https://example.com', 'k', '')").run();
  db.sqlite.prepare("UPDATE sites SET secret = ? WHERE id = 1").run(await encryptSecret(key, 1, randomToken(32)));
  db.sqlite
    .prepare("INSERT INTO sites (id, kind, name, default_name, url, secret) VALUES (2, 'static', 'docs.example.com', 'docs.example.com', 'https://docs.example.com', '')")
    .run();
  let title = "Shop";
  globalThis.fetch = async (url) => {
    const route = new URL(url).searchParams.get("rest_route");
    if (!route) return new Response("<html></html>");
    if (route === "/kontrolwp/v1/status") return json({ name: title, wp_version: "6.8", php_version: "8.3", plugin_version: "0.1.0", theme: "T" });
    if (route === "/kontrolwp/v1/updates") return json({ core: null, plugins: [], themes: [] });
    if (route === "/kontrolwp/v1/comments") return json({ pending_count: 0, comments: [] });
    return new Response("{}", { status: 404 });
  };
  const env = { DB: db, SITE_SECRETS_KEY: key, SYNC_QUEUE: { send: async () => {} } };
  return { env, db, setTitle: (next) => (title = next) };
}

test("a sync follows the WordPress site title until the owner renames the site", async () => {
  const { env, db, setTitle } = await setup();
  await syncSite(env, 1, { retryDelayMs: 0 });
  assert.deepEqual(
    [(await getSite(db, 1)).name, (await getSite(db, 1)).name_custom, (await getSite(db, 1)).default_name],
    ["Shop", false, "Shop"],
  );

  const renamed = await setSiteName(db, 1, "  My shop  ");
  assert.equal(renamed.name, "My shop");
  assert.equal(renamed.name_custom, true);

  // The title changes on the site: the custom name stays, the default moves on.
  setTitle("Shop Online");
  await syncSite(env, 1, { retryDelayMs: 0 });
  const kept = await getSite(db, 1);
  assert.equal(kept.name, "My shop");
  assert.equal(kept.default_name, "Shop Online");

  const reset = await setSiteName(db, 1, null);
  assert.equal(reset.name, "Shop Online");
  assert.equal(reset.name_custom, false);
  setTitle("Shop Again");
  await syncSite(env, 1, { retryDelayMs: 0 });
  assert.equal((await getSite(db, 1)).name, "Shop Again");
});

test("a static site is named after its domain until renamed, and an empty name resets it", async () => {
  const { db } = await setup();
  assert.equal((await getSite(db, 2)).name, "docs.example.com");
  assert.equal((await setSiteName(db, 2, "Docs")).name, "Docs");
  assert.equal((await setSiteName(db, 2, "   ")).name, "docs.example.com");
  assert.equal(await setSiteName(db, 99, "Nope"), null);
});

test("migration keeps names the owner gave a static site", async () => {
  const db = fakeD1();
  await applyMigrations(db, migrations.filter((m) => m.name < "0017"));
  db.sqlite.prepare("INSERT INTO sites (id, kind, name, url, secret) VALUES (1, 'static', 'docs.example.com', 'https://docs.example.com', '')").run();
  db.sqlite.prepare("INSERT INTO sites (id, kind, name, url, secret) VALUES (2, 'static', 'Our docs', 'https://docs.example.org', '')").run();
  db.sqlite.prepare("INSERT INTO sites (id, name, url, secret) VALUES (3, 'Shop', 'https://shop.example.com', '')").run();
  await applyMigrations(db, migrations);
  assert.deepEqual([1, 2, 3].map((id) => db.sqlite.prepare("SELECT name_custom, default_name FROM sites WHERE id = ?").get(id)).map((r) => ({ ...r })), [
    { name_custom: 0, default_name: null },
    { name_custom: 1, default_name: null },
    { name_custom: 0, default_name: "Shop" },
  ]);
});
