import assert from "node:assert/strict";
import test from "node:test";
import {
  listSearchConsoleProperties,
  matchSearchConsoleProperty,
  searchConsole,
} from "../src/worker/search-console.ts";

const NOW = Date.UTC(2026, 9, 8, 12);

function stubFetch(handlers) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    const handler = handlers[`${init.method ?? "GET"} ${u.pathname}`];
    if (!handler)
      return new Response(JSON.stringify({ error: { message: "no stub" } }), {
        status: 404,
      });
    const [status, body] = handler(init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return calls;
}

test("lists the properties the account can read and prefers a domain property for a site", async () => {
  stubFetch({
    "GET /webmasters/v3/sites": () => [
      200,
      {
        siteEntry: [
          { siteUrl: "https://www.example.com/", permissionLevel: "siteOwner" },
          { siteUrl: "sc-domain:example.com", permissionLevel: "siteFullUser" },
          {
            siteUrl: "https://hidden.test/",
            permissionLevel: "siteUnverifiedUser",
          },
        ],
      },
    ],
  });
  const properties = await listSearchConsoleProperties("t");
  assert.deepEqual(
    properties.map((property) => property.id),
    ["sc-domain:example.com", "https://www.example.com/"],
  );
  assert.equal(
    matchSearchConsoleProperty(properties, "https://example.com")?.id,
    "sc-domain:example.com",
  );
  assert.equal(
    matchSearchConsoleProperty(properties, "https://other.test"),
    null,
  );
});

test("reads totals against the previous period, a daily series, queries and pages", async () => {
  const calls = stubFetch({
    "POST /webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query": (
      init,
    ) => {
      const body = JSON.parse(init.body);
      if (!body.dimensions) {
        return body.startDate === "2026-08-12"
          ? [
              200,
              {
                rows: [
                  { clicks: 40, impressions: 800, ctr: 0.05, position: 9 },
                ],
              },
            ]
          : [
              200,
              {
                rows: [
                  { clicks: 50, impressions: 1000, ctr: 0.05, position: 8 },
                ],
              },
            ];
      }
      const key = {
        date: "2026-10-05",
        query: "kontrol",
        page: "https://example.com/a",
      }[body.dimensions[0]];
      return [
        200,
        {
          rows: [
            {
              keys: [key],
              clicks: 5,
              impressions: 90,
              ctr: 0.0555,
              position: 3.2,
            },
          ],
        },
      ];
    },
  });
  const result = await searchConsole(
    "t",
    { id: "sc-domain:example.com", name: "example.com", domain: "example.com" },
    "28d",
    NOW,
  );
  assert.deepEqual(result.totals.clicks, { value: 50, previous: 40 });
  assert.deepEqual(result.totals.position, { value: 8, previous: 9 });
  assert.deepEqual(result.series, [
    { label: "2026-10-05", clicks: 5, impressions: 90 },
  ]);
  assert.equal(result.queries[0].label, "kontrol");
  assert.equal(result.pages[0].label, "https://example.com/a");
  // The period ends two days back, and the one before it ends the day the period starts.
  const bodies = calls.map((call) => JSON.parse(call.init.body));
  assert.ok(
    bodies.some(
      (body) =>
        body.startDate === "2026-09-09" && body.endDate === "2026-10-06",
    ),
  );
  assert.ok(
    bodies.some(
      (body) =>
        body.startDate === "2026-08-12" && body.endDate === "2026-09-08",
    ),
  );
});

test("a period with no data has no previous figures to compare", async () => {
  stubFetch({
    "POST /webmasters/v3/sites/https%3A%2F%2Fexample.com%2F/searchAnalytics/query":
      () => [200, {}],
  });
  const result = await searchConsole(
    "t",
    { id: "https://example.com/", name: "x", domain: "example.com" },
    "7d",
    NOW,
  );
  assert.deepEqual(result.totals.clicks, { value: 0, previous: null });
  assert.deepEqual(result.queries, []);
});
