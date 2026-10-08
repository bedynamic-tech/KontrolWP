import assert from "node:assert/strict";
import test from "node:test";
import { adsCustomerId, googleAds, listAdsAccounts } from "../src/worker/google-ads.ts";

function stubFetch(handlers) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: u.pathname, init, body });
    const handler = handlers(u.pathname, body, init);
    if (!handler) return new Response(JSON.stringify({ error: { message: "no stub" } }), { status: 404 });
    return new Response(JSON.stringify(handler[1]), { status: handler[0], headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

test("customer IDs lose their dashes", () => {
  assert.equal(adsCustomerId("123-456-7890"), "1234567890");
  assert.equal(adsCustomerId("customers/1234567890"), "1234567890");
});

test("lists client accounts, reaching them through a manager and skipping managers", async () => {
  const calls = stubFetch((path, body) => {
    if (path.endsWith("customers:listAccessibleCustomers")) return [200, { resourceNames: ["customers/111", "customers/222"] }];
    if (path.includes("/customers/111/")) {
      return [200, { results: [
        { customerClient: { id: "111", descriptiveName: "Manager", manager: true, status: "ENABLED" } },
        { customerClient: { id: "333", descriptiveName: "Shop", manager: false, status: "ENABLED" } },
        { customerClient: { id: "444", descriptiveName: "Closed", manager: false, status: "CANCELED" } },
      ] }];
    }
    if (path.includes("/customers/222/")) return [200, { results: [{ customerClient: { id: "222", descriptiveName: "Direct", manager: false, status: "ENABLED" } }] }];
  });
  const accounts = await listAdsAccounts("tok", "dev");
  assert.deepEqual(accounts.map((a) => [a.id, a.name]), [["222", "Direct"], ["111/333", "Shop"]]);
  assert.equal(calls[0].init.headers["developer-token"], "dev");
  const viaManager = calls.find((call) => call.path.includes("/customers/111/"));
  assert.equal(viaManager.init.headers["login-customer-id"], "111");
});

test("reads the figures for an account and adds up the totals", async () => {
  const calls = stubFetch((path, body) => {
    if (body.query.includes("currency_code")) return [200, { results: [{ customer: { currencyCode: "USD" } }] }];
    if (body.query.includes("2026-11-02")) {
      return [200, { results: [
        { segments: { date: "2026-11-02" }, metrics: { clicks: "10", impressions: "100", costMicros: "5000000", conversions: 1 } },
        { segments: { date: "2026-11-03" }, metrics: { clicks: "20", impressions: "300", costMicros: "7000000", conversions: 2 } },
      ] }];
    }
    return [200, { results: [{ segments: { date: "2026-10-30" }, metrics: { clicks: "15", impressions: "200", costMicros: "6000000", conversions: 1 } }] }];
  });
  const data = await googleAds("tok", "dev", { id: "111/333", name: "Shop", customer: "333" }, "7d", Date.UTC(2026, 10, 8));
  assert.equal(data.currency, "USD");
  assert.deepEqual(data.totals.clicks, { value: 30, previous: 15 });
  assert.deepEqual(data.totals.cost, { value: 12, previous: 6 });
  assert.equal(data.series.length, 2);
  assert.ok(calls.every((call) => call.init.headers["login-customer-id"] === "111"));
  assert.ok(calls.some((call) => call.path.includes("/customers/333/")));
});
