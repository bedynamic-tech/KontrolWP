import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  encodeConnectionKey,
  normalizeSiteUrl,
  randomToken,
  REST_NAMESPACE,
} from "../../shared/protocol.ts";
import type { CreatedSite, Overview, SiteDetail } from "../../shared/types.ts";
import { callSite, SiteRequestError } from "../sites/client.ts";
import { getCredentials, getSite, listComments, listSites, listUpdates } from "../sites/store.ts";
import { syncSite } from "../sites/sync.ts";
import { requireSameOrigin } from "./csrf.ts";

type AppContext = Context<{ Bindings: Env }>;

export const api = new Hono<{ Bindings: Env }>();
api.use("*", requireSameOrigin);

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
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2000),
});

api.post("/sites", async (c) => {
  const parsed = siteInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Enter a name and a URL" }, 400);
  const url = normalizeSiteUrl(parsed.data.url);
  if (!url) return c.json({ error: "Enter the site's public https:// address" }, 400);

  const existing = await c.env.DB.prepare("SELECT id FROM sites WHERE url = ?").bind(url).first<{ id: number }>();
  if (existing) return c.json({ error: "This site is already in Presser", id: existing.id }, 409);

  const secret = randomToken(32);
  const row = await c.env.DB
    .prepare("INSERT INTO sites (name, url, secret) VALUES (?, ?, ?) RETURNING id")
    .bind(parsed.data.name, url, secret)
    .first<{ id: number }>();
  const site = await getSite(c.env.DB, row!.id);
  return c.json<CreatedSite>(
    { site: site!, connection_key: encodeConnectionKey({ siteId: row!.id, secret, dashboard: dashboardOrigin(c) }) },
    201,
  );
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
  const parsed = siteInput.partial().safeParse(await c.req.json().catch(() => null));
  if (!id || !parsed.success) return c.json({ error: "Invalid site" }, 400);
  const url = parsed.data.url === undefined ? undefined : normalizeSiteUrl(parsed.data.url);
  if (url === null) return c.json({ error: "Enter the site's public https:// address" }, 400);
  const result = await c.env.DB
    .prepare("UPDATE sites SET name = COALESCE(?, name), url = COALESCE(?, url) WHERE id = ?")
    .bind(parsed.data.name ?? null, url ?? null, id)
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

/** Replace the site's secret. The old Connection Key stops working at once. */
api.post("/sites/:id/connection-key", async (c) => {
  const id = siteId(c);
  if (!id) return c.json({ error: "Site not found" }, 404);
  const secret = randomToken(32);
  const result = await c.env.DB
    .prepare("UPDATE sites SET secret = ?, status = 'pending', last_error = NULL WHERE id = ?")
    .bind(secret, id)
    .run();
  if (!result.meta.changes) return c.json({ error: "Site not found" }, 404);
  return c.json({ connection_key: encodeConnectionKey({ siteId: id, secret, dashboard: dashboardOrigin(c) }) });
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

const updateAction = z.object({ kind: z.enum(["plugin", "theme"]), slug: z.string().min(1).max(300) });

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
  const site = id && (await getCredentials(c.env.DB, id));
  if (!site) return c.json({ error: "Site not found" }, 404);
  try {
    await action(site);
  } catch (error) {
    if (error instanceof SiteRequestError) return c.json({ error: error.message }, 502);
    throw error;
  }
  return c.json({ ok: true });
}

function siteId(c: AppContext): number | null {
  const id = Number(c.req.param("id"));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function dashboardOrigin(c: AppContext): string {
  return new URL(c.req.url).origin;
}
