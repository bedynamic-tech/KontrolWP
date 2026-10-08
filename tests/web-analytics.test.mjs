import assert from "node:assert/strict";
import test from "node:test";
import { CloudflareError } from "../src/worker/cloudflare.ts";
import {
  listWebAnalyticsSites,
  matchWebAnalyticsSite,
  webAnalytics,
  webAnalyticsDetails,
} from "../src/worker/web-analytics.ts";

const NOW = Date.UTC(2026, 9, 8, 12, 30);

function stubFetch(handlers) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    const handler = handlers[u.pathname];
    if (!handler) return new Response("not found", { status: 404 });
    const [status, body] = handler(u, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return calls;
}

const source = { id: "acct1:tag1", name: "example.com", domain: "example.com" };

test("lists Web Analytics sites across accounts and matches one by domain", async () => {
  stubFetch({
    "/client/v4/accounts": () => [
      200,
      { success: true, result: [{ id: "acct1", name: "Main" }] },
    ],
    "/client/v4/accounts/acct1/rum/site_info/list": () => [
      200,
      {
        success: true,
        result: [
          { site_tag: "tag1", host: "example.com" },
          { site_tag: "tag2", ruleset: { zone_name: "shop.test" } },
          { site_tag: "bad tag!", host: "x.test" },
        ],
      },
    ],
  });
  const sites = await listWebAnalyticsSites("token");
  assert.deepEqual(
    sites.map((site) => [site.id, site.domain]),
    [
      ["acct1:tag1", "example.com"],
      ["acct1:tag2", "shop.test"],
    ],
  );
  assert.equal(
    matchWebAnalyticsSite(sites, "https://www.example.com/")?.id,
    "acct1:tag1",
  );
  assert.equal(matchWebAnalyticsSite(sites, "https://other.test"), null);
});

test("builds the summary from page loads and visits, with no visitors, bounces or duration", async () => {
  const calls = stubFetch({
    "/client/v4/graphql": () => [
      200,
      {
        data: {
          viewer: {
            accounts: [
              {
                series: [
                  {
                    count: 10,
                    sum: { visits: 6 },
                    dimensions: { value: "2026-10-08T09:00:00Z" },
                  },
                  {
                    count: 5,
                    sum: { visits: 4 },
                    dimensions: { value: "2026-10-08T10:00:00Z" },
                  },
                  {
                    count: 1,
                    sum: { visits: 1 },
                    dimensions: { value: "2020-01-01T00:00:00Z" },
                  },
                ],
                current: [{ count: 15, sum: { visits: 10 } }],
                previous: [{ count: 10, sum: { visits: 8 } }],
                pages: [{ count: 9, dimensions: { value: "/" } }],
                referrers: [{ count: 4, dimensions: { value: "" } }],
              },
            ],
          },
        },
      },
    ],
  });
  const data = await webAnalytics("token", source, "24h", "UTC", NOW);
  assert.equal(data.provider, "cloudflare");
  assert.equal(data.stats.visitors, null);
  assert.equal(data.stats.bounces, null);
  assert.deepEqual(data.stats.pageviews, { value: 15, previous: 10 });
  assert.deepEqual(data.stats.visits, { value: 10, previous: 8 });
  assert.equal(
    data.series.find((point) => point.label === "2026-10-08 09").pageviews,
    10,
  );
  assert.equal(
    data.series.reduce((sum, point) => sum + point.pageviews, 0),
    15,
  );
  assert.deepEqual(data.referrers, [{ label: "Direct", count: 4 }]);
  const query = JSON.parse(calls[0].init.body).query;
  assert.match(query, /accountTag: "acct1"/);
  assert.match(query, /siteTag: "tag1"/);
  assert.equal(calls[0].init.headers.Authorization, "Bearer token");
});

test("the details add breakdowns and leave out the ones Cloudflare lacks", async () => {
  stubFetch({
    "/client/v4/graphql": (_u, init) => {
      const query = JSON.parse(init.body).query;
      const row = (value) => [
        { count: 3, sum: { visits: 2 }, dimensions: { value } },
      ];
      return [
        200,
        {
          data: {
            viewer: {
              accounts: [
                query.includes("countries:")
                  ? {
                      countries: row("US"),
                      browsers: row("Chrome"),
                      os: row("macOS"),
                      devices: row("desktop"),
                    }
                  : {
                      series: [],
                      current: [],
                      previous: [],
                      pages: row("/"),
                      referrers: [],
                    },
              ],
            },
          },
        },
      ];
    },
  });
  const data = await webAnalyticsDetails("token", source, "7d", "UTC", NOW);
  assert.equal(data.breakdowns.countries[0].label, "US");
  assert.equal(data.breakdowns.entry, null);
  assert.equal(data.breakdowns.cities, null);
  assert.equal(data.active, null);
});

test("a token without analytics access says which permission to add", async () => {
  stubFetch({
    "/client/v4/graphql": () => [
      200,
      { data: null, errors: [{ message: "does not have access to the path" }] },
    ],
  });
  await assert.rejects(
    webAnalytics("token", source, "7d", "UTC", NOW),
    (error) =>
      error instanceof CloudflareError &&
      /Account Analytics: Read/.test(error.message),
  );
});

test("a token that cannot list Web Analytics sites answers with the permission code", async () => {
  stubFetch({
    "/client/v4/accounts": () => [200, { success: true, result: [{ id: "acct1", name: "Main" }] }],
    "/client/v4/accounts/acct1/rum/site_info/list": () => [403, { success: false, errors: [{ message: "forbidden" }] }],
  });
  await assert.rejects(
    listWebAnalyticsSites("token"),
    (error) => error instanceof CloudflareError && error.code === "cloudflare_permission" && /Account Analytics: Read/.test(error.message),
  );
});

test("a token that cannot run the analytics query answers with the permission code too", async () => {
  stubFetch({ "/client/v4/graphql": () => [200, { data: null, errors: [{ message: "does not have access to the path" }] }] });
  await assert.rejects(
    webAnalytics("token", source, "7d", "UTC", NOW),
    (error) => error instanceof CloudflareError && error.code === "cloudflare_permission",
  );
});
