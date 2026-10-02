import assert from "node:assert/strict";
import test from "node:test";
import { cachedRead, clearContentCache } from "../src/worker/content-cache.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

function setup() {
  const db = fakeD1();
  for (const m of migrations) db.sqlite.exec(m.sql);
  db.sqlite.exec("INSERT INTO sites (id, name, url, key_id, secret) VALUES (1, 'A', 'https://a.example', 'k', 'x')");
  return db;
}

test("an answer is reused for an hour, then read again", async () => {
  const db = setup();
  let reads = 0;
  const read = async () => ({ n: ++reads });
  assert.deepEqual(await cachedRead(db, 1, "content", "k", read, 1000), { n: 1 });
  assert.deepEqual(await cachedRead(db, 1, "content", "k", read, 2000), { n: 1 });
  assert.deepEqual(await cachedRead(db, 1, "content", "other", read, 2000), { n: 2 });
  assert.deepEqual(await cachedRead(db, 1, "content", "k", read, 1000 + 3600), { n: 3 });
});

test("a sync or change clears the site's answers", async () => {
  const db = setup();
  let reads = 0;
  const read = async () => ({ n: ++reads });
  await cachedRead(db, 1, "content", "k", read, 1000);
  await cachedRead(db, 1, "pages", "k", read, 1000);
  await clearContentCache(db, 1);
  assert.deepEqual(await cachedRead(db, 1, "content", "k", read, 1001), { n: 3 });
});

test("an old answer is shown when the site cannot be reached, but a failure is never stored", async () => {
  const db = setup();
  await cachedRead(db, 1, "content", "k", async () => ({ n: 1 }), 1000);
  const down = async () => {
    throw new Error("down");
  };
  assert.deepEqual(await cachedRead(db, 1, "content", "k", down, 99999), { n: 1 });
  await assert.rejects(cachedRead(db, 1, "content", "none", down, 1000), /down/);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM content_cache").get().n, 1);
});
