import assert from "node:assert/strict";
import test from "node:test";
import { randomToken } from "../src/shared/protocol.ts";
import {
  deleteGoogleCredential,
  finishGoogleSignIn,
  forgetGoogleTokens,
  googleAccessToken,
  googleAccount,
  GoogleError,
  loadGoogleClient,
  loadGoogleCredential,
  saveGoogleClient,
  saveGoogleCredential,
  startGoogleSignIn,
} from "../src/worker/google.ts";
import { fakeD1, migrations } from "./helpers/d1.mjs";

const NOW = Date.UTC(2026, 10, 8, 12);
const REDIRECT = "https://kontrol.example.com/api/google/callback";
const client = { client_id: "123.apps.googleusercontent.com", client_secret: "shh" };

function setup() {
  const db = fakeD1();
  for (const m of migrations) db.sqlite.exec(m.sql);
  return { DB: db, SITE_SECRETS_KEY: randomToken(32) };
}

function stubFetch(handlers) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method ?? "GET"} ${u.host}${u.pathname}`;
    calls.push({ key, init, url: u });
    const handler = handlers[key];
    if (!handler) return new Response("{}", { status: 404 });
    const [status, body] = handler(init, u);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

test("the OAuth client is stored encrypted and read back", async () => {
  const env = setup();
  assert.equal(await loadGoogleClient(env), null);
  await saveGoogleClient(env, client);
  assert.deepEqual(await loadGoogleClient(env), client);
  const raw = env.DB.sqlite.prepare("SELECT value FROM settings WHERE name = 'google_client'").get().value;
  assert.ok(!raw.includes("shh"), "the secret is not stored in the clear");
});

test("signing in asks for read-only scopes with offline access and checks the state", async () => {
  const env = setup();
  const url = new URL(await startGoogleSignIn(env, client, REDIRECT, NOW));
  assert.equal(url.host, "accounts.google.com");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("redirect_uri"), REDIRECT);
  const scopes = url.searchParams.get("scope").split(" ");
  assert.deepEqual(scopes.sort(), [
    "email",
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/webmasters.readonly",
    "openid",
  ]);
  const state = url.searchParams.get("state");

  const calls = stubFetch({
    "POST oauth2.googleapis.com/token": (init) => {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("code"), "the-code");
      assert.equal(body.get("redirect_uri"), REDIRECT);
      return [200, { access_token: "at", refresh_token: "rt" }];
    },
    "GET openidconnect.googleapis.com/v1/userinfo": (init) => {
      assert.equal(init.headers.Authorization, "Bearer at");
      return [200, { email: "owner@example.com" }];
    },
  });
  const account = await finishGoogleSignIn(env, client, REDIRECT, "the-code", state, NOW + 1000);
  assert.deepEqual(account, { kind: "oauth", email: "owner@example.com", refresh_token: "rt" });
  assert.equal(calls.length, 2);

  await saveGoogleCredential(env, account);
  assert.deepEqual(await loadGoogleCredential(env), account);
  assert.equal(googleAccount(account), "owner@example.com");
  await deleteGoogleCredential(env);
  assert.equal(await loadGoogleCredential(env), null);
});

test("a wrong, reused or expired state is refused before Google is asked", async () => {
  const env = setup();
  const calls = stubFetch({});
  const state = new URL(await startGoogleSignIn(env, client, REDIRECT, NOW)).searchParams.get("state");
  await assert.rejects(finishGoogleSignIn(env, client, REDIRECT, "c", "other", NOW), GoogleError);
  // The state is used up by the failed attempt.
  await assert.rejects(finishGoogleSignIn(env, client, REDIRECT, "c", state, NOW), /expired/);
  const late = new URL(await startGoogleSignIn(env, client, REDIRECT, NOW)).searchParams.get("state");
  await assert.rejects(finishGoogleSignIn(env, client, REDIRECT, "c", late, NOW + 11 * 60_000), /expired/);
  assert.equal(calls.length, 0);
});

test("a sign-in without a refresh token explains what to do", async () => {
  const env = setup();
  const state = new URL(await startGoogleSignIn(env, client, REDIRECT, NOW)).searchParams.get("state");
  stubFetch({ "POST oauth2.googleapis.com/token": () => [200, { access_token: "at" }] });
  await assert.rejects(finishGoogleSignIn(env, client, REDIRECT, "c", state, NOW), /third-party access/);
});

test("an OAuth connection refreshes its access token, caches it and says when access was revoked", async () => {
  forgetGoogleTokens();
  const account = { kind: "oauth", email: "owner@example.com", refresh_token: "refresh-token-value-1234" };
  const calls = stubFetch({
    "POST oauth2.googleapis.com/token": (init) => {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), account.refresh_token);
      assert.equal(body.get("client_secret"), "shh");
      return [200, { access_token: "fresh" }];
    },
  });
  assert.equal(await googleAccessToken(account, "any-scope", NOW, client), "fresh");
  assert.equal(await googleAccessToken(account, "another-scope", NOW + 1000, client), "fresh");
  assert.equal(calls.length, 1, "one token covers every scope and is reused");

  forgetGoogleTokens();
  stubFetch({ "POST oauth2.googleapis.com/token": () => [400, { error: "invalid_grant" }] });
  await assert.rejects(googleAccessToken(account, "s", NOW, client), /Connect to Google again/);
  await assert.rejects(googleAccessToken(account, "s", NOW, null), /client ID and secret are missing/);
});

test("a service account saved before Connect to Google is still loaded", async () => {
  const env = setup();
  const key = { client_email: "kontrol@proj.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----" };
  await saveGoogleCredential(env, key);
  const loaded = await loadGoogleCredential(env);
  assert.equal(googleAccount(loaded), key.client_email);
  assert.notEqual(loaded.kind, "oauth");
});
