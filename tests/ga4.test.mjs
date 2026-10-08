import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import test from "node:test";
import {
  ga4Analytics,
  ga4Details,
  listGa4Properties,
  matchGa4Property,
} from "../src/worker/ga4.ts";
import {
  forgetGoogleTokens,
  googleAccessToken,
  googleCall,
  GoogleError,
  parseGoogleKey,
} from "../src/worker/google.ts";

const NOW = Date.UTC(2026, 9, 8, 12, 30);
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const account = JSON.stringify({
  type: "service_account",
  client_email: "kontrol@proj.iam.gserviceaccount.com",
  private_key: pem,
});

function stubFetch(handlers) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method ?? "GET"} ${u.host}${u.pathname}`;
    calls.push({ key, init, url: u });
    const handler = handlers[key];
    if (!handler)
      return new Response(
        JSON.stringify({ error: { message: `no stub for ${key}` } }),
        { status: 404 },
      );
    const [status, body] = handler(init, u);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return calls;
}

test("reads a service account key and refuses anything else", () => {
  assert.equal(
    parseGoogleKey(account).client_email,
    "kontrol@proj.iam.gserviceaccount.com",
  );
  assert.throws(() => parseGoogleKey("not json"), GoogleError);
  assert.throws(
    () => parseGoogleKey(JSON.stringify({ type: "authorized_user" })),
    /service account/,
  );
});

test("signs a JWT the key's public half verifies and exchanges it for a token", async () => {
  forgetGoogleTokens();
  let assertion = "";
  const calls = stubFetch({
    "POST oauth2.googleapis.com/token": (init) => {
      assertion = new URLSearchParams(init.body.toString()).get("assertion");
      return [200, { access_token: "tok-1" }];
    },
  });
  const key = parseGoogleKey(account);
  assert.equal(await googleAccessToken(key, "scope-a", NOW), "tok-1");
  // A second request inside the hour reuses it.
  assert.equal(await googleAccessToken(key, "scope-a", NOW + 1000), "tok-1");
  assert.equal(calls.length, 1);
  const [header, claims, signature] = assertion.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url")).alg, "RS256");
  const body = JSON.parse(Buffer.from(claims, "base64url"));
  assert.equal(body.iss, key.client_email);
  assert.equal(body.scope, "scope-a");
  assert.ok(
    createVerify("RSA-SHA256")
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature, "base64url")),
  );
});

test("a rejected key and a missing grant each say what to do", async () => {
  forgetGoogleTokens();
  stubFetch({
    "POST oauth2.googleapis.com/token": () => [
      400,
      { error_description: "Invalid JWT Signature." },
    ],
  });
  await assert.rejects(
    googleAccessToken(parseGoogleKey(account), "s", NOW),
    /Invalid JWT Signature/,
  );
  stubFetch({
    "GET analyticsadmin.googleapis.com/v1beta/accountSummaries": () => [
      403,
      { error: { message: "The caller does not have permission" } },
    ],
  });
  await assert.rejects(
    googleCall(
      "t",
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
    ),
    /Google said: The caller does not have permission/,
  );
  stubFetch({
    "GET analyticsadmin.googleapis.com/v1beta/accountSummaries": () => [
      403,
      {
        error: {
          message:
            "Google Analytics Admin API has not been used in project 1 before or it is disabled.",
        },
      },
    ],
  });
  await assert.rejects(
    googleCall(
      "t",
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
    ),
    /Enable the API/,
  );
});

const admin = "analyticsadmin.googleapis.com/v1beta";
const data = "analyticsdata.googleapis.com/v1beta";

test("lists properties with their web stream domain and matches a site by it", async () => {
  stubFetch({
    [`GET ${admin}/accountSummaries`]: () => [
      200,
      {
        accountSummaries: [
          {
            propertySummaries: [
              { property: "properties/111", displayName: "Example" },
              { property: "properties/222", displayName: "Shop" },
            ],
          },
        ],
      },
    ],
    [`GET ${admin}/properties/111/dataStreams`]: () => [
      200,
      {
        dataStreams: [
          { webStreamData: { defaultUri: "https://www.example.com" } },
        ],
      },
    ],
    [`GET ${admin}/properties/222/dataStreams`]: () => [
      200,
      { dataStreams: [] },
    ],
  });
  const properties = await listGa4Properties("t");
  assert.deepEqual(properties, [
    { id: "111", name: "Example", domain: "example.com" },
    { id: "222", name: "Shop", domain: "" },
  ]);
  assert.equal(matchGa4Property(properties, "https://example.com/")?.id, "111");
  assert.equal(matchGa4Property(properties, "https://nope.test"), null);
});

const property = { id: "111", name: "Example", domain: "example.com" };
const metrics = (...values) =>
  values.map((value) => ({ value: String(value) }));

function dataStubs(extra = {}) {
  return stubFetch({
    [`GET ${admin}/properties/111`]: () => [200, { timeZone: "UTC" }],
    [`POST ${data}/properties/111:runReport`]: (init) => {
      const body = JSON.parse(init.body);
      if (body.dateRanges.length === 2) {
        return [
          200,
          {
            rows: [
              {
                dimensionValues: [{ value: "current" }],
                metricValues: metrics(50, 80, 200, 0.25, 30),
              },
              {
                dimensionValues: [{ value: "previous" }],
                metricValues: metrics(40, 60, 150, 0.5, 20),
              },
            ],
          },
        ];
      }
      const dimension = body.dimensions?.[0]?.name;
      if (dimension === "date") {
        return [
          200,
          {
            rows: [
              {
                dimensionValues: [{ value: "20261007" }],
                metricValues: metrics(10, 12, 40, 0.5, 20),
              },
            ],
          },
        ];
      }
      if (dimension === "dateHour") {
        return [
          200,
          {
            rows: [
              {
                dimensionValues: [{ value: "2026100809" }],
                metricValues: metrics(3, 4, 10, 0.5, 10),
              },
              {
                dimensionValues: [{ value: "2026100709" }],
                metricValues: metrics(2, 2, 5, 0, 10),
              },
            ],
          },
        ];
      }
      const names = {
        pagePath: "/about",
        sessionSource: "(direct)",
        country: "Canada",
        eventName: "click",
      };
      return [
        200,
        {
          rows: [
            {
              dimensionValues: [{ value: names[dimension] ?? "x" }],
              metricValues: metrics(7),
            },
          ],
        },
      ];
    },
    [`POST ${data}/properties/111:runRealtimeReport`]: () => [
      200,
      { rows: [{ metricValues: metrics(4) }] },
    ],
    ...extra,
  });
}

test("a multi-day summary uses GA's own totals against the previous period", async () => {
  dataStubs();
  const result = await ga4Analytics("t", property, "7d", "UTC", NOW);
  assert.equal(result.provider, "ga4");
  assert.deepEqual(result.stats.visitors, { value: 50, previous: 40 });
  assert.deepEqual(result.stats.visits, { value: 80, previous: 60 });
  assert.deepEqual(result.stats.pageviews, { value: 200, previous: 150 });
  // Bounces and time are rates times sessions: 0.25 * 80 and 30 * 80.
  assert.deepEqual(result.stats.bounces, { value: 20, previous: 30 });
  assert.deepEqual(result.stats.totaltime, { value: 2400, previous: 1200 });
  assert.equal(
    result.series.find((point) => point.label === "2026-10-07").pageviews,
    40,
  );
  assert.deepEqual(result.pages, [{ label: "/about", count: 7 }]);
  assert.deepEqual(result.referrers, [{ label: "Direct", count: 7 }]);
});

test("a 24 hour summary adds up the hours in and before the window", async () => {
  dataStubs();
  const result = await ga4Analytics("t", property, "24h", "UTC", NOW);
  assert.deepEqual(result.stats.pageviews, { value: 10, previous: 5 });
  assert.deepEqual(result.stats.visits, { value: 4, previous: 2 });
});

test("the details add GA's breakdowns and the people on the site now", async () => {
  dataStubs();
  const result = await ga4Details("t", property, "7d", "UTC", NOW);
  assert.equal(result.active, 4);
  assert.equal(result.breakdowns.countries[0].label, "Canada");
  assert.equal(result.breakdowns.events[0].label, "click");
  assert.equal(result.breakdowns.exit, null);
});
