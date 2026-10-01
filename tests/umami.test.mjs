import assert from "node:assert/strict";
import test from "node:test";
import { analyticsWindow, bareHost, listUmamiWebsites, matchWebsite, siteAnalytics, umamiClient, UmamiError } from "../src/worker/umami.ts";

/** Stub fetch with a handler per path; records each request. */
function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    const handler = routes[u.pathname];
    if (!handler) return new Response("not found", { status: 404 });
    const [status, body] = handler(u, init);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

test("Umami Cloud sends the API key as a bearer token to api.umami.is/v1", async () => {
  const calls = stubFetch({ "/v1/websites": () => [200, { data: [{ id: "w1", name: "Example", domain: "www.example.com" }], count: 1 }] });
  const client = await umamiClient({ mode: "cloud", url: "", username: "", secret: "key-1" });
  const websites = await listUmamiWebsites(client);
  assert.deepEqual(websites, [{ id: "w1", name: "Example", domain: "www.example.com" }]);
  assert.equal(calls[0].url.origin, "https://api.umami.is");
  assert.equal(calls[0].init.headers.Authorization, "Bearer key-1");
});

test("a self-hosted Umami is logged in to, and older array lists are read", async () => {
  const calls = stubFetch({
    "/api/auth/login": (_u, init) => {
      const body = JSON.parse(init.body);
      return body.password === "pw" ? [200, { token: "tok" }] : [401, { error: "bad" }];
    },
    "/api/websites": () => [200, [{ id: "w2", name: "Shop", domain: "shop.example.com" }]],
  });
  const client = await umamiClient({ mode: "self-hosted", url: "https://umami.example.com/", username: "admin", secret: "pw" });
  assert.equal((await listUmamiWebsites(client))[0].id, "w2");
  assert.equal(calls[1].init.headers.Authorization, "Bearer tok");
  await assert.rejects(
    umamiClient({ mode: "self-hosted", url: "https://umami.example.com", username: "admin", secret: "nope" }),
    (error) => error instanceof UmamiError && /username and password/.test(error.message),
  );
});

test("sites match their Umami website by domain, ignoring www and paths", () => {
  assert.equal(bareHost("https://WWW.Example.com:8443/blog"), "example.com");
  const websites = [{ id: "a", name: "A", domain: "shop.example.com" }, { id: "b", name: "B", domain: "www.example.com" }];
  assert.equal(matchWebsite(websites, "https://example.com/")?.id, "b");
  assert.equal(matchWebsite(websites, "https://other.example.com")?.id, undefined);
});

test("the window has one bucket per day from local midnight, or per hour for 24h", () => {
  const now = Date.UTC(2026, 9, 1, 15, 30); // 11:30 in New York
  const week = analyticsWindow("7d", "America/New_York", now);
  assert.deepEqual(week.keys, ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]);
  assert.equal(week.startAt, Date.UTC(2026, 8, 25, 4)); // midnight EDT
  const day = analyticsWindow("24h", "UTC", now);
  assert.equal(day.keys.length, 24);
  assert.equal(day.keys.at(-1), "2026-10-01 15");
});

test("analytics read both stats formats, fill empty days and fall back to the url metric", async () => {
  const metricTypes = [];
  stubFetch({
    "/v1/websites/w1/stats": () => [200, { pageviews: 120, visitors: 40, visits: 50, bounces: 20, totaltime: 3000, comparison: { pageviews: 100, visitors: 30, visits: 45, bounces: 25, totaltime: 2500 } }],
    "/v1/websites/w1/pageviews": () => [200, { pageviews: [{ x: "2026-09-30 00:00:00", y: 70 }, { x: "2026-10-01 00:00:00", y: 50 }], sessions: [{ x: "2026-10-01 00:00:00", y: 20 }] }],
    "/v1/websites/w1/metrics": (u) => {
      const type = u.searchParams.get("type");
      metricTypes.push(type);
      if (type === "path") return [400, { error: "Bad request" }];
      return [200, type === "url" ? [{ x: "/", y: 90 }] : [{ x: "", y: 30 }, { x: "google.com", y: 10 }]];
    },
  });
  const client = await umamiClient({ mode: "cloud", url: "", username: "", secret: "k" });
  const now = Date.UTC(2026, 9, 1, 12);
  const result = await siteAnalytics(client, { id: "w1", name: "E", domain: "example.com" }, "7d", "UTC", now);
  assert.deepEqual(result.stats.pageviews, { value: 120, previous: 100 });
  assert.deepEqual(result.series.slice(-3), [
    { label: "2026-09-29", pageviews: 0, visitors: 0 },
    { label: "2026-09-30", pageviews: 70, visitors: 0 },
    { label: "2026-10-01", pageviews: 50, visitors: 20 },
  ]);
  assert.equal(result.series.length, 7);
  assert.deepEqual(result.pages, [{ label: "/", count: 90 }]);
  assert.deepEqual(result.referrers, [{ label: "Direct", count: 30 }, { label: "google.com", count: 10 }]);
  assert.deepEqual(metricTypes.sort(), ["path", "referrer", "url"]);

  stubFetch({
    "/v1/websites/w1/stats": () => [200, { pageviews: { value: 5, prev: 3 }, visitors: { value: 2, prev: 1 }, visits: { value: 2, prev: 1 }, bounces: { value: 1, prev: 0 }, totaltime: { value: 60, prev: 30 } }],
    "/v1/websites/w1/pageviews": () => [200, { pageviews: [], sessions: [] }],
    "/v1/websites/w1/metrics": () => [200, []],
  });
  const old = await siteAnalytics(client, { id: "w1", name: "E", domain: "example.com" }, "24h", "UTC");
  assert.deepEqual(old.stats.pageviews, { value: 5, previous: 3 });
  assert.equal(old.series.length, 24);
});
