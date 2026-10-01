import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  decodeConnectionKey,
  normalizeSiteUrl,
  REST_NAMESPACE,
  type ConnectionKey,
} from "../../shared/protocol.ts";
import type {
  BulkPluginResult,
  FleetPlugins,
  Overview,
  PluginStatus,
  SiteAdmin,
  SiteDetail,
  SiteAnalytics,
  SitePlugins,
  UmamiSettings,
} from "../../shared/types.ts";
import { callSite, SiteRequestError, type SiteCredentials } from "../sites/client.ts";
import { base64 } from "../sites/presser-connect.ts";
import { getCredentials, getSite, listComments, listFleetPlugins, listSites, listUpdates } from "../sites/store.ts";
import { encryptSecret, isValidSecretsKey, SecretsKeyError } from "../sites/secrets.ts";
import { coreAutoUpdate, syncSite } from "../sites/sync.ts";
import { enqueueUpdate } from "../sites/updates.ts";
import {
  deleteUmamiConfig,
  listUmamiWebsites,
  loadUmamiConfig,
  matchWebsite,
  saveUmamiConfig,
  siteAnalytics,
  umamiClient,
  UmamiError,
  type UmamiConfig,
} from "../umami.ts";
import { MigrationError } from "../db/migrate.ts";
import { ensureSchema } from "../db/schema.ts";
import { requireSameOrigin } from "./csrf.ts";

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
    return c.json(
      { error: "SITE_SECRETS_KEY is missing or invalid", code: "secrets_key_missing" },
      503,
    );
  }
  await next();
});

api.get("/overview", async (c) => {
  const [sites, updates, comments] = await Promise.all([
    listSites(c.env.DB),
    listUpdates(c.env.DB),
    listComments(c.env.DB),
  ]);
  return c.json<Overview>({ sites, updates, comments });
});

api.get("/sites", async (c) => c.json(await listSites(c.env.DB)));

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

api.post("/sites", async (c) => {
  const parsed = siteInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Enter the site address and its Connection Key" }, 400);
  const url = normalizeSiteUrl(parsed.data.url);
  if (!url) return c.json({ error: "Enter the site's public https:// address" }, 400);
  const key = decodeConnectionKey(parsed.data.connection_key);
  if (!key) {
    return c.json({ error: "That is not a Connection Key. Copy it again from Settings, Presser Connect on the site." }, 400);
  }

  const existing = await c.env.DB.prepare("SELECT id FROM sites WHERE url = ?").bind(url).first<{ id: number }>();
  if (existing) return c.json({ error: "This site is already in Presser", id: existing.id }, 409);

  // Refuse before inserting, so a missing encryption key never leaves a half-made site.
  await encryptSecret(c.env.SITE_SECRETS_KEY, 0, key.secret);
  let name: string;
  try {
    name = await verifyConnection(url, key);
  } catch (error) {
    if (error instanceof SiteRequestError) return c.json({ error: error.message }, 400);
    throw error;
  }

  const row = await c.env.DB
    .prepare("INSERT INTO sites (name, url, key_id, secret) VALUES (?, ?, ?, '') RETURNING id")
    .bind(name || new URL(url).hostname, url, key.keyId)
    .first<{ id: number }>();
  // The ciphertext is bound to the site id, which exists only after the insert.
  await c.env.DB
    .prepare("UPDATE sites SET secret = ? WHERE id = ?")
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
  const result = await c.env.DB
    .prepare("UPDATE sites SET url = ? WHERE id = ?")
    .bind(url, id)
    .run()
    .catch(() => null);
  if (!result) return c.json({ error: "Another site already uses this URL" }, 409);
  if (!result.meta.changes) return c.json({ error: "Site not found" }, 404);
  return c.json(await getSite(c.env.DB, id));
});

api.delete("/sites/:id", async (c) => {
  const id = siteId(c);
  if (!id) return c.json({ error: "Site not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM site_updates WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM site_comments WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM site_plugins WHERE site_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM update_jobs WHERE site_id = ?").bind(id),
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
    return c.json({ error: "That is not a Connection Key. Copy it again from Settings, Presser Connect on the site." }, 400);
  }
  try {
    await verifyConnection(site.url, key);
  } catch (error) {
    if (error instanceof SiteRequestError) return c.json({ error: error.message }, 400);
    throw error;
  }
  await c.env.DB
    .prepare("UPDATE sites SET key_id = ?, secret = ? WHERE id = ?")
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
    await c.env.DB
      .prepare(
        `UPDATE sites SET pending_comments = MAX(0, pending_comments - 1)
         WHERE id = ? AND EXISTS (SELECT 1 FROM site_comments WHERE site_id = ? AND comment_id = ?)`,
      )
      .bind(site.id, site.id, commentId)
      .run();
    await c.env.DB
      .prepare("DELETE FROM site_comments WHERE site_id = ? AND comment_id = ?")
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

/** An older Presser Connect has no Magic Login routes; it updates itself on the next sync. */
function magicLoginError(error: SiteRequestError): string {
  return error.status === 404 && !error.code
    ? "Presser Connect on this site is too old for Magic Login. It updates automatically; select Sync now to check."
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
    return c.json({ admins: await fetchAdmins(site) });
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
  await c.env.DB
    .prepare("UPDATE sites SET login_user_id = ?, login_user_name = ? WHERE id = ?")
    .bind(parsed.data.user_id, name, id)
    .run();
  return c.json(await getSite(c.env.DB, id));
});

/** Ask the site for a one-time link that signs the browser in as the chosen administrator. */
api.post("/sites/:id/magic-login", async (c) => {
  const id = siteId(c);
  const summary = id && (await getSite(c.env.DB, id));
  if (!id || !summary) return c.json({ error: "Site not found" }, 404);
  if (!summary.login_user_id) return c.json({ error: "Choose an administrator for Magic Login first" }, 400);
  const site = (await getCredentials(c.env, id))!;
  let url: URL | null = null;
  try {
    const result = await callSite<{ url?: unknown }>(site, "POST", `${REST_NAMESPACE}/login`, {
      user_id: summary.login_user_id,
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
 * its listed updates and anything still waiting in its queue; including it
 * checks right away.
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
          c.env.DB.prepare("DELETE FROM update_jobs WHERE site_id = ? AND status != 'running'").bind(id),
        ]
      : []),
  ]);
  if (!excluded) await syncSite(c.env, id);
  return c.json(await getSite(c.env.DB, id));
});

/** An older Presser Connect has no plugin routes; it updates itself on the next sync. */
function pluginsError(error: SiteRequestError): string {
  if (error.status === 404 && !error.code) {
    return "Presser Connect on this site is too old to manage plugins. It updates automatically; select Sync now to check.";
  }
  // An older Presser Connect rejects actions it does not know, such as auto-updates before 0.7.0.
  if (error.status === 400 && error.code === "rest_invalid_param") {
    return "Presser Connect on this site is too old for this. It updates automatically; select Sync now to check.";
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
  pluginRequest(c, (site) => callSite<SitePlugins>(site, "GET", `${REST_NAMESPACE}/plugins`)),
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
    c.executionCtx.waitUntil(syncSite(c.env, site.id).catch(() => undefined));
    return { ok: true };
  });
});

const pluginInstall = z.discriminatedUnion("source", [
  z.object({ source: z.literal("wordpress.org"), slug: z.string().trim().regex(/^[a-z0-9-]{1,200}$/), activate: z.boolean() }),
  z.object({ source: z.literal("url"), url: z.string().trim().url().max(2000).regex(/^https?:\/\//), activate: z.boolean() }),
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
      payload: { source: "zip", package: base64(new Uint8Array(await file.arrayBuffer())), activate: form.activate === "true" },
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
    const result = await callSite<PluginStatus["core_auto_update"]>(site, "POST", `${REST_NAMESPACE}/core/auto-update`, parsed.data);
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
        const result = await callSite<PluginStatus["core_auto_update"]>(site, "POST", `${REST_NAMESPACE}/core/auto-update`, { mode });
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
        results.push({ site_id: id, ok: false, error: error instanceof SiteRequestError ? pluginsError(error) : error.message });
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
    url: z.string().trim().url().max(500).regex(/^https?:\/\//),
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
    return c.json({ ...umamiSettings(config), websites: websites.length });
  } catch (error) {
    if (error instanceof UmamiError) return c.json({ error: error.message }, 400);
    throw error;
  }
});

api.delete("/settings/umami", async (c) => {
  await deleteUmamiConfig(c.env);
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
  const result = await c.env.DB.prepare("UPDATE sites SET umami_website_id = ? WHERE id = ?").bind(parsed.data.website_id, id).run();
  if (!result.meta.changes) return c.json({ error: "Site not found" }, 404);
  return c.json({ ok: true });
});

const analyticsRange = z.enum(["24h", "7d", "30d", "90d"]);

api.get("/sites/:id/analytics", (c) =>
  umamiRequest(c, async (config) => {
    const id = siteId(c);
    const site = id && (await c.env.DB.prepare("SELECT url, umami_website_id FROM sites WHERE id = ?").bind(id).first<{ url: string; umami_website_id: string | null }>());
    if (!site) return c.json({ error: "Site not found" }, 404);
    const range = analyticsRange.catch("7d").parse(c.req.query("range"));
    const tz = validTimeZone(c.req.query("tz"));
    const client = await umamiClient(config);
    const websites = await listUmamiWebsites(client);
    const chosen = site.umami_website_id ? websites.find((website) => website.id === site.umami_website_id) ?? null : null;
    const website = chosen ?? (site.umami_website_id ? null : matchWebsite(websites, site.url));
    if (!website) {
      return c.json<SiteAnalytics>({ website: null, chosen: !!site.umami_website_id, range, stats: null, series: [], pages: [], referrers: [] });
    }
    return c.json<SiteAnalytics>({ website, chosen: !!chosen, ...(await siteAnalytics(client, website, range, tz)) });
  }),
);

function validTimeZone(value: string | undefined): string {
  if (!value) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}
