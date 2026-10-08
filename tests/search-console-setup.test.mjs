import assert from "node:assert/strict";
import test from "node:test";
import { GoogleError } from "../src/worker/google.ts";
import { addProperty, propertyUrl, submitSitemap, verificationCode, verifyProperty } from "../src/worker/search-console-setup.ts";

function stubFetch(handlers) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method ?? "GET"} ${u.host}${u.pathname}`;
    calls.push({ key, init, url: u });
    const handler = handlers[key];
    if (!handler) return new Response(JSON.stringify({ error: { message: `no stub for ${key}` } }), { status: 404 });
    const [status, body] = handler(init, u, calls.length);
    return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

test("the property for a site is its address with a trailing slash", () => {
  assert.equal(propertyUrl("https://example.com"), "https://example.com/");
  assert.equal(propertyUrl("https://example.com/blog?x=1"), "https://example.com/blog/");
});

test("the verification code is read from Google's meta tag", async () => {
  const calls = stubFetch({
    "POST www.googleapis.com/siteVerification/v1/token": (init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.verificationMethod, "META");
      assert.deepEqual(body.site, { type: "SITE", identifier: "https://example.com/" });
      return [200, { token: '<meta name="google-site-verification" content="abc-123" />', method: "META" }];
    },
  });
  assert.equal(await verificationCode("tok", "https://example.com/"), "abc-123");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  stubFetch({ "POST www.googleapis.com/siteVerification/v1/token": () => [200, { token: "nothing" }] });
  await assert.rejects(verificationCode("tok", "https://example.com/"), GoogleError);
});

test("verification is retried while Google cannot see the tag, then explained", async () => {
  let tries = 0;
  stubFetch({
    "POST www.googleapis.com/siteVerification/v1/webResource": () => {
      tries++;
      return tries < 3 ? [400, { error: { message: "token not found" } }] : [200, { id: "x" }];
    },
  });
  await verifyProperty("tok", "https://example.com/", 3, 1);
  assert.equal(tries, 3);

  stubFetch({ "POST www.googleapis.com/siteVerification/v1/webResource": () => [400, { error: { message: "token not found" } }] });
  await assert.rejects(verifyProperty("tok", "https://example.com/", 2, 1), /could not find the verification tag/);
});

test("the site is added and its sitemap submitted with encoded addresses", async () => {
  const calls = stubFetch({
    "PUT www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fexample.com%2F": () => [204, null],
    "PUT www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fexample.com%2F/sitemaps/https%3A%2F%2Fexample.com%2Fwp-sitemap.xml": () => [204, null],
  });
  await addProperty("tok", "https://example.com/");
  await submitSitemap("tok", "https://example.com/", "https://example.com/wp-sitemap.xml");
  assert.equal(calls.length, 2);
});

test("a disabled Site Verification API keeps the page that turns it on", async () => {
  stubFetch({
    "POST www.googleapis.com/siteVerification/v1/token": () => [
      403,
      {
        error: {
          message:
            "Google Site Verification API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/siteverification.googleapis.com/overview?project=123 then retry.",
        },
      },
    ],
  });
  await assert.rejects(
    verificationCode("tok", "https://example.com/"),
    /Enable it at https:\/\/console\.developers\.google\.com\/apis\/api\/siteverification\.googleapis\.com\/overview\?project=123/,
  );
});

test("a sitemap refused just after the site was added is retried, and a lasting refusal quotes Google", async () => {
  let tries = 0;
  const path = "PUT www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fexample.com%2F/sitemaps/https%3A%2F%2Fexample.com%2Fwp-sitemap.xml";
  stubFetch({
    [path]: () => {
      tries++;
      return tries < 3 ? [403, { error: { message: "User does not have sufficient permission for site" } }] : [204, null];
    },
  });
  await submitSitemap("tok", "https://example.com/", "https://example.com/wp-sitemap.xml", 3, 1);
  assert.equal(tries, 3);

  stubFetch({ [path]: () => [403, { error: { message: "User does not have sufficient permission for site" } }] });
  await assert.rejects(
    submitSitemap("tok", "https://example.com/", "https://example.com/wp-sitemap.xml", 2, 1),
    /Google said: User does not have sufficient permission/,
  );
});
