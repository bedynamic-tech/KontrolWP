import assert from "node:assert/strict";
import net from "node:net";
import { Duplex } from "node:stream";
import test from "node:test";
import tls from "node:tls";
import { applyMigrations } from "../src/worker/db/migrate.ts";
import {
  checkCertificate,
  coversHost,
  parseCertificate,
  readLoggedCertificate,
} from "../src/worker/sites/certificate.ts";
import {
  checkSite,
  runScheduledUptime,
  runUptimeMessage,
  siteUptime,
  summarizeUptime,
} from "../src/worker/sites/uptime.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

// A throwaway self-signed certificate for a.test and *.b.test, valid 2026-10-10 to 2036-10-07.
// Its key exists only for these tests.
const CERT = `-----BEGIN CERTIFICATE-----
MIIBtDCCAVmgAwIBAgIBATAKBggqhkjOPQQDAjAqMRcwFQYDVQQKDA5Lb250cm9s
V1AgVGVzdDEPMA0GA1UEAwwGYS50ZXN0MB4XDTI2MTAxMDE4MTUwOFoXDTM2MTAw
NzE4MTUwOFowKjEXMBUGA1UECgwOS29udHJvbFdQIFRlc3QxDzANBgNVBAMMBmEu
dGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABGWe63I3/VZkd49fvDoV5Yp3
xdLw9vCZtQmigpVnb1XxxeGhrpVcrfpShvN/Gfgxpj9sBX2UgZ4AjmwzNpMkglOj
cDBuMB0GA1UdDgQWBBScyu8FqcFYobZBA3+gid1WCi5WMjAfBgNVHSMEGDAWgBSc
yu8FqcFYobZBA3+gid1WCi5WMjAPBgNVHRMBAf8EBTADAQH/MBsGA1UdEQQUMBKC
BmEudGVzdIIIKi5iLnRlc3QwCgYIKoZIzj0EAwIDSQAwRgIhAOAx/Ar9BKunXedR
qCLc6TFg1wTtfoQKAgC1Jdmciak0AiEAw9lFjBU4uXyCdGvKhWbLOS7iiDNzGGGJ
LNL+hVdHAFA=
-----END CERTIFICATE-----`;
const KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgY2bBNS4qTm7OpYkR
CLP7ucAp3dT5kHPUG1lik5TpO3yhRANCAARlnutyN/1WZHePX7w6FeWKd8XS8Pbw
mbUJooKVZ29V8cXhoa6VXK36Uobzfxn4MaY/bAV9lIGeAI5sMzaTJIJT
-----END PRIVATE KEY-----`;
const NOT_BEFORE = Date.UTC(2026, 9, 10, 18, 15, 8) / 1000;
const NOT_AFTER = Date.UTC(2036, 9, 7, 18, 15, 8) / 1000;

function der(pem) {
  return new Uint8Array(Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ""), "base64"));
}

/** A local TLS server speaking only the given versions, and an opener that connects to it as cloudflare:sockets would. */
async function tlsServer(options) {
  const server = tls.createServer({ cert: CERT, key: KEY, ...options }, (socket) => socket.on("error", () => {}));
  server.on("tlsClientError", () => {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const hosts = [];
  const open = async (hostname, wantedPort) => {
    hosts.push([hostname, wantedPort]);
    const socket = net.connect(port, "127.0.0.1");
    await new Promise((resolve, reject) => socket.once("connect", resolve).once("error", reject));
    const { readable, writable } = Duplex.toWeb(socket);
    return { readable, writable, close: () => socket.destroy() };
  };
  return { open, hosts, close: () => new Promise((resolve) => server.close(resolve)) };
}

const noLogs = async () => {
  throw new Error("The logs should not be asked");
};

test("parseCertificate reads names, issuer and dates", () => {
  const cert = parseCertificate(der(CERT));
  assert.deepEqual(cert, {
    subject: "a.test",
    issuer: "a.test",
    valid_from: NOT_BEFORE,
    expires_at: NOT_AFTER,
    names: ["a.test", "*.b.test"],
  });
});

test("coversHost matches exact names and one-label wildcards", () => {
  assert.equal(coversHost(["a.test"], "A.test"), true);
  assert.equal(coversHost(["*.b.test"], "www.b.test"), true);
  assert.equal(coversHost(["*.b.test"], "b.test"), false);
  assert.equal(coversHost(["*.b.test"], "x.www.b.test"), false);
  assert.equal(coversHost(["a.test"], "c.test"), false);
});

test("checkCertificate reads the certificate from a TLS 1.2 handshake", async () => {
  const server = await tlsServer({ minVersion: "TLSv1.2", maxVersion: "TLSv1.3" });
  try {
    const cert = await checkCertificate("www.b.test", 100, { open: server.open, fetcher: noLogs });
    assert.deepEqual(server.hosts, [["www.b.test", 443]]);
    assert.equal(cert.source, "server");
    assert.equal(cert.expires_at, NOT_AFTER);
    assert.equal(cert.covers_host, true);
    assert.equal(cert.error, null);
    assert.equal(cert.checked_at, 100);

    const other = await checkCertificate("c.test", 100, { open: server.open, fetcher: noLogs });
    assert.equal(other.covers_host, false);
  } finally {
    await server.close();
  }
});

/** A Cert Spotter answer: pages of issuances, oldest first. */
function logs(pages) {
  const asked = [];
  const fetcher = async (url) => {
    asked.push(new URL(url));
    const after = new URL(url).searchParams.get("after");
    const page = after ? pages.findIndex((items) => items[0]?.prev === after) : 0;
    return Response.json(page === -1 ? [] : pages[page].map(({ prev, ...item }) => item));
  };
  return { fetcher, asked };
}

const NOW = Date.UTC(2026, 9, 10) / 1000;
const issuance = (id, from, to, names = ["a.test"], extra = {}) => ({
  id,
  dns_names: names,
  not_before: new Date(from * 1000).toISOString(),
  not_after: new Date(to * 1000).toISOString(),
  issuer: { friendly_name: "Let's Encrypt", name: "C=US, O=Let's Encrypt, CN=R11" },
  ...extra,
});

test("a server that only speaks TLS 1.3 falls back to the certificate logs", async () => {
  const server = await tlsServer({ minVersion: "TLSv1.3" });
  const { fetcher, asked } = logs([[issuance("1", NOW - 10 * 86400, NOW + 80 * 86400, ["a.test"])]]);
  try {
    const cert = await checkCertificate("a.test", NOW, { open: server.open, fetcher });
    assert.equal(cert.source, "ct");
    assert.equal(cert.expires_at, NOW + 80 * 86400);
    assert.equal(cert.issuer, "Let's Encrypt");
    assert.equal(asked[0].searchParams.get("domain"), "a.test");
    assert.equal(asked[0].searchParams.get("match_wildcards"), "true");
  } finally {
    await server.close();
  }
});

test("readLoggedCertificate pages through the logs and takes the newest valid certificate", async () => {
  const day = 86400;
  const first = [];
  for (let i = 0; i < 100; i++) first.push(issuance(String(i + 1), NOW - 900 * day, NOW - 800 * day));
  const { fetcher, asked } = logs([
    first,
    [
      { ...issuance("101", NOW - 40 * day, NOW + 50 * day), prev: "100" },
      issuance("102", NOW - 5 * day, NOW + 85 * day, ["*.test"]),
      issuance("103", NOW - 2 * day, NOW + 88 * day, ["other.test"]),
      issuance("104", NOW - 1 * day, NOW + 89 * day, ["a.test"], { revoked: true }),
      issuance("105", NOW + 1 * day, NOW + 91 * day, ["a.test"]),
    ],
  ]);
  const cert = await readLoggedCertificate("a.test", NOW, fetcher);
  assert.equal(asked.length, 2);
  assert.equal(asked[1].searchParams.get("after"), "100");
  assert.equal(cert.expires_at, NOW + 85 * day);
  assert.equal(cert.subject, "*.test");
});

test("checkCertificate says when neither the server nor the logs answer", async () => {
  const open = async () => {
    throw new Error("connect refused");
  };
  const cert = await checkCertificate("a.test", NOW, {
    open,
    fetcher: async () => new Response("busy", { status: 429 }),
  });
  assert.equal(cert.source, null);
  assert.equal(cert.expires_at, null);
  assert.match(cert.error, /could not be read/);
});

async function database() {
  const db = fakeD1();
  await applyMigrations(db, migrations);
  db.sqlite.exec(`INSERT INTO sites (id, name, url, key_id, secret, created_at) VALUES
    (1, 'A', 'https://a.test/', 'k', 's', 0),
    (2, 'B', 'https://b.test/', 'k', 's', 0),
    (3, 'C', 'http://c.test/', 'k', 's', 0)`);
  return db;
}

function queue() {
  const sent = [];
  return { sent, send: async (body) => sent.push(body), sendBatch: async (messages) => sent.push(...messages.map((m) => m.body)) };
}

const offline = async () => {
  throw new Error("offline");
};

test("checkSite records each answer and when the site went up or down", async () => {
  const db = await database();
  const env = { DB: db, SYNC_QUEUE: queue() };
  let status = 200;
  const fetcher = async (url) => {
    if (String(url).startsWith("https://api.certspotter.com")) return Response.json([]);
    if (status === 0) throw new TypeError("fetch failed");
    return new Response("<html>", { status });
  };
  const deps = { fetcher, open: offline, retryDelayMs: 0 };

  await checkSite(env, 1, 1000, deps);
  let site = db.sqlite.prepare("SELECT uptime_up, uptime_since, uptime_checked_at FROM sites WHERE id = 1").get();
  assert.deepEqual({ ...site }, { uptime_up: 1, uptime_since: 1000, uptime_checked_at: 1000 });

  await checkSite(env, 1, 1900, deps);
  site = db.sqlite.prepare("SELECT uptime_up, uptime_since FROM sites WHERE id = 1").get();
  assert.deepEqual({ ...site }, { uptime_up: 1, uptime_since: 1000 });

  status = 503;
  await checkSite(env, 1, 2800, deps);
  status = 0;
  await checkSite(env, 1, 3700, deps);
  site = db.sqlite.prepare("SELECT uptime_up, uptime_since FROM sites WHERE id = 1").get();
  assert.deepEqual({ ...site }, { uptime_up: 0, uptime_since: 2800 });

  status = 200;
  await checkSite(env, 1, 4600, deps);
  const uptime = await siteUptime(env, 1, 4600);
  assert.equal(uptime.since, 4600);
  assert.equal(uptime.latest.up, true);
  assert.equal(uptime.latest.status_code, 200);
  assert.equal(uptime.ratios.day, 60);
  assert.deepEqual(uptime.incidents, [{ started_at: 2800, ended_at: 4600, error: "The site answered HTTP 503" }]);
  assert.equal(uptime.ssl.source, null, "the certificate was looked for once");
  assert.equal(uptime.ssl.checked_at, 1000);
});

test("a failed check is tried again before the site counts as down", async () => {
  const db = await database();
  let calls = 0;
  const fetcher = async (url) => {
    if (String(url).startsWith("https://api.certspotter.com")) return Response.json([]);
    calls++;
    return new Response("", { status: calls === 1 ? 502 : 200 });
  };
  await checkSite({ DB: db }, 1, 1000, { fetcher, open: offline, retryDelayMs: 0 });
  assert.equal(calls, 2);
  assert.equal(db.sqlite.prepare("SELECT uptime_up FROM sites WHERE id = 1").get().uptime_up, 1);
});

test("a plain http site gets no certificate check", async () => {
  const db = await database();
  await checkSite({ DB: db }, 3, 1000, {
    fetcher: async () => new Response("", { status: 200 }),
    open: offline,
    retryDelayMs: 0,
  });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM ssl_certificates").get().n, 0);
});

test("runScheduledUptime queues due sites and skips switched off ones", async () => {
  const db = await database();
  const env = { DB: db, SYNC_QUEUE: queue() };
  db.sqlite.exec("UPDATE sites SET uptime_excluded = 1 WHERE id = 3");
  db.sqlite.exec("UPDATE sites SET uptime_checked_at = 10000 WHERE id = 2");
  assert.equal(await runScheduledUptime(env, 10000 + 300), 1);
  assert.deepEqual(env.SYNC_QUEUE.sent, [{ type: "uptime", siteIds: [1] }]);
  // A cron a little early still counts a check from the last run as due.
  assert.equal(await runScheduledUptime(env, 10000 + 900 - 30), 2);
});

test("runUptimeMessage skips a site checked since it was queued", async () => {
  const db = await database();
  db.sqlite.exec("UPDATE sites SET uptime_checked_at = 990 WHERE id = 2");
  const checked = [];
  const fetcher = async (url) => {
    if (String(url).startsWith("https://api.certspotter.com")) return Response.json([]);
    checked.push(String(url));
    return new Response("", { status: 200 });
  };
  await runUptimeMessage({ DB: db }, [1, 2, 99], () => 1000, { fetcher, open: offline, retryDelayMs: 0 });
  assert.deepEqual(checked, ["https://a.test/"]);
});

test("summarizeUptime builds 30 daily totals and keeps an open outage open", () => {
  const day = 86400;
  const now = 40 * day + 3600;
  const checks = [
    { checked_at: 20 * day, up: true, status_code: 200, response_ms: 100, error: null },
    { checked_at: 40 * day + 60, up: true, status_code: 200, response_ms: 300, error: null },
    { checked_at: 40 * day + 960, up: false, status_code: null, response_ms: null, error: "Could not reach the site" },
  ];
  const summary = summarizeUptime(checks, now);
  assert.equal(summary.days.length, 30);
  assert.equal(summary.days[29].day, 40 * day);
  assert.deepEqual(summary.days[29], { day: 40 * day, checks: 2, up: 1 });
  assert.equal(summary.days[0].day, 11 * day);
  assert.deepEqual(summary.days[9], { day: 20 * day, checks: 1, up: 1 });
  assert.equal(summary.average_ms, 300);
  assert.equal(summary.ratios.day, 50);
  assert.equal(summary.ratios.month, 66.67);
  assert.deepEqual(summary.incidents, [{ started_at: 40 * day + 960, ended_at: null, error: "Could not reach the site" }]);
  assert.equal(summary.recent.length, 2);
});
