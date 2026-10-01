import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  decodeConnectionKey,
  normalizeSiteUrl,
  REST_NAMESPACE,
  type ConnectionKey,
} from "../../shared/protocol.ts";
import type { Overview, PluginStatus, SiteAdmin, SiteDetail } from "../../shared/types.ts";
import { callSite, SiteRequestError } from "../sites/client.ts";
import { getCredentials, getSite, listComments, listSites, listUpdates } from "../sites/store.ts";
import { encryptSecret, isValidSecretsKey, SecretsKeyError } from "../sites/secrets.ts";
import { syncSite } from "../sites/sync.ts";
import { enqueueUpdate } from "../sites/updates.ts";
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
  if (!(await getSite(c.env.DB, id))) return c.json({ error: "Site not found" }, 404);
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
