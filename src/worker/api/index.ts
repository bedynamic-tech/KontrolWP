import { Hono, type Context } from "hono";
import { z } from "zod";
import { decodeConnectionKey, normalizeSiteUrl, REST_NAMESPACE, type ConnectionKey } from "../../shared/protocol.ts";
import type {
  BulkPluginResult,
  BulkUserResult,
  FleetPlugins,
  FleetUsers,
  Overview,
  PluginStatus,
  SiteAdmin,
  SiteDetail,
  SiteDomain,
  LinkUnlinkResult,
  SiteLinks,
  AnalyticsProvider,
  GoogleSettings,
  SiteAnalytics,
  SearchConsoleSetup,
  SiteSearchConsole,
  SiteAnalyticsDetails,
  SiteDeployments,
  SitePlugins,
  BuildLog,
  CloudflareSettings,
  CloudflareWorker,
  SiteContent,
  RedirectCode,
  SeoPages,
  SeoScore,
  SeoTools,
  SiteAccessibility,
  SiteSeoAudit,
  SitePerformance,
  SiteSeo,
  SiteSummary,
  SiteSecurity,
  SiteSitemap,
  SiteUsers,
  SyncSettings,
  UmamiSettings,
} from "../../shared/types.ts";
import {
  MAX_LLMS_TEXT,
  MAX_SCHEMA_LINKS,
  MAX_REDIRECT_IMPORT,
  MAX_ROBOTS_TEXT,
  MAX_SEO_LOCATIONS,
  REDIRECT_CODES,
  REDIRECT_DELETE_ACTIONS,
  SEO_BREADCRUMB_SEPARATORS,
  REDIRECT_MATCH_TYPES,
  SEO_SEPARATORS,
  UPDATE_FREQUENCIES,
} from "../../shared/types.ts";
import { ANALYTICS_PROVIDERS, LOGIN_LOGO_SIZES, LOGIN_URL_REDIRECTS, SNIPPET_LOCATIONS, SNIPPET_SCOPES, CONTENT_STATUSES, SEARCH_CONSOLE_RANGES, LINK_SCAN_INTERVALS, SYNC_INTERVALS } from "../../shared/types.ts";
import {
  linkScanSchedule,
  loadLinkScanSettings,
  saveLinkScanSettings,
  validTimeZone as isTimeZone,
} from "../sites/link-schedule.ts";
import { callSite, SiteRequestError, type SiteCredentials } from "../sites/client.ts";
import { base64, queueSelfUpdatesAfterDeploy, SELF_UPDATE } from "../sites/kontrolwp-connect.ts";
import {
  getCredentials,
  getSite,
  listComments,
  listDeployments,
  listFleetLinks,
  listFleetPlugins,
  listFleetUsers,
  listSites,
  listUpdates,
  setSiteName,
} from "../sites/store.ts";
import { encryptSecret, isValidSecretsKey, SecretsKeyError } from "../sites/secrets.ts";
import { lookupDomain } from "../domain.ts";
import { compareVersions, LINK_CHECK_SINCE } from "../../shared/plugin-version.ts";
import { SECURITY_FIXES } from "../../shared/security-fixes.ts";
import { deleteFeedKey, FeedKeyError, loadFeedKey, refreshFeed, saveFeedKey, setSiteFixes, siteSecurity } from "../sites/vulnerabilities.ts";
import { readSitemap } from "../sites/sitemap.ts";
import { ignoreLink, listLinks, recheckLink, setLinksExcluded, startLinkScan, unlinkLinks, UnlinkError } from "../sites/links.ts";
import { coreAutoUpdate, loadSyncSettings, syncSite } from "../sites/sync.ts";
import { enqueueUpdate } from "../sites/updates.ts";
import { inspectStaticSite, readStaticSiteName, syncStaticSite } from "../sites/static.ts";
import {
  CloudflareError,
  deleteCloudflareToken,
  fetchBuildLog,
  listWorkers,
  loadCloudflareToken,
  saveCloudflareToken,
} from "../cloudflare.ts";
import {
  deleteUmamiConfig,
  listUmamiWebsites,
  loadUmamiConfig,
  matchWebsite,
  saveUmamiConfig,
  siteAnalytics,
  siteAnalyticsDetails,
  umamiClient,
  UmamiError,
  type UmamiConfig,
} from "../umami.ts";
import { ga4Analytics, ga4Details, listGa4Properties, matchGa4Property } from "../ga4.ts";
import {
  deleteGoogleClient,
  deleteGoogleCredential,
  finishGoogleSignIn,
  forgetGoogleTokens,
  GOOGLE_SCOPES,
  googleAccessToken,
  GoogleError,
  googleAccount,
  googleCanSetUpSites,
  googleRedirectUri,
  loadGoogleClient,
  loadGoogleCredential,
  saveGoogleClient,
  saveGoogleCredential,
  startGoogleSignIn,
  type GoogleCredential,
} from "../google.ts";
import { listSearchConsoleProperties, matchSearchConsoleProperty, searchConsole } from "../search-console.ts";
import { addProperty, propertyUrl, submitSitemap, verificationCode, verifyProperty } from "../search-console-setup.ts";
import { MigrationError } from "../db/migrate.ts";
import { ensureSchema } from "../db/schema.ts";
import { requireSameOrigin } from "./csrf.ts";
import { ACCESSIBILITY_FIXES } from "../../shared/accessibility.ts";
import {
  bulkRedirects,
  deactivateMigrationSource,
  listMigrationSources,
  previewMigration,
  runMigration,
  clearNotFound,
  importRedirects,
  listNotFound,
  listRedirects,
  saveRedirect,
  setRedirectSettings,
} from "../sites/redirects.ts";
import { saveSeoContent, siteSeoContent } from "../sites/seo-content.ts";
import { saveSeoTools, siteSeoTools } from "../sites/seo-tools.ts";
import { saveSnippets, siteSnippets } from "../sites/snippets.ts";
import { saveUpdateEmails, siteUpdateEmails } from "../sites/update-emails.ts";
import { saveLoginUrl, siteLoginUrl } from "../sites/login-url.ts";
import { saveLoginLogo, siteLoginLogo } from "../sites/login-logo.ts";
import { listSeoPages, saveSeoPage, saveSeoSettings, scoreSeoPage, SeoError, siteSeo } from "../sites/seo.ts";
import { SeoAuditError, scanSeoNow, siteSeoAudit } from "../sites/seo-audit.ts";
import { AccessibilityError, scanNow, setAccessibilityFixes, siteAccessibility } from "../sites/accessibility.ts";
import { claimTest, deletePagespeedKey, savePagespeedKey, loadPagespeedKey, sitePerformance } from "../sites/performance.ts";
import {
  cleanExcluded,
  globalPolicyView,
  saveGlobalPolicy,
  saveSitePolicy,
  sitePolicyView,
} from "../sites/update-policy.ts";
import { cachedRead, clearContentCache, clearContentCacheKind } from "../content-cache.ts";
import { cachedDomain } from "../domain-cache.ts";
import { fetchIcon, isProxyableIconUrl } from "../icon-proxy.ts";

type AppContext = Context<{ Bindings: Env }>;

export const api = new Hono<{ Bindings: Env }>();
api.use("*", requireSameOrigin);

// Bring the database up to date before any route reads it, in case this
// Worker was deployed without running migrations.
api.use("*", async (c, next) => {
  try {
    await ensureSchema(c.env.DB);
  } catch (error) {
    if (!(error instanceof MigrationError)) throw error;
    console.error(error);
    return c.json({ error: error.message, code: "database_migration" }, 503);
  }
  await next();
});

// Every route needs site secrets, so show the setup screen until the key
// exists. Runs after Access, so only signed-in owners see this.
api.use("*", async (c, next) => {
  if (!isValidSecretsKey(c.env.SITE_SECRETS_KEY)) {
    return c.json({ error: "SITE_SECRETS_KEY is missing or invalid", code: "secrets_key_missing" }, 503);
  }
  await next();
});

/**
 * An icon from a site or WordPress.org, kept for a week so a slow site does
 * not slow every page that shows its icon. A missing icon is a 404, which the
 * page answers with the site's first letter.
 */
api.get("/icon", async (c) => {
  const url = isProxyableIconUrl(c.req.query("url"));
  if (!url) return c.body(null, 400);
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(`https://icons.kontrolwp.invalid/${encodeURIComponent(url.href)}`);
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return hit;
  const response = await fetchIcon(url);
  if (response.status === 200) c.executionCtx.waitUntil((cache?.put(key, response.clone()) ?? Promise.resolve()).catch(() => {}));
  return response;
});

api.get("/overview", async (c) => {
  c.executionCtx.waitUntil(
    queueSelfUpdatesAfterDeploy(c.env).catch((error) => console.error("self-update after deploy", error)),
  );
  const [sites, updates, comments, links] = await Promise.all([
    listSites(c.env.DB),
    listUpdates(c.env.DB),
    listComments(c.env.DB),
    listFleetLinks(c.env.DB),
  ]);
  return c.json<Overview>({ sites, updates, comments, links });
});

api.get("/sites", async (c) => c.json(await listSites(c.env.DB)));

/** The name a static website gives itself (its home page's site name or title), for the Add site dialog. */
api.get("/static-site-name", async (c) => {
  const url = normalizeSiteUrl(c.req.query("url") ?? "");
  return c.json({ name: url ? await readStaticSiteName(url) : "" });
});

const siteInput = z.object({
  url: z.string().trim().min(1).max(2000),
  connection_key: z.string().trim().min(1).max(1000),
});

/**
 * Check a pasted Connection Key against the site before saving anything, so a
 * typo or a missing plugin is reported right away. Returns the site's name.
 */
async function verifyConnection(url: string, key: ConnectionKey): Promise<string> {
  const status = await callSite<PluginStatus>(
    { id: 0, url, keyId: key.keyId, secret: key.secret },
    "GET",
    `${REST_NAMESPACE}/status`,
  );
  return typeof status.name === "string" ? status.name.trim().slice(0, 120) : "";
}

const staticSiteInput = z.object({
  kind: z.literal("static"),
  url: z.string().trim().min(1).max(2000),
  name: z.string().trim().max(120).optional(),
  /** Hosted on Cloudflare Workers; only then is a Worker taken. */
  cloudflare: z.boolean().optional(),
  cf_account_id: z.string().trim().max(64).optional(),
  cf_worker: z.string().trim().max(200).optional(),
});

/** Add a static website: it only has to answer, and may name the Cloudflare Worker it deploys from. */
async function addStaticSite(c: AppContext, input: z.infer<typeof staticSiteInput>) {
  const url = normalizeSiteUrl(input.url);
  if (!url) return c.json({ error: "Enter the site's public https:// address" }, 400);
  const existing = await c.env.DB.prepare("SELECT id FROM sites WHERE url = ?").bind(url).first<{ id: number }>();
  if (existing) return c.json({ error: "This site is already in KontrolWP", id: existing.id }, 409);
  const { error } = await inspectStaticSite(url);
  if (error) return c.json({ error: `KontrolWP could not open ${url}. ${error}.` }, 400);
  // A static site is named after its domain unless the owner gives it a name.
  const domain = new URL(url).hostname;
  const worker = input.cloudflare && input.cf_account_id && input.cf_worker ? input : null;
  const row = await c.env.DB.prepare(
    "INSERT INTO sites (kind, name, name_custom, default_name, url, secret, cf_hosted, cf_account_id, cf_worker) VALUES ('static', ?, ?, ?, ?, '', ?, ?, ?) RETURNING id",
  )
    .bind(
      input.name || domain,
      input.name ? 1 : 0,
      domain,
      url,
      input.cloudflare ? 1 : 0,
      worker?.cf_account_id ?? null,
      worker?.cf_worker ?? null,
    )
    .first<{ id: number }>();
  await syncStaticSite(c.env, row!.id);
  return c.json(await getSite(c.env.DB, row!.id), 201);
}

// A static site has no KontrolWP Connect, so nothing that talks to WordPress applies to it.
async function seoResponse(c: Context, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof SeoError)) throw error;
    return c.json({ error: error.message }, error.status);
  }
}

const WORDPRESS_ONLY =
  /^\/sites\/\d+\/(plugins|users|links|content|security|seo|admins|magic-login|comments|updates|updates-excluded|update-emails|login-url|login-logo|links-excluded|core-auto-update|connection-key)(\/|$)/;
api.use("/sites/:id/*", async (c, next) => {
  if (WORDPRESS_ONLY.test(new URL(c.req.url).pathname.replace(/^\/api/, ""))) {
    const row = await c.env.DB.prepare("SELECT kind FROM sites WHERE id = ?")
      .bind(Number(c.req.param("id")))
      .first<{ kind: string }>();
    if (row?.kind === "static") return c.json({ error: "This is a static site. It has no WordPress to manage." }, 400);
  }
  await next();
});

// A feature the owner turned off for a site answers nothing, whatever asks.
const FEATURE_ROUTES: [RegExp, "analytics" | "security" | "accessibility" | "performance", string][] = [
  [/^\/sites\/\d+\/analytics(\/|$)/, "analytics", "Analytics"],
  [/^\/sites\/\d+\/security(\/|$)/, "security", "Security checks"],
  [/^\/sites\/\d+\/accessibility(\/|$)/, "accessibility", "Accessibility checks"],
  [/^\/sites\/\d+\/performance(\/|$)/, "performance", "Performance checks"],
];
api.use("/sites/:id/*", async (c, next) => {
  const path = new URL(c.req.url).pathname.replace(/^\/api/, "");
  const match = FEATURE_ROUTES.find(([pattern]) => pattern.test(path));
  if (match) {
    const row = await c.env.DB.prepare(`SELECT ${match[1]}_excluded AS off FROM sites WHERE id = ?`)
      .bind(Number(c.req.param("id")))
      .first<{ off: number }>();
    if (row?.off) return c.json({ error: `${match[2]} are turned off for this site` }, 409);
  }
  await next();
});

api.post("/sites", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (body && typeof body === "object" && (body as { kind?: unknown }).kind === "static") {
    const input = staticSiteInput.safeParse(body);
    if (!input.success) return c.json({ error: "Enter the site's address" }, 400);
    return addStaticSite(c, input.data);
  }
  const parsed = siteInput.safeParse(body);
  if (!parsed.success) return c.json({ error: "Enter the site address and its Connection Key" }, 400);
  const url = normalizeSiteUrl(parsed.data.url);
  if (!url) return c.json({ error: "Enter the site's public https:// address" }, 400);
  const key = decodeConnectionKey(parsed.data.connection_key);
  if (!key) {
    return c.json(
      { error: "That is not a Connection Key. Copy it again from Settings, KontrolWP Connect on the site." },
      400,
    );
  }

  const existing = await c.env.DB.prepare("SELECT id FROM sites WHERE url = ?").bind(url).first<{ id: number }>();
  if (existing) return c.json({ error: "This site is already in KontrolWP", id: existing.id }, 409);

  // Refuse before inserting, so a missing encryption key never leaves a half-made site.
  await encryptSecret(c.env.SITE_SECRETS_KEY, 0, key.secret);
  let name: string;
  try {
    name = await verifyConnection(url, key);
  } catch (error) {
    if (error instanceof SiteRequestError) return c.json({ error: error.message }, 400);
    throw error;
  }

  const row = await c.env.DB.prepare("INSERT INTO sites (name, url, key_id, secret) VALUES (?, ?, ?, '') RETURNING id")
    .bind(name || new URL(url).hostname, url, key.keyId)
    .first<{ id: number }>();
  // The ciphertext is bound to the site id, which exists only after the insert.
  await c.env.DB.prepare("UPDATE sites SET secret = ? WHERE id = ?")
    .bind(await encryptSecret(c.env.SITE_SECRETS_KEY, row!.id, key.secret), row!.id)
    .run();
  await syncSite(c.env, row!.id);
  return c.json(await getSite(c.env.DB, row!.id), 201);
});

api.get("/sites/:id", async (c) => {
  const id = siteId(c);
  const site = id && (await getSite(c.env.DB, id));
  if (!id || !site) return c.json({ error: "Site not found" }, 404);
  const [updates, comments] = await Promise.all([listUpdates(c.env.DB, id), listComments(c.env.DB, id)]);
  return c.json<SiteDetail>({ site, updates, comments });
});

api.patch("/sites/:id", async (c) => {
  const id = siteId(c);
  const parsed = siteInput.pick({ url: true }).safeParse(await c.req.json().catch(() => null));
  if (!id || !parsed.success) return c.json({ error: "Invalid site" }, 400);
  const url = normalizeSiteUrl(parsed.data.url);
  if (!url) return c.json({ error: "Enter the site's public https:// address" }, 400);
  const result = await c.env.DB.prepare("UPDATE sites SET url = ? WHERE id = ?")
    .bind(url, id)
    .run()
    .catch(() => null);
  if (!result) return c.json({ error: "Another site already uses this URL" }, 409);
  if (!result.meta.changes) return c.json({ error: "Site not found" }, 404);
  return c.json(await getSite(c.env.DB, id));
});

/** Rename a site, or send null to go back to its default name. */
api.put("/sites/:id/name", async (c) => {
  const id = siteId(c);
  const parsed = z
    .object({ name: z.string().trim().max(120).nullable() })
    .safeParse(await c.req.json().catch(() => null));
  if (!id || !parsed.success) return c.json({ error: "Enter a name of up to 120 characters" }, 400);
  const site = await setSiteName(c.env.DB, id, parsed.data.name);
  return site ? c.json(site) : c.json({ error: "Site not found" }, 404);
});

api.delete("/sites/:id", async (c) => {
  const id = siteId(c);
  if (!id) return c.json({ error: "Site not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM site_updates WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM site_comments WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM site_plugins WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM update_jobs WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM site_deployments WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM content_cache WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM update_runs WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM accessibility_scans WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM accessibility_history WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM seo_scans WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM performance_scans WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM performance_history WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM seo_history WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});

/** Paste the site's current Connection Key, after it made a new one. */
api.post("/sites/:id/connection-key", async (c) => {
  const id = siteId(c);
  const site = id && (await getSite(c.env.DB, id));
  if (!id || !site) return c.json({ error: "Site not found" }, 404);
  const parsed = siteInput.pick({ connection_key: true }).safeParse(await c.req.json().catch(() => null));
  const key = parsed.success ? decodeConnectionKey(parsed.data.connection_key) : null;
  if (!key) {
    return c.json(
      { error: "That is not a Connection Key. Copy it again from Settings, KontrolWP Connect on the site." },
      400,
    );
  }
  try {
    await verifyConnection(site.url, key);
  } catch (error) {
    if (error instanceof SiteRequestError) return c.json({ error: error.message }, 400);
    throw error;
  }
  await c.env.DB.prepare("UPDATE sites SET key_id = ?, secret = ? WHERE id = ?")
    .bind(key.keyId, await encryptSecret(c.env.SITE_SECRETS_KEY, id, key.secret), id)
    .run();
  await syncSite(c.env, id);
  return c.json(await getSite(c.env.DB, id));
});

api.post("/sites/:id/sync", async (c) => {
  const id = siteId(c);
  if (!id) return c.json({ error: "Site not found" }, 404);
  const result = await syncSite(c.env, id, { retrySelfUpdate: true });
  return result.ok ? c.json({ ok: true }) : c.json({ error: result.error }, 502);
});

const commentAction = z.object({ action: z.enum(["approve", "spam", "trash"]) });

api.post("/sites/:id/comments/:commentId", async (c) => {
  const parsed = commentAction.safeParse(await c.req.json().catch(() => null));
  const commentId = Number(c.req.param("commentId"));
  if (!parsed.success || !Number.isSafeInteger(commentId) || commentId < 1) {
    return c.json({ error: "Invalid comment action" }, 400);
  }
  return siteAction(c, async (site) => {
    await callSite(site, "POST", `${REST_NAMESPACE}/comments/moderate`, { id: commentId, action: parsed.data.action });
    await c.env.DB.prepare(
      `UPDATE sites SET pending_comments = MAX(0, pending_comments - 1)
         WHERE id = ? AND EXISTS (SELECT 1 FROM site_comments WHERE site_id = ? AND comment_id = ?)`,
    )
      .bind(site.id, site.id, commentId)
      .run();
    await c.env.DB.prepare("DELETE FROM site_comments WHERE site_id = ? AND comment_id = ?")
      .bind(site.id, commentId)
      .run();
  });
});

const updateAction = z.object({
  kind: z.enum(["core", "plugin", "theme"]),
  slug: z.string().min(1).max(300),
  // Core only: the version the owner saw, so the site refuses anything newer.
  version: z.string().max(40).optional(),
});

/** Queue an update. The queue consumer runs one at a time per site (sites/updates.ts). */
api.post("/sites/:id/updates", async (c) => {
  const id = siteId(c);
  const parsed = updateAction.safeParse(await c.req.json().catch(() => null));
  if (!id || !parsed.success) return c.json({ error: "Invalid update" }, 400);
  const site = await getSite(c.env.DB, id);
  if (!site) return c.json({ error: "Site not found" }, 404);
  if (site.updates_excluded) return c.json({ error: "This site is excluded from update checks" }, 409);
  await enqueueUpdate(c.env, id, parsed.data);
  return c.json({ ok: true }, 202);
});

/** An older KontrolWP Connect has no Magic Login routes; it updates itself on the next sync. */
function magicLoginError(error: SiteRequestError): string {
  return error.status === 404 && !error.code
    ? "KontrolWP Connect on this site is too old for Magic Login. It updates automatically; select Sync now to check."
    : error.message;
}

async function fetchAdmins(site: NonNullable<Awaited<ReturnType<typeof getCredentials>>>): Promise<SiteAdmin[]> {
  const { admins } = await callSite<{ admins: SiteAdmin[] }>(site, "GET", `${REST_NAMESPACE}/admins`);
  return Array.isArray(admins) ? admins : [];
}

/** The site's administrators, to choose who Magic Login signs in as. */
api.get("/sites/:id/admins", async (c) => {
  const id = siteId(c);
  const site = id && (await getCredentials(c.env, id));
  if (!site) return c.json({ error: "Site not found" }, 404);
  try {
    return c.json({
      admins: await cachedRead(c.env.DB, site.id, "admins", "list", () => fetchAdmins(site)),
    });
  } catch (error) {
    if (error instanceof SiteRequestError) return c.json({ error: magicLoginError(error) }, 502);
    throw error;
  }
});

const magicLoginUser = z.object({ user_id: z.number().int().positive().nullable() });

/** Choose the administrator Magic Login signs in as, or turn it off with null. */
api.put("/sites/:id/magic-login", async (c) => {
  const id = siteId(c);
  const parsed = magicLoginUser.safeParse(await c.req.json().catch(() => null));
  if (!id || !parsed.success) return c.json({ error: "Invalid user" }, 400);
  if (!(await getSite(c.env.DB, id))) return c.json({ error: "Site not found" }, 404);
  let name: string | null = null;
  if (parsed.data.user_id !== null) {
    let admins: SiteAdmin[];
    try {
      admins = await fetchAdmins((await getCredentials(c.env, id))!);
    } catch (error) {
      if (error instanceof SiteRequestError) return c.json({ error: magicLoginError(error) }, 502);
      throw error;
    }
    const admin = admins.find((user) => user.id === parsed.data.user_id);
    if (!admin) return c.json({ error: "That user is not an administrator on the site" }, 400);
    name = String(admin.display_name || admin.login).slice(0, 120);
  }
  await c.env.DB.prepare("UPDATE sites SET login_user_id = ?, login_user_name = ? WHERE id = ?")
    .bind(parsed.data.user_id, name, id)
    .run();
  return c.json(await getSite(c.env.DB, id));
});

const magicLoginTarget = z.object({ post_id: z.number().int().positive().optional() }).catch({});

/**
 * Ask the site for a one-time link that signs the browser in as the chosen
 * administrator. With post_id, the link opens that post's editor.
 */
api.post("/sites/:id/magic-login", async (c) => {
  const id = siteId(c);
  const target = magicLoginTarget.parse(await c.req.json().catch(() => ({})));
  const summary = id && (await getSite(c.env.DB, id));
  if (!id || !summary) return c.json({ error: "Site not found" }, 404);
  if (!summary.login_user_id) return c.json({ error: "Choose an administrator for Magic Login first" }, 400);
  const site = (await getCredentials(c.env, id))!;
  let url: URL | null = null;
  try {
    const result = await callSite<{ url?: unknown }>(site, "POST", `${REST_NAMESPACE}/login`, {
      user_id: summary.login_user_id,
      ...(target.post_id ? { post_id: target.post_id } : {}),
    });
    url = typeof result.url === "string" && URL.canParse(result.url) ? new URL(result.url) : null;
  } catch (error) {
    if (error instanceof SiteRequestError) return c.json({ error: magicLoginError(error) }, 502);
    throw error;
  }
  // The browser opens this link, so never hand on anything but a web address.
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    return c.json({ error: "The site returned an invalid login link" }, 502);
  }
  c.header("Cache-Control", "no-store");
  return c.json({ url: url.href });
});

const updatesExcluded = z.object({ excluded: z.boolean() });

/**
 * Exclude a site from update checks, or include it again. Excluding drops
 * its listed updates and anything still waiting in its queue, except
 * KontrolWP Connect's own update; including it checks right away.
 */
api.put("/sites/:id/updates-excluded", async (c) => {
  const id = siteId(c);
  const parsed = updatesExcluded.safeParse(await c.req.json().catch(() => null));
  if (!id || !parsed.success) return c.json({ error: "Invalid setting" }, 400);
  if (!(await getSite(c.env.DB, id))) return c.json({ error: "Site not found" }, 404);
  const { excluded } = parsed.data;
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE sites SET updates_excluded = ? WHERE id = ?").bind(excluded ? 1 : 0, id),
    ...(excluded
      ? [
          c.env.DB.prepare("DELETE FROM site_updates WHERE site_id = ?").bind(id),
          // KontrolWP Connect's own update is not one the owner excludes.
          c.env.DB.prepare("DELETE FROM update_jobs WHERE site_id = ? AND status != 'running' AND slug != ?").bind(
            id,
            SELF_UPDATE.slug,
          ),
        ]
      : []),
  ]);
  if (!excluded) await syncSite(c.env, id);
  return c.json(await getSite(c.env.DB, id));
});

/** Exclude a site from broken link detection, or include it again; excluding clears what it found. */
api.put("/sites/:id/links-excluded", async (c) => {
  const id = siteId(c);
  const parsed = updatesExcluded.safeParse(await c.req.json().catch(() => null));
  if (!id || !parsed.success) return c.json({ error: "Invalid setting" }, 400);
  if (!(await getSite(c.env.DB, id))) return c.json({ error: "Site not found" }, 404);
  await setLinksExcluded(c.env.DB, id, parsed.data.excluded);
  return c.json(await getSite(c.env.DB, id));
});

const featureExcluded = z.object({ feature: z.enum(["analytics", "security", "accessibility", "performance"]), excluded: z.boolean() });

/** Turn analytics, security, accessibility or performance checks off for one site, or on again. Results already stored are kept. */
api.put("/sites/:id/feature-excluded", async (c) => {
  const id = siteId(c);
  const parsed = featureExcluded.safeParse(await c.req.json().catch(() => null));
  if (!id || !parsed.success) return c.json({ error: "Invalid setting" }, 400);
  if (!(await getSite(c.env.DB, id))) return c.json({ error: "Site not found" }, 404);
  // The column name comes from the enum above, never from the request text.
  await c.env.DB.prepare(`UPDATE sites SET ${parsed.data.feature}_excluded = ? WHERE id = ?`)
    .bind(parsed.data.excluded ? 1 : 0, id)
    .run();
  return c.json(await getSite(c.env.DB, id));
});

/** An older KontrolWP Connect has no plugin routes; it updates itself on the next sync. */
function pluginsError(error: SiteRequestError): string {
  if (error.status === 404 && !error.code) {
    return "KontrolWP Connect on this site is too old to manage plugins. It updates automatically; select Sync now to check.";
  }
  // An older KontrolWP Connect rejects actions it does not know, such as auto-updates before 0.7.0.
  if (error.status === 400 && error.code === "rest_invalid_param") {
    return "KontrolWP Connect on this site is too old for this. It updates automatically; select Sync now to check.";
  }
  return error.message;
}

/** Run a plugin request against the site, then re-sync it in the background so its updates stay current. */
async function pluginRequest(c: AppContext, request: (site: SiteCredentials) => Promise<unknown>) {
  const id = siteId(c);
  const site = id && (await getCredentials(c.env, id));
  if (!id || !site) return c.json({ error: "Site not found" }, 404);
  let result: unknown;
  try {
    result = await request(site);
  } catch (error) {
    if (error instanceof SiteRequestError) return c.json({ error: pluginsError(error) }, 502);
    throw error;
  }
  return c.json(result ?? { ok: true });
}

api.get("/sites/:id/plugins", (c) =>
  pluginRequest(c, (site) =>
    cachedRead(c.env.DB, site.id, "plugins", "list", () =>
      callSite<SitePlugins>(site, "GET", `${REST_NAMESPACE}/plugins`),
    ),
  ),
);

const pluginAction = z.object({
  plugin: z.string().min(1).max(300),
  action: z.enum(["activate", "deactivate", "delete", "enable-auto-update", "disable-auto-update"]),
});

api.post("/sites/:id/plugins", async (c) => {
  const parsed = pluginAction.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid plugin action" }, 400);
  return pluginRequest(c, async (site) => {
    await callSite(site, "POST", `${REST_NAMESPACE}/plugins/manage`, parsed.data);
    // The list refetches as soon as this answers, before the sync finishes.
    await clearContentCache(c.env.DB, site.id);
    c.executionCtx.waitUntil(syncSite(c.env, site.id).catch(() => undefined));
    return { ok: true };
  });
});

const pluginInstall = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("wordpress.org"),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{1,200}$/),
    activate: z.boolean(),
  }),
  z.object({
    source: z.literal("url"),
    url: z
      .string()
      .trim()
      .url()
      .max(2000)
      .regex(/^https?:\/\//),
    activate: z.boolean(),
  }),
]);

/**
 * The zip travels base64 in a signed JSON body, held in memory several times
 * over; the Worker has 128 MB, so larger zips go in by link instead.
 */
const MAX_PLUGIN_ZIP_BYTES = 10 * 1024 * 1024;

type InstallRequest = { payload: Record<string, unknown>; siteIds: number[] } | { error: string; status: 400 | 413 };

/**
 * Read an install request: a WordPress.org slug or a link as JSON, or an
 * uploaded zip as a multipart form with a "file" field. The fleet route
 * also names the sites, as site_ids.
 */
async function readInstallRequest(c: AppContext): Promise<InstallRequest> {
  if ((c.req.header("Content-Type") ?? "").startsWith("multipart/form-data")) {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) return { error: "Choose a plugin zip to upload", status: 400 };
    if (file.size > MAX_PLUGIN_ZIP_BYTES) {
      return { error: "The zip is larger than 10 MB. Install it from a link instead.", status: 413 };
    }
    return {
      payload: {
        source: "zip",
        package: base64(new Uint8Array(await file.arrayBuffer())),
        activate: form.activate === "true",
      },
      siteIds: siteIdList(String(form.site_ids ?? "").split(",")),
    };
  }
  const body = await c.req.json().catch(() => null);
  const parsed = pluginInstall.safeParse(body);
  if (!parsed.success) return { error: "Enter a WordPress.org slug or an http(s) link to a zip", status: 400 };
  return { payload: parsed.data, siteIds: siteIdList((body as { site_ids?: unknown }).site_ids) };
}

function siteIdList(value: unknown): number[] {
  const ids = (Array.isArray(value) ? value : []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
  return [...new Set(ids)].slice(0, 500);
}

/** Install a plugin on one site. */
api.post("/sites/:id/plugins/install", async (c) => {
  const request = await readInstallRequest(c);
  if ("error" in request) return c.json({ error: request.error }, request.status);
  return pluginRequest(c, async (site) => {
    const result = await callSite(site, "POST", `${REST_NAMESPACE}/plugins/install`, request.payload);
    await clearContentCache(c.env.DB, site.id);
    c.executionCtx.waitUntil(syncSite(c.env, site.id).catch(() => undefined));
    return result;
  });
});

/** Every site's installed plugins, as last synced, for the Plugins page. */
api.get("/plugins", async (c) => c.json<FleetPlugins>(await listFleetPlugins(c.env.DB)));

const bulkPluginAction = pluginAction.extend({ site_ids: z.array(z.number().int().positive()).min(1).max(500) });

/** Activate, deactivate or delete one plugin on several sites. */
api.post("/plugins/bulk", async (c) => {
  const parsed = bulkPluginAction.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid plugin action" }, 400);
  const { plugin, action, site_ids } = parsed.data;
  return c.json({
    results: await forEachSite(c.env, site_ids, (site) =>
      callSite(site, "POST", `${REST_NAMESPACE}/plugins/manage`, { plugin, action }),
    ),
  });
});

/** Install one plugin on several sites. */
api.post("/plugins/install", async (c) => {
  const request = await readInstallRequest(c);
  if ("error" in request) return c.json({ error: request.error }, request.status);
  if (!request.siteIds.length) return c.json({ error: "Choose at least one site" }, 400);
  return c.json({
    results: await forEachSite(c.env, request.siteIds, (site) =>
      callSite(site, "POST", `${REST_NAMESPACE}/plugins/install`, request.payload),
    ),
  });
});

/** An older KontrolWP Connect has no user routes; it updates itself on the next sync. */
function usersError(error: SiteRequestError): string {
  if (error.status === 404 && !error.code) {
    return "KontrolWP Connect on this site is too old to manage users. It updates automatically; select Sync now to check.";
  }
  return error.message;
}

/** A user change KontrolWP refuses before asking the site. */
class UserActionError extends Error {}

/** Run a user request against the site, with errors phrased for users. */
async function userRequest(c: AppContext, request: (site: SiteCredentials) => Promise<unknown>) {
  const id = siteId(c);
  const site = id && (await getCredentials(c.env, id));
  if (!id || !site) return c.json({ error: "Site not found" }, 404);
  try {
    return c.json((await request(site)) ?? { ok: true });
  } catch (error) {
    if (error instanceof SiteRequestError) return c.json({ error: usersError(error) }, 502);
    if (error instanceof UserActionError) return c.json({ error: error.message }, 409);
    throw error;
  }
}

const newUser = z.object({
  login: z.string().trim().min(1).max(60),
  email: z.string().trim().email().max(100),
  role: z.string().trim().min(1).max(100),
  first_name: z.string().trim().max(100).optional(),
  last_name: z.string().trim().max(100).optional(),
  password: z.string().max(200).optional(),
  notify: z.boolean(),
});

const userAction = z
  .object({
    user_id: z.number().int().positive(),
    action: z.enum(["set-role", "reset-password", "delete"]),
    role: z.string().trim().min(1).max(100).optional(),
  })
  .refine((value) => value.action !== "set-role" || !!value.role, { message: "Choose a role" });

type UserActionInput = z.infer<typeof userAction>;

/**
 * Change one user. Magic Login's administrator keeps their account and
 * role, so Magic Login keeps working; choose another one first.
 */
async function manageUser(env: Env, site: SiteCredentials, input: UserActionInput): Promise<void> {
  const removesAdmin = input.action === "delete" || (input.action === "set-role" && input.role !== "administrator");
  if (removesAdmin) {
    const row = await env.DB.prepare("SELECT login_user_id FROM sites WHERE id = ?")
      .bind(site.id)
      .first<{ login_user_id: number | null }>();
    if (row?.login_user_id === input.user_id) {
      throw new UserActionError(
        "This is the administrator Magic Login signs in as. Choose another one in Site settings first.",
      );
    }
  }
  await callSite(site, "POST", `${REST_NAMESPACE}/users/manage`, input);
}

/** A site's users and roles, straight from the site. */
/** The site's domain: DNS records and registration, from public sources. */
api.get("/sites/:id/domain", async (c) => {
  const id = siteId(c);
  const site = id && (await getSite(c.env.DB, id));
  if (!id || !site) return c.json({ error: "Site not found" }, 404);
  return c.json<SiteDomain>(await cachedDomain(c.env.DB, id, site.url, c.req.query("refresh") === "1"));
});

/** The link checker's latest scan and the links that need a look. */
api.get("/sites/:id/links", async (c) => {
  const id = siteId(c);
  if (!id || !(await getSite(c.env.DB, id))) return c.json({ error: "Site not found" }, 404);
  return c.json<SiteLinks>(await listLinks(c.env.DB, id));
});

/** Scan the site's published content for broken links, replacing any running scan. */
api.post("/sites/:id/links/scan", async (c) => {
  const id = siteId(c);
  const site = id && (await getSite(c.env.DB, id));
  if (!id || !site) return c.json({ error: "Site not found" }, 404);
  if (site.links_excluded) return c.json({ error: "This site is excluded from broken link detection" }, 409);
  if (!site.plugin_version || compareVersions(site.plugin_version, LINK_CHECK_SINCE) < 0) {
    return c.json(
      {
        error: `Checking links needs KontrolWP Connect ${LINK_CHECK_SINCE} or later. It updates automatically; select Sync now to check.`,
      },
      400,
    );
  }
  await startLinkScan(c.env, id);
  return c.json<SiteLinks>(await listLinks(c.env.DB, id), 202);
});

const linkTarget = z.object({ url: z.string().min(1).max(2048) });

/** Check one link again, after fixing it. */
api.post("/sites/:id/links/recheck", async (c) => {
  const id = siteId(c);
  const parsed = linkTarget.safeParse(await c.req.json().catch(() => null));
  if (!id || !parsed.success) return c.json({ error: "Invalid link" }, 400);
  if (!(await recheckLink(c.env, id, parsed.data.url))) return c.json({ error: "Link not found" }, 404);
  return c.json<SiteLinks>(await listLinks(c.env.DB, id));
});

const linkUnlink = z.object({ urls: z.array(z.string().min(1).max(2048)).min(1).max(1000) });

/** Take links to these addresses out of the site's posts, keeping the link text. */
api.post("/sites/:id/links/unlink", async (c) => {
  const id = siteId(c);
  const parsed = linkUnlink.safeParse(await c.req.json().catch(() => null));
  if (!id || !parsed.success) return c.json({ error: "Invalid links" }, 400);
  if (!(await getSite(c.env.DB, id))) return c.json({ error: "Site not found" }, 404);
  let result: LinkUnlinkResult;
  try {
    result = await unlinkLinks(c.env, id, [...new Set(parsed.data.urls)]);
  } catch (error) {
    if (error instanceof UnlinkError) return c.json({ error: error.message }, 400);
    if (error instanceof SiteRequestError) return c.json({ error: error.message }, 502);
    throw error;
  }
  return c.json<{ result: LinkUnlinkResult; links: SiteLinks }>({ result, links: await listLinks(c.env.DB, id) });
});

const linkIgnore = linkTarget.extend({ ignored: z.boolean() });

/** Mark a link as fine (or not), so it leaves the problem list. */
api.post("/sites/:id/links/ignore", async (c) => {
  const id = siteId(c);
  const parsed = linkIgnore.safeParse(await c.req.json().catch(() => null));
  if (!id || !parsed.success) return c.json({ error: "Invalid link" }, 400);
  if (!(await ignoreLink(c.env.DB, id, parsed.data.url, parsed.data.ignored)))
    return c.json({ error: "Link not found" }, 404);
  return c.json<SiteLinks>(await listLinks(c.env.DB, id));
});

/** A static site's pages, read live from its sitemap. */
api.get("/sites/:id/pages", async (c) => {
  const id = siteId(c);
  const site = id && (await getSite(c.env.DB, id));
  if (!id || !site) return c.json({ error: "Site not found" }, 404);
  if (site.kind !== "static") return c.json({ error: "Only static sites list their pages from a sitemap." }, 400);
  return c.json<SiteSitemap>(await cachedRead(c.env.DB, id, "pages", site.url, () => readSitemap(site.url)));
});

const PAGE_SIZE = 25;

const contentQuery = z.object({
  type: z
    .string()
    .regex(/^[a-z0-9_-]{1,20}$/)
    .default("all"),
  status: z.enum(["all", ...CONTENT_STATUSES]).default("all"),
  search: z.string().trim().max(200).default(""),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

/** One page of the site's posts and pages, filtered, straight from the site. */
api.get("/sites/:id/content", async (c) => {
  const id = siteId(c);
  const site = id && (await getCredentials(c.env, id));
  if (!id || !site) return c.json({ error: "Site not found" }, 404);
  const parsed = contentQuery.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "Invalid filter" }, 400);
  try {
    return c.json<SiteContent>(
      await cachedRead(c.env.DB, id, "content", JSON.stringify(parsed.data), () =>
        callSite<SiteContent>(site, "POST", `${REST_NAMESPACE}/content`, { ...parsed.data, per_page: PAGE_SIZE }),
      ),
    );
  } catch (error) {
    if (!(error instanceof SiteRequestError)) throw error;
    return c.json(
      {
        error:
          error.status === 404 && !error.code
            ? "KontrolWP Connect on this site is too old to list posts and pages. It updates automatically; select Sync now to check."
            : error.message,
      },
      502,
    );
  }
});

/** The site's accessibility score, issues and fixes. Static sites are scanned too, without fixes. */
api.get("/sites/:id/accessibility", async (c) => {
  const id = siteId(c);
  const [site, credentials] = id ? await Promise.all([getSite(c.env.DB, id), getCredentials(c.env, id)]) : [null, null];
  if (!site) return c.json({ error: "Site not found" }, 404);
  return c.json<SiteAccessibility>(await siteAccessibility(c.env, site, credentials));
});

/** Scan the site now. */
api.post("/sites/:id/accessibility/scan", async (c) => {
  const id = siteId(c);
  const site = id && (await getSite(c.env.DB, id));
  if (!id || !site) return c.json({ error: "Site not found" }, 404);
  try {
    await scanNow(c.env, site);
  } catch (error) {
    if (!(error instanceof AccessibilityError)) throw error;
    return c.json({ error: error.message }, 502);
  }
  return c.json<SiteAccessibility>(await siteAccessibility(c.env, site, await getCredentials(c.env, id)));
});

/** The site's PageSpeed Insights (Lighthouse) tests, as a phone and as a desktop. */
api.get("/sites/:id/performance", async (c) => {
  const id = siteId(c);
  const site = id && (await getSite(c.env.DB, id));
  if (!id || !site) return c.json({ error: "Site not found" }, 404);
  return c.json<SitePerformance>(await sitePerformance(c.env, site));
});

/** Start a test now. It takes a minute or so, so it runs from the queue and the page checks back. */
api.post("/sites/:id/performance/run", async (c) => {
  const id = siteId(c);
  const site = id && (await getSite(c.env.DB, id));
  if (!id || !site) return c.json({ error: "Site not found" }, 404);
  if (await claimTest(c.env, id)) await c.env.SYNC_QUEUE.send({ type: "performance", siteId: id });
  return c.json<SitePerformance>(await sitePerformance(c.env, site));
});

api.get("/settings/pagespeed", async (c) => {
  try {
    return c.json({ configured: Boolean(await loadPagespeedKey(c.env)) });
  } catch (error) {
    if (error instanceof SecretsKeyError) return c.json({ error: error.message }, 500);
    throw error;
  }
});

/** Save the Google API key used for PageSpeed Insights tests. */
api.put("/settings/pagespeed", async (c) => {
  const parsed = z.object({ key: z.string().trim().min(8).max(500) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Enter your Google API key" }, 400);
  try {
    await savePagespeedKey(c.env, parsed.data.key);
    return c.json({ configured: true });
  } catch (error) {
    if (error instanceof SecretsKeyError) return c.json({ error: error.message }, 500);
    throw error;
  }
});

api.delete("/settings/pagespeed", async (c) => {
  await deletePagespeedKey(c.env);
  return c.json({ configured: false });
});

/** A static site's SEO health check: the latest result and its history. */
api.get("/sites/:id/seo-audit", async (c) => {
  const id = siteId(c);
  const site = id && (await getSite(c.env.DB, id));
  if (!id || !site) return c.json({ error: "Site not found" }, 404);
  if (site.kind !== "static") return c.json({ error: "Only static sites have the SEO health check." }, 400);
  return c.json<SiteSeoAudit>(await siteSeoAudit(c.env, site));
});

/** Run the SEO health check now. */
api.post("/sites/:id/seo-audit/scan", async (c) => {
  const id = siteId(c);
  const site = id && (await getSite(c.env.DB, id));
  if (!id || !site) return c.json({ error: "Site not found" }, 404);
  if (site.kind !== "static") return c.json({ error: "Only static sites have the SEO health check." }, 400);
  try {
    await scanSeoNow(c.env, site);
  } catch (error) {
    if (!(error instanceof SeoAuditError)) throw error;
    return c.json({ error: error.message }, 502);
  }
  return c.json<SiteSeoAudit>(await siteSeoAudit(c.env, site));
});

const accessibilityFixesBody = z.object({
  ids: z
    .array(z.enum(ACCESSIBILITY_FIXES.map((fix) => fix.id) as [string, ...string[]]))
    .min(1)
    .max(ACCESSIBILITY_FIXES.length),
  enabled: z.boolean(),
});

/** Switch accessibility fixes on or off on one WordPress site, then scan again to show the effect. */
api.put("/sites/:id/accessibility/fixes", async (c) => {
  const id = siteId(c);
  const [site, credentials] = id ? await Promise.all([getSite(c.env.DB, id), getCredentials(c.env, id)]) : [null, null];
  if (!id || !site || !credentials) return c.json({ error: "Site not found" }, 404);
  if (site.kind === "static") return c.json({ error: "Fixes need a WordPress site with KontrolWP Connect." }, 400);
  const parsed = accessibilityFixesBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Choose the fixes to change" }, 400);
  try {
    await setAccessibilityFixes(credentials, parsed.data.ids, parsed.data.enabled);
  } catch (error) {
    if (!(error instanceof SiteRequestError)) throw error;
    return c.json(
      {
        error:
          error.status === 404 && !error.code
            ? "KontrolWP Connect on this site is too old to apply accessibility fixes. It updates automatically; select Sync now to check."
            : error.message,
      },
      502,
    );
  }
  await clearContentCache(c.env.DB, id);
  // Page caches may keep serving the old HTML for a while, so the scan can still show the problem.
  await scanNow(c.env, site, { force: true }).catch(() => undefined);
  return c.json<SiteAccessibility>(await siteAccessibility(c.env, site, credentials));
});

/** The site's SEO settings, and whether another SEO plugin is in the way. */
api.get("/sites/:id/seo", async (c) => {
  const id = siteId(c);
  const [site, credentials] = id ? await Promise.all([getSite(c.env.DB, id), getCredentials(c.env, id)]) : [null, null];
  if (!site) return c.json({ error: "Site not found" }, 404);
  return seoResponse(c, async () => c.json<SiteSeo>(await siteSeo(c.env, site, credentials)));
});

const seoText = (max: number) => z.string().max(max);
const seoLocationBody = z.object({
  id: seoText(16),
  page_id: z.number().int().min(0),
  type: seoText(60),
  name: seoText(200),
  phone: seoText(200),
  email: seoText(200),
  logo: seoText(2000),
  image: seoText(2000),
  street: seoText(200),
  city: seoText(200),
  region: seoText(200),
  postal: seoText(200),
  country: seoText(200),
  latitude: seoText(30),
  longitude: seoText(30),
  price_range: seoText(200),
  hours: z.record(z.string(), z.object({ open: seoText(5), close: seoText(5) })),
  same_as: z.array(seoText(2000)).max(20),
});
const seoLocalBody = z.object({ enabled: z.boolean(), locations: z.array(seoLocationBody).max(MAX_SEO_LOCATIONS) });
const seoSettingsBody = z.object({
  local: seoLocalBody,
  enabled: z.boolean(),
  separator: z.enum(SEO_SEPARATORS),
  title_template: seoText(200),
  home_title: seoText(200),
  home_description: seoText(320),
  og_enabled: z.boolean(),
  og_image: seoText(2000),
  twitter_card: z.enum(["summary", "summary_large_image"]),
  twitter_site: seoText(40),
  noindex_search: z.boolean(),
  noindex_author: z.boolean(),
  noindex_date: z.boolean(),
  noindex_attachment: z.boolean(),
  noindex_author_single: z.boolean(),
  hidden_taxonomies: z.array(z.string().max(32)).max(50),
  hidden_types: z.array(z.string().max(32)).max(50),
  canonical: z.boolean(),
  sitemap: z.boolean(),
  strip_category_base: z.boolean(),
  author_archives: z.enum(["keep", "redirect", "404"]),
  type_templates: z.record(z.string().max(32), z.object({ title: seoText(200), description: seoText(320) })),
});

api.put("/sites/:id/seo", async (c) => {
  const id = siteId(c);
  const [site, credentials] = id ? await Promise.all([getSite(c.env.DB, id), getCredentials(c.env, id)]) : [null, null];
  if (!site) return c.json({ error: "Site not found" }, 404);
  const parsed = seoSettingsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid SEO settings" }, 400);
  return seoResponse(c, async () => c.json<SiteSeo>(await saveSeoSettings(c.env, site, credentials, parsed.data)));
});

const seoPagesBody = z.object({ page: z.number().int().min(1).max(10000).catch(1), search: z.string().max(100).catch("") });

/** Published pages and posts with their SEO overrides. POST so the search text stays out of the URL. */
api.post("/sites/:id/seo/pages", async (c) => {
  const id = siteId(c);
  const [site, credentials] = id ? await Promise.all([getSite(c.env.DB, id), getCredentials(c.env, id)]) : [null, null];
  if (!site) return c.json({ error: "Site not found" }, 404);
  const { page, search } = seoPagesBody.parse((await c.req.json().catch(() => null)) ?? {});
  return seoResponse(c, async () => c.json<SeoPages>(await listSeoPages(c.env, site, credentials, page, search.trim())));
});

const seoPageBody = z.object({
  seo_title: seoText(200).optional(),
  description: seoText(320).optional(),
  noindex: z.boolean().optional(),
  image: seoText(2000).optional(),
  keyword: seoText(80).optional(),
});

api.put("/sites/:id/seo/pages/:pageId", async (c) => {
  const id = siteId(c);
  const pageId = Number(c.req.param("pageId"));
  const [site, credentials] = id ? await Promise.all([getSite(c.env.DB, id), getCredentials(c.env, id)]) : [null, null];
  if (!site || !Number.isInteger(pageId) || pageId < 1) return c.json({ error: "Site not found" }, 404);
  const parsed = seoPageBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid SEO settings" }, 400);
  return seoResponse(c, async () => {
    await saveSeoPage(c.env, site, credentials, pageId, parsed.data);
    return c.json({ ok: true });
  });
});

const seoScoreBody = z.object({
  seo_title: seoText(200).optional(),
  description: seoText(320).optional(),
  keyword: seoText(80).optional(),
});

/** The content checklist for one page, using the unsaved title, description and keyword when sent. */
api.post("/sites/:id/seo/pages/:pageId/score", async (c) => {
  const id = siteId(c);
  const pageId = Number(c.req.param("pageId"));
  const [site, credentials] = id ? await Promise.all([getSite(c.env.DB, id), getCredentials(c.env, id)]) : [null, null];
  if (!site || !Number.isInteger(pageId) || pageId < 1) return c.json({ error: "Site not found" }, 404);
  const parsed = seoScoreBody.safeParse((await c.req.json().catch(() => null)) ?? {});
  if (!parsed.success) return c.json({ error: "Invalid SEO settings" }, 400);
  return seoResponse(c, async () => c.json<SeoScore>(await scoreSeoPage(site, credentials, pageId, parsed.data)));
});

/** Verification codes, robots.txt, llms.txt and IndexNow for one site. */
api.get("/sites/:id/seo/tools", async (c) =>
  redirectsCall(c, (site, credentials) => siteSeoTools(c.env, site, credentials) as Promise<SeoTools>),
);

/** Code snippets for one site. */
api.get("/sites/:id/snippets", async (c) => redirectsCall(c, (site, credentials) => siteSnippets(c.env, site, credentials)));

const snippetsBody = z.object({
  skip_editors: z.boolean(),
  snippets: z
    .array(
      z.object({
        id: z.string().max(40),
        name: z.string().max(200),
        code: z.string().max(100_000),
        location: z.enum(SNIPPET_LOCATIONS),
        enabled: z.boolean(),
        scope: z.enum(SNIPPET_SCOPES),
        paths: z.array(z.string().max(400)).max(100),
      }),
    )
    .max(200),
});

api.put("/sites/:id/snippets", async (c) => {
  const parsed = snippetsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid snippets" }, 400);
  return redirectsCall(c, (site, credentials) => saveSnippets(c.env, site, credentials, parsed.data));
});

/** Whether a site's update emails are switched off. */
api.get("/sites/:id/update-emails", async (c) => redirectsCall(c, (site, credentials) => siteUpdateEmails(site, credentials)));

api.put("/sites/:id/update-emails", async (c) => {
  const parsed = z.object({ disabled: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid setting" }, 400);
  return redirectsCall(c, (site, credentials) => saveUpdateEmails(site, credentials, parsed.data.disabled));
});

/** A site's custom login address. */
api.get("/sites/:id/login-url", async (c) => redirectsCall(c, (site, credentials) => siteLoginUrl(site, credentials)));

api.put("/sites/:id/login-url", async (c) => {
  const parsed = z
    .object({ enabled: z.boolean(), slug: z.string().max(200), redirect: z.enum(LOGIN_URL_REDIRECTS) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid login address" }, 400);
  return redirectsCall(c, (site, credentials) => saveLoginUrl(site, credentials, parsed.data));
});

/** The logo above a site's login form. */
api.get("/sites/:id/login-logo", async (c) => redirectsCall(c, (site, credentials) => siteLoginLogo(site, credentials)));

/** A 1 MB image as base64 is about 1.4 million characters; the site checks the bytes themselves. */
const MAX_LOGIN_LOGO_BASE64 = 1_400_000;

api.put("/sites/:id/login-logo", async (c) => {
  const parsed = z
    .object({
      enabled: z.boolean(),
      size: z.enum(LOGIN_LOGO_SIZES),
      image: z.string().max(MAX_LOGIN_LOGO_BASE64).regex(/^[A-Za-z0-9+/]*={0,2}$/).optional(),
      remove: z.boolean().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    const tooLarge = parsed.error.issues.some((issue) => issue.code === "too_big");
    return c.json({ error: tooLarge ? "The logo can be up to 1 MB." : "Invalid logo" }, 400);
  }
  return redirectsCall(c, (site, credentials) => saveLoginLogo(site, credentials, parsed.data));
});

/** Schema, breadcrumbs, link rules, image alt text and the feed footer for one site. */
api.get("/sites/:id/seo/content", async (c) => redirectsCall(c, (site, credentials) => siteSeoContent(c.env, site, credentials)));

const seoContentBody = z.object({
  schema: z.boolean(),
  schema_type: z.enum(["organization", "person"]),
  schema_name: z.string().max(200),
  schema_logo: z.string().max(2000),
  schema_same_as: z.array(z.string().max(2000)).max(MAX_SCHEMA_LINKS),
  article_schema: z.boolean(),
  breadcrumbs: z.boolean(),
  breadcrumb_home: z.string().max(60),
  breadcrumb_sep: z.enum(SEO_BREADCRUMB_SEPARATORS),
  external_new_tab: z.boolean(),
  external_nofollow: z.boolean(),
  image_alt: z.boolean(),
  image_title: z.boolean().default(false),
  feed_footer: z.string().max(500),
});

api.put("/sites/:id/seo/content", async (c) => {
  const parsed = seoContentBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid settings" }, 400);
  return redirectsCall(c, (site, credentials) => saveSeoContent(c.env, site, credentials, parsed.data));
});

const seoToolsBody = z.object({
  verify: z.object({
    google: z.string().max(400),
    bing: z.string().max(400),
    yandex: z.string().max(400),
    baidu: z.string().max(400),
    pinterest: z.string().max(400),
  }),
  robots_mode: z.enum(["default", "custom"]),
  robots_text: z.string().max(MAX_ROBOTS_TEXT),
  llms_mode: z.enum(["off", "auto", "custom"]),
  llms_text: z.string().max(MAX_LLMS_TEXT),
  indexnow: z.boolean(),
});

api.put("/sites/:id/seo/tools", async (c) => {
  const parsed = seoToolsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid settings" }, 400);
  return redirectsCall(c, (site, credentials) => saveSeoTools(c.env, site, credentials, parsed.data));
});

const redirectRule = z.object({
  source: z.string().min(1).max(400),
  match_type: z.enum(REDIRECT_MATCH_TYPES),
  target: z.string().max(1000),
  status_code: z.number().refine((code): code is RedirectCode => (REDIRECT_CODES as readonly number[]).includes(code)),
  enabled: z.boolean(),
});

/** Run one redirects call for the site in the path, answering with its result. */
async function redirectsCall(c: Context, run: (site: SiteSummary, credentials: SiteCredentials | null) => Promise<unknown>) {
  const id = siteId(c);
  const [site, credentials] = id ? await Promise.all([getSite(c.env.DB, id), getCredentials(c.env, id)]) : [null, null];
  if (!site) return c.json({ error: "Site not found" }, 404);
  return seoResponse(c, async () => c.json((await run(site, credentials)) ?? { ok: true }));
}

const redirectListBody = z.object({
  page: z.number().int().min(1).max(10000).catch(1),
  search: z.string().max(100).catch(""),
  per_page: z.number().int().min(1).max(100).catch(25),
  export: z.boolean().catch(false),
  auto: z.boolean().catch(false),
});

/** A page of redirect rules, or all of them to export. POST so a search stays out of the URL. */
api.post("/sites/:id/seo/redirects", async (c) => {
  const query = redirectListBody.parse((await c.req.json().catch(() => null)) ?? {});
  return redirectsCall(c, (site, credentials) =>
    listRedirects(c.env, site, credentials, { ...query, search: query.search.trim() }),
  );
});

api.post("/sites/:id/seo/redirect", async (c) => {
  const parsed = redirectRule.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid redirect" }, 400);
  return redirectsCall(c, (site, credentials) => saveRedirect(c.env, site, credentials, null, parsed.data));
});

api.put("/sites/:id/seo/redirects/:ruleId", async (c) => {
  const ruleId = Number(c.req.param("ruleId"));
  const parsed = redirectRule.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !Number.isInteger(ruleId) || ruleId < 1) return c.json({ error: "Invalid redirect" }, 400);
  return redirectsCall(c, (site, credentials) => saveRedirect(c.env, site, credentials, ruleId, parsed.data));
});

const redirectBulkBody = z.object({
  action: z.enum(["enable", "disable", "delete"]),
  ids: z.array(z.number().int().min(1)).min(1).max(MAX_REDIRECT_IMPORT),
});

api.post("/sites/:id/seo/redirects/bulk", async (c) => {
  const parsed = redirectBulkBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
  return redirectsCall(c, (site, credentials) =>
    bulkRedirects(c.env, site, credentials, parsed.data.action, parsed.data.ids),
  );
});

const redirectImportBody = z.object({
  rows: z.array(redirectRule.partial()).min(1).max(MAX_REDIRECT_IMPORT),
});

api.post("/sites/:id/seo/redirects/import", async (c) => {
  const parsed = redirectImportBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid import" }, 400);
  return redirectsCall(c, (site, credentials) => importRedirects(c.env, site, credentials, parsed.data.rows));
});

const redirectSettingsBody = z.object({
  log_404: z.boolean().optional(),
  auto_enabled: z.boolean().optional(),
  on_delete: z.enum(REDIRECT_DELETE_ACTIONS).optional(),
  delete_target: z.string().max(1000).optional(),
});

api.put("/sites/:id/seo/redirects-settings", async (c) => {
  const parsed = redirectSettingsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
  return redirectsCall(c, (site, credentials) => setRedirectSettings(c.env, site, credentials, parsed.data));
});

api.post("/sites/:id/seo/404s", async (c) => {
  const { page } = z
    .object({ page: z.number().int().min(1).max(10000).catch(1) })
    .parse((await c.req.json().catch(() => null)) ?? {});
  return redirectsCall(c, (site, credentials) => listNotFound(c.env, site, credentials, page));
});

api.post("/sites/:id/seo/404s/clear", async (c) => redirectsCall(c, (site, credentials) => clearNotFound(c.env, site, credentials)));

/** SEO plugins installed on the site whose settings, page values and redirects can be imported. */
api.get("/sites/:id/seo/migrate", async (c) =>
  redirectsCall(c, (site, credentials) => listMigrationSources(c.env, site, credentials)),
);

const migrateSource = z.object({ source: z.string().min(1).max(40) });

api.post("/sites/:id/seo/migrate/preview", async (c) => {
  const parsed = migrateSource.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
  return redirectsCall(c, (site, credentials) => previewMigration(c.env, site, credentials, parsed.data.source));
});

const migrateRunBody = migrateSource.extend({ settings: z.boolean(), pages: z.boolean(), redirects: z.boolean() });

api.post("/sites/:id/seo/migrate/run", async (c) => {
  const parsed = migrateRunBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
  const { source, ...parts } = parsed.data;
  return redirectsCall(c, (site, credentials) => runMigration(c.env, site, credentials, source, parts));
});

// Deactivating another plugin takes a visible yes in the request, so nothing can do it by accident.
const migrateDeactivateBody = migrateSource.extend({ confirm: z.literal(true) });

api.post("/sites/:id/seo/migrate/deactivate", async (c) => {
  const parsed = migrateDeactivateBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Confirm that you want to deactivate the plugin" }, 400);
  return redirectsCall(c, (site, credentials) =>
    deactivateMigrationSource(c.env, site, credentials, parsed.data.source),
  );
});

/** Known vulnerabilities and insecure settings on one WordPress site. */
api.get("/sites/:id/security", async (c) => {
  const id = siteId(c);
  const [site, credentials] = id ? await Promise.all([getSite(c.env.DB, id), getCredentials(c.env, id)]) : [null, null];
  if (!site || !credentials) return c.json({ error: "Site not found" }, 404);
  return c.json<SiteSecurity>(await siteSecurity(c.env, site, credentials));
});

const fixesBody = z.object({
  ids: z.array(z.enum(SECURITY_FIXES.map((fix) => fix.id) as [string, ...string[]])).min(1).max(SECURITY_FIXES.length),
  enabled: z.boolean(),
});

/** Switch hardening fixes on or off on one WordPress site. */
api.put("/sites/:id/security/fixes", async (c) => {
  const id = siteId(c);
  const site = id && (await getCredentials(c.env, id));
  if (!id || !site) return c.json({ error: "Site not found" }, 404);
  const parsed = fixesBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Choose the fixes to change" }, 400);
  try {
    const fixes = await setSiteFixes(site, parsed.data.ids, parsed.data.enabled);
    await clearContentCache(c.env.DB, site.id);
    return c.json({ fixes });
  } catch (error) {
    if (!(error instanceof SiteRequestError)) throw error;
    return c.json(
      {
        error:
          error.status === 404 && !error.code
            ? "KontrolWP Connect on this site is too old to apply security fixes. It updates automatically; select Sync now to check."
            : error.message,
      },
      502,
    );
  }
});

api.get("/settings/wordfence", async (c) => {
  try {
    return c.json({ configured: Boolean(await loadFeedKey(c.env)) });
  } catch (error) {
    if (error instanceof SecretsKeyError) return c.json({ error: error.message }, 500);
    throw error;
  }
});

/** Save the Wordfence Intelligence API key after downloading the vulnerability feed with it. */
api.put("/settings/wordfence", async (c) => {
  const parsed = z.object({ key: z.string().trim().min(8).max(500) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Enter your Wordfence Intelligence API key" }, 400);
  try {
    const state = await refreshFeed(c.env, undefined, undefined, parsed.data.key);
    if (state.error) return c.json({ error: state.error }, 400);
    await saveFeedKey(c.env, parsed.data.key);
    return c.json({ configured: true, updated_at: state.updated_at });
  } catch (error) {
    if (error instanceof SecretsKeyError) return c.json({ error: error.message }, 500);
    throw error;
  }
});

api.delete("/settings/wordfence", async (c) => {
  await deleteFeedKey(c.env);
  return c.json({ configured: false });
});

api.get("/sites/:id/users", (c) =>
  userRequest(c, (site) =>
    cachedRead(c.env.DB, site.id, "users", "list", () => callSite<SiteUsers>(site, "GET", `${REST_NAMESPACE}/users`)),
  ),
);

/** Add a user to one site. */
api.post("/sites/:id/users", async (c) => {
  const parsed = newUser.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Enter a username, a valid email address and a role" }, 400);
  return userRequest(c, async (site) => {
    const result = await callSite(site, "POST", `${REST_NAMESPACE}/users/create`, parsed.data);
    await clearContentCache(c.env.DB, site.id);
    c.executionCtx.waitUntil(syncSite(c.env, site.id).catch(() => undefined));
    return result;
  });
});

/** Change a user's role, send them a password reset, or delete them. */
api.post("/sites/:id/users/manage", async (c) => {
  const parsed = userAction.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid user action" }, 400);
  return userRequest(c, async (site) => {
    await manageUser(c.env, site, parsed.data);
    await clearContentCache(c.env.DB, site.id);
    c.executionCtx.waitUntil(syncSite(c.env, site.id).catch(() => undefined));
    return { ok: true };
  });
});

/** Every site's users, as last synced, for the Users page. */
api.get("/users", async (c) => c.json<FleetUsers>(await listFleetUsers(c.env.DB)));

const bulkUserAction = z
  .object({
    action: z.enum(["set-role", "reset-password", "delete"]),
    role: z.string().trim().min(1).max(100).optional(),
    targets: z
      .array(z.object({ site_id: z.number().int().positive(), user_id: z.number().int().positive() }))
      .min(1)
      .max(2000),
  })
  .refine((value) => value.action !== "set-role" || !!value.role, { message: "Choose a role" });

/** Change, reset or delete users across sites; each site's users go one at a time. */
api.post("/users/bulk", async (c) => {
  const parsed = bulkUserAction.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid user action" }, 400);
  const { action, role, targets } = parsed.data;
  const bySite = new Map<number, number[]>();
  for (const target of targets) bySite.set(target.site_id, [...(bySite.get(target.site_id) ?? []), target.user_id]);
  const results: BulkUserResult[] = [];
  const siteResults = await forEachSite(c.env, [...bySite.keys()], async (site) => {
    for (const user_id of bySite.get(site.id) ?? []) {
      try {
        await manageUser(c.env, site, { user_id, action, role });
        results.push({ site_id: site.id, user_id, ok: true });
      } catch (error) {
        if (!(error instanceof SiteRequestError || error instanceof UserActionError)) throw error;
        results.push({
          site_id: site.id,
          user_id,
          ok: false,
          error: error instanceof SiteRequestError ? usersError(error) : error.message,
        });
      }
    }
  });
  // A site that could not be reached at all fails each of its users.
  for (const site of siteResults) {
    if (site.ok) continue;
    for (const user_id of bySite.get(site.site_id) ?? []) {
      if (!results.some((r) => r.site_id === site.site_id && r.user_id === user_id)) {
        results.push({ site_id: site.site_id, user_id, ok: false, error: site.error });
      }
    }
  }
  return c.json({ results });
});

/** Add the same user to several sites. */
api.post("/users", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = newUser.safeParse(body);
  if (!parsed.success) return c.json({ error: "Enter a username, a valid email address and a role" }, 400);
  const siteIds = siteIdList((body as { site_ids?: unknown }).site_ids);
  if (!siteIds.length) return c.json({ error: "Choose at least one site" }, 400);
  return c.json({
    results: await forEachSite(c.env, siteIds, (site) =>
      callSite(site, "POST", `${REST_NAMESPACE}/users/create`, parsed.data),
    ),
  });
});

const coreAutoUpdateMode = z.object({ mode: z.enum(["all", "minor", "off"]) });

/** Store what the site reports after a core auto-update change. */
async function saveCoreAutoUpdate(env: Env, siteId: number, result: PluginStatus["core_auto_update"]) {
  const [mode, locked] = coreAutoUpdate({ core_auto_update: result });
  if (mode) {
    await env.DB.prepare("UPDATE sites SET core_auto_update = ?, core_auto_update_locked = ? WHERE id = ?")
      .bind(mode, locked, siteId)
      .run();
  }
}

/** Set WordPress's core auto-updates on one site. */
api.put("/sites/:id/core-auto-update", async (c) => {
  const parsed = coreAutoUpdateMode.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Choose all, minor or off" }, 400);
  const response = await pluginRequest(c, async (site) => {
    const result = await callSite<PluginStatus["core_auto_update"]>(
      site,
      "POST",
      `${REST_NAMESPACE}/core/auto-update`,
      parsed.data,
    );
    await saveCoreAutoUpdate(c.env, site.id, result);
    return { ok: true };
  });
  if (response.status !== 200) return response;
  return c.json(await getSite(c.env.DB, siteId(c)!));
});

/** Set WordPress's core auto-updates on several sites. */
api.post("/core-auto-update", async (c) => {
  const parsed = coreAutoUpdateMode
    .extend({ site_ids: z.array(z.number().int().positive()).min(1).max(500) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Choose a mode and at least one site" }, 400);
  const { mode, site_ids } = parsed.data;
  return c.json({
    results: await forEachSite(
      c.env,
      site_ids,
      async (site) => {
        const result = await callSite<PluginStatus["core_auto_update"]>(
          site,
          "POST",
          `${REST_NAMESPACE}/core/auto-update`,
          { mode },
        );
        await saveCoreAutoUpdate(c.env, site.id, result);
      },
      { sync: false },
    ),
  });
});

/**
 * Run a plugin request on each site, a few at a time, then sync each one
 * that changed so the Plugins page shows the result (unless the request
 * stores its own result). Per-site failures are reported, not thrown.
 */
async function forEachSite(
  env: Env,
  siteIds: number[],
  request: (site: SiteCredentials) => Promise<unknown>,
  options: { sync?: boolean } = {},
): Promise<BulkPluginResult[]> {
  const results: BulkPluginResult[] = [];
  const queue = [...siteIds];
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        const site = await getCredentials(env, id);
        if (!site) {
          results.push({ site_id: id, ok: false, error: "Site not found" });
          continue;
        }
        await request(site);
        if (options.sync !== false) await syncSite(env, id);
        results.push({ site_id: id, ok: true });
      } catch (error) {
        if (!(error instanceof SiteRequestError || error instanceof SecretsKeyError)) throw error;
        results.push({
          site_id: id,
          ok: false,
          error: error instanceof SiteRequestError ? pluginsError(error) : error.message,
        });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, siteIds.length) }, worker));
  return results;
}

async function siteAction(
  c: AppContext,
  action: (site: NonNullable<Awaited<ReturnType<typeof getCredentials>>>) => Promise<void>,
) {
  const id = siteId(c);
  try {
    const site = id && (await getCredentials(c.env, id));
    if (!site) return c.json({ error: "Site not found" }, 404);
    await action(site);
  } catch (error) {
    if (error instanceof SiteRequestError) return c.json({ error: error.message }, 502);
    throw error;
  }
  return c.json({ ok: true });
}

api.onError((error, c) => {
  if (error instanceof SecretsKeyError) return c.json({ error: error.message, code: "secrets_key" }, 503);
  console.error(error);
  // Only signed-in owners reach the API, so name the cause instead of hiding it.
  const reason = error instanceof Error ? error.message : String(error);
  return c.json({ error: `Something went wrong: ${reason}` }, 500);
});

function siteId(c: AppContext): number | null {
  const id = Number(c.req.param("id"));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function umamiSettings(config: UmamiConfig | null): UmamiSettings {
  return config
    ? { configured: true, mode: config.mode, url: config.mode === "cloud" ? "" : config.url, username: config.username }
    : { configured: false, mode: "cloud", url: "", username: "" };
}

/** Run an Umami request, turning its failures into messages for the page. */
async function umamiRequest(c: AppContext, request: (config: UmamiConfig) => Promise<Response>) {
  try {
    const config = await loadUmamiConfig(c.env);
    if (!config) return c.json({ error: "Connect Umami in Settings first", code: "umami_not_configured" }, 409);
    return await request(config);
  } catch (error) {
    if (error instanceof UmamiError) return c.json({ error: error.message }, error.status === 400 ? 400 : 502);
    if (error instanceof SecretsKeyError) return c.json({ error: error.message }, 500);
    throw error;
  }
}

api.get("/settings/umami", async (c) => {
  try {
    return c.json(umamiSettings(await loadUmamiConfig(c.env)));
  } catch (error) {
    if (error instanceof SecretsKeyError) return c.json({ error: error.message }, 500);
    throw error;
  }
});

const umamiInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("cloud"), secret: z.string().trim().max(500).optional() }),
  z.object({
    mode: z.literal("self-hosted"),
    url: z
      .string()
      .trim()
      .url()
      .max(500)
      .regex(/^https?:\/\//),
    username: z.string().trim().min(1).max(200),
    secret: z.string().max(500).optional(),
  }),
]);

/** Save the Umami connection after checking that it works. A blank secret keeps the saved one. */
api.put("/settings/umami", async (c) => {
  const parsed = umamiInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Enter the Umami address, username and password, or an API key" }, 400);
  const input = parsed.data;
  try {
    const saved = await loadUmamiConfig(c.env).catch(() => null);
    const secret = input.secret?.length ? input.secret : saved?.mode === input.mode ? saved.secret : "";
    if (!secret) return c.json({ error: input.mode === "cloud" ? "Enter an API key" : "Enter the password" }, 400);
    const config: UmamiConfig =
      input.mode === "cloud"
        ? { mode: "cloud", url: "", username: "", secret }
        : { mode: "self-hosted", url: input.url.replace(/\/+$/, ""), username: input.username, secret };
    const websites = await listUmamiWebsites(await umamiClient(config));
    await saveUmamiConfig(c.env, config);
    await clearContentCacheKind(c.env.DB, "analytics");
    return c.json({ ...umamiSettings(config), websites: websites.length });
  } catch (error) {
    if (error instanceof UmamiError) return c.json({ error: error.message }, 400);
    throw error;
  }
});

api.delete("/settings/umami", async (c) => {
  await deleteUmamiConfig(c.env);
  await clearContentCacheKind(c.env.DB, "analytics");
  return c.json(umamiSettings(null));
});

api.get("/umami/websites", (c) =>
  umamiRequest(c, async (config) => c.json({ websites: await listUmamiWebsites(await umamiClient(config)) })),
);

/** Choose the Umami website for a site, or null to match by domain again. */
api.put("/sites/:id/umami", async (c) => {
  const parsed = z
    .object({ website_id: z.string().trim().min(1).max(100).nullable() })
    .safeParse(await c.req.json().catch(() => null));
  const id = siteId(c);
  if (!parsed.success || !id) return c.json({ error: "Invalid website" }, 400);
  const result = await c.env.DB.prepare("UPDATE sites SET umami_website_id = ? WHERE id = ?")
    .bind(parsed.data.website_id, id)
    .run();
  if (!result.meta.changes) return c.json({ error: "Site not found" }, 404);
  await clearContentCache(c.env.DB, id);
  return c.json({ ok: true });
});

/** Run a Cloudflare request, turning its failures into messages for the page. */
async function cloudflareRequest(c: AppContext, request: (token: string) => Promise<Response>) {
  try {
    const token = await loadCloudflareToken(c.env);
    if (!token)
      return c.json({ error: "Connect Cloudflare in Settings first" }, 409);
    return await request(token);
  } catch (error) {
    if (error instanceof CloudflareError) {
      return c.json({ error: error.message }, error.status === 400 ? 400 : 502);
    }
    if (error instanceof SecretsKeyError) return c.json({ error: error.message }, 500);
    throw error;
  }
}

api.get("/settings/cloudflare", async (c) => {
  try {
    return c.json<CloudflareSettings>({ configured: !!(await loadCloudflareToken(c.env)) });
  } catch (error) {
    if (error instanceof SecretsKeyError) return c.json({ error: error.message }, 500);
    throw error;
  }
});

/** Save the Cloudflare API token after checking that it can list Workers. */
api.put("/settings/cloudflare", async (c) => {
  const parsed = z.object({ token: z.string().trim().min(1).max(500) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Enter a Cloudflare API token" }, 400);
  try {
    const workers = await listWorkers(parsed.data.token);
    await saveCloudflareToken(c.env, parsed.data.token);
    return c.json({ configured: true, workers: workers.length });
  } catch (error) {
    if (error instanceof CloudflareError) return c.json({ error: error.message }, 400);
    throw error;
  }
});

api.delete("/settings/cloudflare", async (c) => {
  await deleteCloudflareToken(c.env);
  return c.json<CloudflareSettings>({ configured: false });
});

api.get("/cloudflare/workers", (c) =>
  cloudflareRequest(c, async (token) => c.json<{ workers: CloudflareWorker[] }>({ workers: await listWorkers(token) })),
);

/**
 * Say whether a static site is hosted on Cloudflare Workers and, if so, which
 * Worker it deploys from. Not hosted there clears everything from Cloudflare.
 */
api.put("/sites/:id/cloudflare", async (c) => {
  const id = siteId(c);
  const parsed = z
    .object({
      hosted: z.boolean(),
      account_id: z.string().trim().min(1).max(64).optional(),
      worker: z.string().trim().min(1).max(200).optional(),
    })
    .safeParse(await c.req.json().catch(() => undefined));
  if (!id || !parsed.success) return c.json({ error: "Invalid Worker" }, 400);
  const result = await c.env.DB.prepare(
    "UPDATE sites SET cf_hosted = ?, cf_account_id = ?, cf_worker = ?, cf_worker_tag = NULL, cf_error = NULL WHERE id = ? AND kind = 'static'",
  )
    .bind(
      parsed.data.hosted ? 1 : 0,
      parsed.data.hosted ? (parsed.data.account_id ?? null) : null,
      parsed.data.hosted ? (parsed.data.worker ?? null) : null,
      id,
    )
    .run();
  if (!result.meta.changes) return c.json({ error: "Static site not found" }, 404);
  await c.env.DB.prepare("DELETE FROM site_deployments WHERE site_id = ?").bind(id).run();
  await syncStaticSite(c.env, id);
  return c.json(await getSite(c.env.DB, id));
});

api.get("/sites/:id/deployments", async (c) => {
  const id = siteId(c);
  const site = id && (await getSite(c.env.DB, id));
  if (!id || !site || site.kind !== "static" || !site.cf_hosted) return c.json({ error: "Static site not found" }, 404);
  const [deployments, token] = await Promise.all([
    listDeployments(c.env.DB, id),
    loadCloudflareToken(c.env).catch(() => null),
  ]);
  return c.json<SiteDeployments>({ configured: !!token, worker: site.cf_worker, error: site.cf_error, deployments });
});

/** One page of a build's log, read from Cloudflare when asked for. */
api.get("/sites/:id/builds/:buildId/logs", (c) =>
  cloudflareRequest(c, async (token) => {
    const id = siteId(c);
    const buildId = c.req.param("buildId");
    const site = id && (await getSite(c.env.DB, id));
    // Only builds this site listed at its last sync, so a site cannot read another Worker's logs.
    const known =
      site &&
      site.cf_hosted &&
      site.cf_account_id &&
      (await c.env.DB.prepare(
        "SELECT 1 AS found FROM site_deployments WHERE site_id = ? AND type = 'build' AND ref = ?",
      )
        .bind(id, buildId)
        .first());
    if (!site || !known) return c.json({ error: "Build not found" }, 404);
    return c.json<BuildLog>(
      await fetchBuildLog(token, site.cf_account_id!, buildId, c.req.query("cursor") || undefined),
    );
  }),
);

/** Visitor numbers move all day, so they are kept only briefly, and never shown once old. */
const ANALYTICS_CACHE = { maxAge: 300, staleOnError: false };

const analyticsRange = z.enum(["24h", "7d", "30d", "90d"]);

const umamiSummary = (c: AppContext) =>
  umamiRequest(c, async (config) => {
    const id = siteId(c);
    const site =
      id &&
      (await c.env.DB.prepare("SELECT url, umami_website_id FROM sites WHERE id = ?")
        .bind(id)
        .first<{ url: string; umami_website_id: string | null }>());
    if (!site) return c.json({ error: "Site not found" }, 404);
    const range = analyticsRange.catch("7d").parse(c.req.query("range"));
    const tz = validTimeZone(c.req.query("tz"));
    const client = await umamiClient(config);
    const websites = await listUmamiWebsites(client);
    const chosen = site.umami_website_id
      ? (websites.find((website) => website.id === site.umami_website_id) ?? null)
      : null;
    const website = chosen ?? (site.umami_website_id ? null : matchWebsite(websites, site.url));
    if (!website) {
      return c.json<SiteAnalytics>({
        website: null,
        chosen: !!site.umami_website_id,
        range,
        stats: null,
        series: [],
        pages: [],
        referrers: [],
      });
    }
    const data = await cachedRead(
      c.env.DB,
      id,
      "analytics",
      `summary|${website.id}|${range}|${tz}`,
      async () => ({ website, chosen: !!chosen, ...(await siteAnalytics(client, website, range, tz)) }),
      ANALYTICS_CACHE,
    );
    return c.json<SiteAnalytics>({ provider: "umami", ...data });
  });

/** The Analytics tab: everything in the summary, plus Umami's other breakdowns. */
const umamiDetails = (c: AppContext) =>
  umamiRequest(c, async (config) => {
    const id = siteId(c);
    const site =
      id &&
      (await c.env.DB.prepare("SELECT url, umami_website_id FROM sites WHERE id = ?")
        .bind(id)
        .first<{ url: string; umami_website_id: string | null }>());
    if (!site) return c.json({ error: "Site not found" }, 404);
    const range = analyticsRange.catch("7d").parse(c.req.query("range"));
    const tz = validTimeZone(c.req.query("tz"));
    const client = await umamiClient(config);
    const websites = await listUmamiWebsites(client);
    const chosen = site.umami_website_id
      ? (websites.find((website) => website.id === site.umami_website_id) ?? null)
      : null;
    const website = chosen ?? (site.umami_website_id ? null : matchWebsite(websites, site.url));
    if (!website) {
      return c.json<SiteAnalyticsDetails>({
        website: null,
        chosen: !!site.umami_website_id,
        range,
        stats: null,
        series: [],
        pages: [],
        referrers: [],
        breakdowns: null,
        active: null,
      });
    }
    const data = await cachedRead(
      c.env.DB,
      id,
      "analytics",
      `details|${website.id}|${range}|${tz}`,
      async () => ({ website, chosen: !!chosen, ...(await siteAnalyticsDetails(client, website, range, tz)) }),
      ANALYTICS_CACHE,
    );
    return c.json<SiteAnalyticsDetails>({ provider: "umami", ...data });
  });

/** A site's analytics provider; Umami for a site that has not chosen. */
async function analyticsProvider(c: AppContext): Promise<AnalyticsProvider> {
  const id = siteId(c);
  const row = id && (await c.env.DB.prepare("SELECT analytics_provider FROM sites WHERE id = ?").bind(id).first<{ analytics_provider: string }>());
  return row && (ANALYTICS_PROVIDERS as readonly string[]).includes(row.analytics_provider)
    ? (row.analytics_provider as AnalyticsProvider)
    : "umami";
}

/** Gets an access token for a Google scope with the saved connection. */
type GoogleAccess = (scope: string) => Promise<string>;

/** Run a Google request with the saved connection, turning its failures into messages for the page. */
async function googleRequest(c: AppContext, request: (access: GoogleAccess, credential: GoogleCredential) => Promise<Response>) {
  try {
    const credential = await loadGoogleCredential(c.env);
    if (!credential) return c.json({ error: "Connect Google in Settings first", code: "google_not_configured" }, 409);
    const client = credential.kind === "oauth" ? await loadGoogleClient(c.env) : null;
    return await request((scope) => googleAccessToken(credential, scope, Date.now(), client), credential);
  } catch (error) {
    if (error instanceof GoogleError) return c.json({ error: error.message }, error.status === 400 ? 400 : 502);
    if (error instanceof SecretsKeyError) return c.json({ error: error.message }, 500);
    throw error;
  }
}

/** Google Analytics 4 for the site: the owner's chosen property, or the one whose web stream has the site's domain. */
function ga4Analytics_(c: AppContext, detailed: boolean) {
  return googleRequest(c, async (access) => {
    const id = siteId(c);
    const site =
      id &&
      (await c.env.DB.prepare("SELECT url, analytics_ref FROM sites WHERE id = ?")
        .bind(id)
        .first<{ url: string; analytics_ref: string | null }>());
    if (!site) return c.json({ error: "Site not found" }, 404);
    const range = analyticsRange.catch("7d").parse(c.req.query("range"));
    const tz = validTimeZone(c.req.query("tz"));
    const token = await access(GOOGLE_SCOPES.analytics);
    const properties = await listGa4Properties(token);
    const chosen = site.analytics_ref ? (properties.find((property) => property.id === site.analytics_ref) ?? null) : null;
    const property = chosen ?? (site.analytics_ref ? null : matchGa4Property(properties, site.url));
    if (!property) {
      return c.json<SiteAnalyticsDetails>({
        provider: "ga4",
        website: null,
        sources: properties.length,
        chosen: !!site.analytics_ref,
        range,
        stats: null,
        series: [],
        pages: [],
        referrers: [],
        breakdowns: null,
        active: null,
      });
    }
    const data = await cachedRead(
      c.env.DB,
      id,
      "analytics",
      `ga4-${detailed ? "details" : "summary"}|${property.id}|${range}|${tz}`,
      async () => ({ chosen: !!chosen, ...(await (detailed ? ga4Details : ga4Analytics)(token, property, range, tz)) }),
      ANALYTICS_CACHE,
    );
    return c.json(data);
  });
}

api.get("/sites/:id/analytics", async (c) => {
  const provider = await analyticsProvider(c);
  return provider === "ga4" ? ga4Analytics_(c, false) : umamiSummary(c);
});

api.get("/sites/:id/analytics/details", async (c) => {
  const provider = await analyticsProvider(c);
  return provider === "ga4" ? ga4Analytics_(c, true) : umamiDetails(c);
});

/** What Settings shows about the Google connection and the OAuth client it signs in with. */
async function googleSettings(c: AppContext): Promise<GoogleSettings> {
  const [credential, client] = await Promise.all([loadGoogleCredential(c.env), loadGoogleClient(c.env)]);
  return {
    configured: !!credential,
    kind: credential ? (credential.kind === "oauth" ? "oauth" : "service_account") : null,
    account: credential ? googleAccount(credential) : "",
    client_id: client?.client_id ?? "",
    client_configured: !!client,
    can_setup: !!credential && googleCanSetUpSites(credential),
    redirect_uri: googleRedirectUri(new URL(c.req.url).origin),
  };
}

api.get("/settings/google", async (c) => {
  try {
    return c.json<GoogleSettings>(await googleSettings(c));
  } catch (error) {
    if (error instanceof SecretsKeyError) return c.json({ error: error.message }, 500);
    throw error;
  }
});

/** Save the OAuth client (id and secret) that "Connect to Google" signs in with. A new client ends the old sign-in. */
api.put("/settings/google/client", async (c) => {
  const parsed = z
    .object({ client_id: z.string().trim().min(1).max(300), client_secret: z.string().trim().min(1).max(300) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Enter the OAuth client ID and secret" }, 400);
  if (!parsed.data.client_id.endsWith(".apps.googleusercontent.com")) {
    return c.json({ error: "That does not look like a Google client ID. It ends in .apps.googleusercontent.com." }, 400);
  }
  const credential = await loadGoogleCredential(c.env);
  await saveGoogleClient(c.env, parsed.data);
  if (credential?.kind === "oauth") {
    await deleteGoogleCredential(c.env);
    await clearContentCacheKind(c.env.DB, "analytics");
    await clearContentCacheKind(c.env.DB, "seo");
  }
  return c.json<GoogleSettings>(await googleSettings(c));
});

/** Start "Connect to Google": the address of Google's sign-in page, which the browser then opens. */
api.post("/google/connect", async (c) => {
  const client = await loadGoogleClient(c.env);
  if (!client) return c.json({ error: "Save the OAuth client ID and secret first" }, 400);
  const parsed = z
    .object({ setup: z.boolean().catch(false), return_to: z.string().max(300).catch("") })
    .parse((await c.req.json().catch(() => null)) ?? {});
  // Only a path on this app, so the callback cannot be used to send the owner elsewhere.
  const returnTo = /^\/(?!\/)/.test(parsed.return_to) ? parsed.return_to : "";
  const url = await startGoogleSignIn(c.env, client, googleRedirectUri(new URL(c.req.url).origin), {
    setup: parsed.setup,
    returnTo,
  });
  return c.json({ url });
});

/** Google sends the owner back here; the Worker finishes the sign-in and returns them to Settings. */
api.get("/google/callback", async (c) => {
  const back = (result: Record<string, string>, returnTo = "") => {
    if (returnTo) {
      const target = new URL(returnTo, "https://app.invalid");
      for (const [key, value] of Object.entries(result)) target.searchParams.set(key, value);
      return c.redirect(`${target.pathname}${target.search}${target.hash}`, 302);
    }
    return c.redirect(`/settings?${new URLSearchParams({ tab: "integrations", ...result })}`, 302);
  };
  const code = c.req.query("code");
  const state = c.req.query("state") ?? "";
  const denied = c.req.query("error");
  if (denied || !code) {
    return back({ google: "error", message: denied === "access_denied" ? "Google access was not allowed." : "Google did not finish the sign-in." });
  }
  try {
    const client = await loadGoogleClient(c.env);
    if (!client) return back({ google: "error", message: "Save the OAuth client ID and secret first." });
    const { account, returnTo } = await finishGoogleSignIn(c.env, client, googleRedirectUri(new URL(c.req.url).origin), code, state);
    await saveGoogleCredential(c.env, account);
    forgetGoogleTokens();
    await clearContentCacheKind(c.env.DB, "analytics");
    await clearContentCacheKind(c.env.DB, "seo");
    return back({ google: "connected" }, returnTo);
  } catch (error) {
    if (error instanceof GoogleError) return back({ google: "error", message: error.message });
    throw error;
  }
});

/** Disconnect Google (an OAuth sign-in or an older service account). The OAuth client stays so it can be reconnected. */
api.delete("/settings/google", async (c) => {
  await deleteGoogleCredential(c.env);
  await clearContentCacheKind(c.env.DB, "analytics");
  await clearContentCacheKind(c.env.DB, "seo");
  return c.json<GoogleSettings>(await googleSettings(c));
});

/** Forget the OAuth client too. */
api.delete("/settings/google/client", async (c) => {
  await deleteGoogleCredential(c.env);
  await deleteGoogleClient(c.env);
  await clearContentCacheKind(c.env.DB, "analytics");
  await clearContentCacheKind(c.env.DB, "seo");
  return c.json<GoogleSettings>(await googleSettings(c));
});

const searchConsoleRange = z.enum(SEARCH_CONSOLE_RANGES);

/** The site's Search Console clicks, impressions, queries and pages. */
api.get("/sites/:id/search-console", (c) =>
  googleRequest(c, async (access) => {
    const id = siteId(c);
    const site =
      id &&
      (await c.env.DB.prepare("SELECT url, gsc_property FROM sites WHERE id = ?")
        .bind(id)
        .first<{ url: string; gsc_property: string | null }>());
    if (!site) return c.json({ error: "Site not found" }, 404);
    const range = searchConsoleRange.catch("28d").parse(c.req.query("range"));
    const token = await access(GOOGLE_SCOPES.searchConsole);
    const properties = await listSearchConsoleProperties(token);
    const chosen = site.gsc_property ? (properties.find((property) => property.id === site.gsc_property) ?? null) : null;
    const property = chosen ?? (site.gsc_property ? null : matchSearchConsoleProperty(properties, site.url));
    if (!property) {
      return c.json<SiteSearchConsole>({
        property: null,
        chosen: !!site.gsc_property,
        range,
        totals: null,
        series: [],
        queries: [],
        pages: [],
      });
    }
    // Search Console reports whole days, a couple of days late, so an hour old is fresh enough.
    const data = await cachedRead(
      c.env.DB,
      id,
      "seo",
      `search-console|${property.id}|${range}`,
      async () => ({ chosen: !!chosen, ...(await searchConsole(token, property, range)) }),
      { maxAge: 3600, staleOnError: false },
    );
    return c.json<SiteSearchConsole>(data);
  }),
);

/**
 * Set a WordPress site up in Search Console: get Google's verification tag,
 * have KontrolWP Connect print it, let Google check it, add the site and
 * submit its sitemap. A site already in Search Console only gets its sitemap.
 */
api.post("/sites/:id/search-console/setup", async (c) => {
  const id = siteId(c);
  const [site, credentials] = id ? await Promise.all([getSite(c.env.DB, id), getCredentials(c.env, id)]) : [null, null];
  if (!site) return c.json({ error: "Site not found" }, 404);
  if (site.kind === "static") {
    return c.json({ error: "A static website has no KontrolWP Connect to print the verification tag, so add it in Search Console yourself." }, 400);
  }
  return googleRequest(c, (access, credential) =>
    seoResponse(c, async () => {
      if (!googleCanSetUpSites(credential)) {
        return c.json({ error: "Allow setup in Google first, so KontrolWP can add and verify the site.", code: "google_setup_scopes" }, 409);
      }
      const seo = await siteSeo(c.env, site, credentials);
      if (!seo.settings.enabled) {
        throw new SeoError("Turn on SEO Management for this site first. It prints the verification tag.", 400);
      }
      if (seo.conflict) {
        throw new SeoError(`${seo.conflict} is active, so KontrolWP does not print the verification tag. Add the site in Search Console with that plugin.`, 400);
      }
      const token = await access(GOOGLE_SCOPES.manage);
      const property = propertyUrl(site.url);
      const existing = (await listSearchConsoleProperties(token)).find((item) => item.id === property);
      if (!existing) {
        const code = await verificationCode(token, property);
        const tools = await siteSeoTools(c.env, site, credentials);
        await saveSeoTools(c.env, site, credentials, { ...tools.settings, verify: { ...tools.settings.verify, google: code } });
        await verifyProperty(token, property);
        await addProperty(token, property);
      }
      const sitemap = `${property}wp-sitemap.xml`;
      let sitemapError: string | null = null;
      try {
        await submitSitemap(token, property, sitemap);
      } catch (error) {
        if (!(error instanceof GoogleError)) throw error;
        sitemapError = error.message;
      }
      await clearContentCache(c.env.DB, site.id);
      return c.json<SearchConsoleSetup>({ property, already: !!existing, sitemap: sitemapError ? null : sitemap, sitemap_error: sitemapError });
    }),
  );
});

/** The properties in Search Console the connected Google account can read. */
api.get("/google/search-console/properties", (c) =>
  googleRequest(c, async (access) =>
    c.json({ websites: await listSearchConsoleProperties(await access(GOOGLE_SCOPES.searchConsole)) }),
  ),
);

/** Choose the Search Console property for a site, or null to match by domain again. */
api.put("/sites/:id/search-console", async (c) => {
  const parsed = z.object({ property: z.string().trim().min(1).max(300).nullable() }).safeParse(await c.req.json().catch(() => null));
  const id = siteId(c);
  if (!parsed.success || !id) return c.json({ error: "Invalid property" }, 400);
  const result = await c.env.DB.prepare("UPDATE sites SET gsc_property = ? WHERE id = ?").bind(parsed.data.property, id).run();
  if (!result.meta.changes) return c.json({ error: "Site not found" }, 404);
  await clearContentCache(c.env.DB, id);
  return c.json({ ok: true });
});

/** The GA4 properties the connected Google account can see. */
api.get("/google/analytics/properties", (c) =>
  googleRequest(c, async (access) =>
    c.json({ websites: await listGa4Properties(await access(GOOGLE_SCOPES.analytics)) }),
  ),
);

/** Choose where a site's analytics come from. */
api.put("/sites/:id/analytics-provider", async (c) => {
  const parsed = z.object({ provider: z.enum(ANALYTICS_PROVIDERS) }).safeParse(await c.req.json().catch(() => null));
  const id = siteId(c);
  if (!parsed.success || !id) return c.json({ error: "Invalid analytics provider" }, 400);
  const result = await c.env.DB.prepare("UPDATE sites SET analytics_provider = ?, analytics_ref = NULL WHERE id = ?")
    .bind(parsed.data.provider, id)
    .run();
  if (!result.meta.changes) return c.json({ error: "Site not found" }, 404);
  await clearContentCacheKind(c.env.DB, "analytics");
  return c.json({ ok: true });
});

/** Choose the GA4 property for a site, or null to match by domain again. */
api.put("/sites/:id/analytics-source", async (c) => {
  const parsed = z.object({ ref: z.string().trim().min(1).max(200).nullable() }).safeParse(await c.req.json().catch(() => null));
  const id = siteId(c);
  if (!parsed.success || !id) return c.json({ error: "Invalid analytics source" }, 400);
  const result = await c.env.DB.prepare("UPDATE sites SET analytics_ref = ? WHERE id = ?").bind(parsed.data.ref, id).run();
  if (!result.meta.changes) return c.json({ error: "Site not found" }, 404);
  await clearContentCache(c.env.DB, id);
  return c.json({ ok: true });
});

function validTimeZone(value: string | undefined): string {
  if (!value) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

api.get("/settings/sync", async (c) => c.json(await loadSyncSettings(c.env)));

api.put("/settings/sync", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { interval_minutes?: unknown } | null;
  const interval = SYNC_INTERVALS.find((minutes) => minutes === body?.interval_minutes);
  if (!interval) return c.json({ error: "Choose one of the offered intervals" }, 400);
  const settings: SyncSettings = { interval_minutes: interval };
  await c.env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES ('sync', ?)")
    .bind(JSON.stringify(settings))
    .run();
  return c.json(settings);
});

/** Scheduled link checks: how often, and the time zone midnight is in. */
api.get("/settings/links", async (c) => c.json(await linkScanSchedule(c.env)));

api.put("/settings/links", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { interval_days?: unknown; time_zone?: unknown } | null;
  const current = await loadLinkScanSettings(c.env);
  const interval =
    body?.interval_days === undefined
      ? current.interval_days
      : LINK_SCAN_INTERVALS.find((days) => days === body.interval_days);
  if (interval === undefined) return c.json({ error: "Choose one of the offered intervals" }, 400);
  let zone = current.time_zone;
  if (body?.time_zone !== undefined) {
    if (typeof body.time_zone !== "string" || !isTimeZone(body.time_zone))
      return c.json({ error: "Unknown time zone" }, 400);
    zone = body.time_zone;
  }
  await saveLinkScanSettings(c.env, { interval_days: interval, time_zone: zone });
  return c.json(await linkScanSchedule(c.env));
});

api.get("/settings/updates", async (c) => c.json(await globalPolicyView(c.env)));

const scheduleBody = z.object({
  core: z.boolean(),
  plugins: z.boolean(),
  themes: z.boolean(),
  frequency: z.enum(UPDATE_FREQUENCIES),
  weekday: z.number().int().min(0).max(6),
  day: z.number().int().min(1).max(28),
  hour: z.number().int().min(0).max(23),
});
const excludedBody = z.array(z.string().min(1).max(300)).max(500);

/** Save the global scheduled update policy. */
api.put("/settings/updates", async (c) => {
  const parsed = scheduleBody
    .extend({ enabled: z.boolean(), excluded_plugins: excludedBody })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid schedule" }, 400);
  await saveGlobalPolicy(c.env, { ...parsed.data, excluded_plugins: cleanExcluded(parsed.data.excluded_plugins) });
  return c.json(await globalPolicyView(c.env));
});

api.get("/sites/:id/update-policy", async (c) => {
  const id = siteId(c);
  const view = id && (await sitePolicyView(c.env, id));
  if (!view) return c.json({ error: "Site not found" }, 404);
  return c.json(view);
});

/** Save how this site follows the scheduled update policy. */
api.put("/sites/:id/update-policy", async (c) => {
  const id = siteId(c);
  const parsed = z
    .object({ mode: z.enum(["inherit", "custom", "off"]), schedule: scheduleBody, excluded_plugins: excludedBody })
    .safeParse(await c.req.json().catch(() => null));
  if (!id || !parsed.success) return c.json({ error: "Invalid schedule" }, 400);
  if (!(await getSite(c.env.DB, id))) return c.json({ error: "Site not found" }, 404);
  await saveSitePolicy(c.env, id, { ...parsed.data, excluded_plugins: cleanExcluded(parsed.data.excluded_plugins) });
  return c.json(await sitePolicyView(c.env, id));
});
