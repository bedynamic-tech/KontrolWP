import { REST_NAMESPACE } from "../../shared/protocol.ts";
import type { PluginComments, PluginStatus, PluginUpdates } from "../../shared/types.ts";
import { callSite, SiteRequestError } from "./client.ts";
import { discoverIcon } from "./icons.ts";
import { queueSelfUpdate, SELF_UPDATE } from "./presser-connect.ts";
import { SecretsKeyError } from "./secrets.ts";
import { getCredentials } from "./store.ts";

export type SyncResult = { ok: true } | { ok: false; error: string };

/**
 * Pull status, available updates and pending comments from one site and
 * replace its stored snapshot. A failure is recorded on the site rather than
 * thrown, so the dashboard shows it; only unexpected errors throw.
 * `retrySelfUpdate` (Sync now) retries a failed Presser Connect update at once.
 */
export async function syncSite(
  env: Env,
  siteId: number,
  options: { retrySelfUpdate?: boolean } = {},
): Promise<SyncResult> {
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
  // What browsers show for the site; best effort, alongside the plugin calls.
  const pageIcon = discoverIcon(site.url);
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
           name = COALESCE(NULLIF(?, ''), name),
           wp_version = ?, php_version = ?, plugin_version = ?, theme_name = ?, pending_comments = ?,
           icon_url = ?
         WHERE id = ?`,
      )
      .bind(
        now,
        text(status.name).trim().slice(0, 120),
        text(status.wp_version),
        text(status.php_version),
        text(status.plugin_version),
        text(status.theme),
        Math.max(0, Math.trunc(Number(comments.pending_count) || 0)),
        (await pageIcon) ?? iconUrl(status.icon_url),
        siteId,
      ),
    env.DB.prepare("DELETE FROM site_updates WHERE site_id = ?").bind(siteId),
    env.DB.prepare("DELETE FROM site_comments WHERE site_id = ?").bind(siteId),
    // Finished updates are gone from the fresh list, so their jobs are too.
    // Presser Connect's own job stays: its start time spaces out retries.
    env.DB.prepare("DELETE FROM update_jobs WHERE site_id = ? AND status = 'done' AND slug != ?").bind(siteId, SELF_UPDATE.slug),
  ];

  const insertUpdate = env.DB.prepare(
    `INSERT OR REPLACE INTO site_updates (site_id, kind, slug, name, current_version, new_version, icon_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  if (updates.core) {
    statements.push(
      insertUpdate.bind(
        siteId, "core", "wordpress", "WordPress", text(updates.core.current), text(updates.core.new_version),
        iconUrl(updates.core.icon_url),
      ),
    );
  }
  for (const [kind, items] of [["plugin", updates.plugins], ["theme", updates.themes]] as const) {
    for (const item of (items ?? []).slice(0, 500)) {
      statements.push(
        insertUpdate.bind(
          siteId, kind, text(item.slug), text(item.name), text(item.current_version), text(item.new_version),
          iconUrl(item.icon_url),
        ),
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
        webUrl(comment.post_url),
        Number.isFinite(created) ? Math.floor(created / 1000) : now,
      ),
    );
  }

  await env.DB.batch(statements);
  // Presser Connect's own update comes from this dashboard and runs by itself.
  await queueSelfUpdate(env, siteId, text(status.plugin_version), options.retrySelfUpdate);
  return { ok: true };
}

async function recordError(env: Env, siteId: number, message: string): Promise<void> {
  await env.DB.prepare("UPDATE sites SET status = 'error', last_error = ? WHERE id = ?").bind(message, siteId).run();
}

/** Keep only an https icon URL; the browser loads it straight from the site. */
function iconUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** Keep only an http(s) link, so a site can never hand the dashboard a script URL. */
function webUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    return ["https:", "http:"].includes(new URL(value).protocol) ? value : "";
  } catch {
    return "";
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/**
 * Queue one sync per site; called by the cron trigger. Sites with updates
 * still waiting also get an update message, in case their queue stalled.
 */
export async function enqueueAllSites(env: Env): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id FROM sites").all<{ id: number }>();
  const { results: waiting } = await env.DB
    .prepare("SELECT DISTINCT site_id FROM update_jobs WHERE status IN ('queued', 'running')")
    .all<{ site_id: number }>();
  const messages: MessageSendRequest<SyncMessage>[] = [
    ...results.map(({ id }) => ({ body: { type: "sync" as const, siteId: id } })),
    ...waiting.map(({ site_id }) => ({ body: { type: "update" as const, siteId: site_id } })),
  ];
  for (let i = 0; i < messages.length; i += 100) {
    await env.SYNC_QUEUE.sendBatch(messages.slice(i, i + 100));
  }
}
