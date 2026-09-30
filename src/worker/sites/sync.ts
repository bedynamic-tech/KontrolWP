import { REST_NAMESPACE } from "../../shared/protocol.ts";
import type { PluginComments, PluginStatus, PluginUpdates } from "../../shared/types.ts";
import { callSite, SiteRequestError } from "./client.ts";
import { SecretsKeyError } from "./secrets.ts";
import { getCredentials } from "./store.ts";

export type SyncResult = { ok: true } | { ok: false; error: string };

/**
 * Pull status, available updates and pending comments from one site and
 * replace its stored snapshot. A failure is recorded on the site rather than
 * thrown, so the dashboard shows it; only unexpected errors throw.
 */
export async function syncSite(env: Env, siteId: number): Promise<SyncResult> {
  let site;
  try {
    site = await getCredentials(env, siteId);
  } catch (error) {
    if (!(error instanceof SecretsKeyError)) throw error;
    await recordError(env, siteId, error.message);
    return { ok: false, error: error.message };
  }
  if (!site) return { ok: false, error: "Site not found" };

  let status: PluginStatus;
  let updates: PluginUpdates;
  let comments: PluginComments;
  try {
    [status, updates, comments] = await Promise.all([
      callSite<PluginStatus>(site, "GET", `${REST_NAMESPACE}/status`),
      callSite<PluginUpdates>(site, "GET", `${REST_NAMESPACE}/updates`),
      callSite<PluginComments>(site, "GET", `${REST_NAMESPACE}/comments`),
    ]);
  } catch (error) {
    if (!(error instanceof SiteRequestError)) throw error;
    await recordError(env, siteId, error.message);
    return { ok: false, error: error.message };
  }

  const now = Math.floor(Date.now() / 1000);
  const statements: D1PreparedStatement[] = [
    env.DB
      .prepare(
        `UPDATE sites SET status = 'connected', last_error = NULL, last_synced_at = ?,
           wp_version = ?, php_version = ?, plugin_version = ?, theme_name = ?, pending_comments = ?
         WHERE id = ?`,
      )
      .bind(
        now,
        text(status.wp_version),
        text(status.php_version),
        text(status.plugin_version),
        text(status.theme),
        Math.max(0, Math.trunc(Number(comments.pending_count) || 0)),
        siteId,
      ),
    env.DB.prepare("DELETE FROM site_updates WHERE site_id = ?").bind(siteId),
    env.DB.prepare("DELETE FROM site_comments WHERE site_id = ?").bind(siteId),
  ];

  const insertUpdate = env.DB.prepare(
    `INSERT OR REPLACE INTO site_updates (site_id, kind, slug, name, current_version, new_version)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  if (updates.core) {
    statements.push(
      insertUpdate.bind(siteId, "core", "wordpress", "WordPress", text(updates.core.current), text(updates.core.new_version)),
    );
  }
  for (const [kind, items] of [["plugin", updates.plugins], ["theme", updates.themes]] as const) {
    for (const item of (items ?? []).slice(0, 500)) {
      statements.push(
        insertUpdate.bind(siteId, kind, text(item.slug), text(item.name), text(item.current_version), text(item.new_version)),
      );
    }
  }

  const insertComment = env.DB.prepare(
    `INSERT OR REPLACE INTO site_comments
       (site_id, comment_id, author, author_email, content, post_title, post_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const comment of (comments.comments ?? []).slice(0, 100)) {
    const created = Date.parse(`${comment.date_gmt.replace(" ", "T")}Z`);
    statements.push(
      insertComment.bind(
        siteId,
        Math.trunc(Number(comment.id)),
        text(comment.author),
        text(comment.author_email),
        text(comment.content).slice(0, 2000),
        text(comment.post_title),
        text(comment.post_url),
        Number.isFinite(created) ? Math.floor(created / 1000) : now,
      ),
    );
  }

  await env.DB.batch(statements);
  return { ok: true };
}

async function recordError(env: Env, siteId: number, message: string): Promise<void> {
  await env.DB.prepare("UPDATE sites SET status = 'error', last_error = ? WHERE id = ?").bind(message, siteId).run();
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/** Queue one sync per site; called by the cron trigger. */
export async function enqueueAllSites(env: Env): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id FROM sites").all<{ id: number }>();
  for (let i = 0; i < results.length; i += 100) {
    await env.SYNC_QUEUE.sendBatch(results.slice(i, i + 100).map(({ id }) => ({ body: { siteId: id } })));
  }
}
