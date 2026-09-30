import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  decodeConnectionKey,
  normalizeSiteUrl,
  REST_NAMESPACE,
  type ConnectionKey,
} from "../../shared/protocol.ts";
import type { Overview, PluginStatus, SiteDetail } from "../../shared/types.ts";
import { callSite, SiteRequestError } from "../sites/client.ts";
import { getCredentials, getSite, listComments, listSites, listUpdates } from "../sites/store.ts";
import { encryptSecret, isValidSecretsKey, SecretsKeyError } from "../sites/secrets.ts";
import { syncSite } from "../sites/sync.ts";
import { requireSameOrigin } from "./csrf.ts";

type AppContext = Context<{ Bindings: Env }>;

export const api = new Hono<{ Bindings: Env }>();
api.use("*", requireSameOrigin);

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
  const result = await syncSite(c.env, id);
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

api.post("/sites/:id/updates", async (c) => {
  const parsed = updateAction.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid update" }, 400);
  return siteAction(c, async (site) => {
    await callSite(site, "POST", `${REST_NAMESPACE}/updates/apply`, parsed.data);
    // Re-read the site so versions and the remaining updates are accurate.
    await syncSite(c.env, site.id);
  });
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
  return c.json({ error: "Something went wrong" }, 500);
});

function siteId(c: AppContext): number | null {
  const id = Number(c.req.param("id"));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
