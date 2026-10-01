import { REST_NAMESPACE } from "../../shared/protocol.ts";
import { compareVersions, MAGIC_LOGIN_SINCE, PLUGIN_MANAGEMENT_SINCE, USER_MANAGEMENT_SINCE } from "../../shared/plugin-version.ts";
import {
  SYNC_INTERVALS,
  type CoreAutoUpdate,
  type PluginComments,
  type PluginStatus,
  type PluginUpdates,
  type SiteAdmin,
  type SitePlugins,
  type SiteUsers,
  type SyncInterval,
  type SyncSettings,
} from "../../shared/types.ts";
import { callSite, SiteRequestError, type SiteCredentials } from "./client.ts";
import { discoverIcon } from "./icons.ts";
import { queueSelfUpdate, queueSelfUpdates, SELF_UPDATE } from "./kontrolwp-connect.ts";
import { SecretsKeyError } from "./secrets.ts";
import { getCredentials } from "./store.ts";

export type SyncResult = { ok: true } | { ok: false; error: string };

/**
 * Pull status, available updates and pending comments from one site and
 * replace its stored snapshot. A failure is recorded on the site rather than
 * thrown, so the dashboard shows it; only unexpected errors throw.
 * `retrySelfUpdate` (Sync now) retries a failed KontrolWP Connect update at once.
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

  const excluded = await env.DB
    .prepare("SELECT updates_excluded FROM sites WHERE id = ?")
    .bind(siteId)
    .first<{ updates_excluded: number }>();
  const checkUpdates = !excluded?.updates_excluded;

  let status: PluginStatus;
  let updates: PluginUpdates;
  let comments: PluginComments;
  // What browsers show for the site; best effort, alongside the plugin calls.
  const pageIcon = discoverIcon(site.url);
  try {
    [status, updates, comments] = await Promise.all([
      callSite<PluginStatus>(site, "GET", `${REST_NAMESPACE}/status`),
      // An excluded site is not asked for updates at all.
      checkUpdates
        ? callSite<PluginUpdates>(site, "GET", `${REST_NAMESPACE}/updates`)
        : Promise.resolve<PluginUpdates>({ core: null, plugins: [], themes: [] }),
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
           icon_url = ?,
           core_auto_update = COALESCE(?, core_auto_update), core_auto_update_locked = COALESCE(?, core_auto_update_locked)
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
        ...coreAutoUpdate(status),
        siteId,
      ),
    env.DB.prepare("DELETE FROM site_updates WHERE site_id = ?").bind(siteId),
    env.DB.prepare("DELETE FROM site_comments WHERE site_id = ?").bind(siteId),
    // Finished updates are gone from the fresh list, so their jobs are too.
    // KontrolWP Connect's own job stays: its start time spaces out retries.
    env.DB.prepare("DELETE FROM update_jobs WHERE site_id = ? AND status = 'done' AND slug != ?").bind(siteId, SELF_UPDATE.slug),
  ];

  const insertUpdate = env.DB.prepare(
    `INSERT OR REPLACE INTO site_updates (site_id, kind, slug, name, current_version, new_version, icon_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  // An offer of the version already installed is stale data from the site
  // (KontrolWP Connect before 0.5.1 could report one after a core update).
  if (updates.core && text(updates.core.new_version) !== text(updates.core.current)) {
    statements.push(
      insertUpdate.bind(
        siteId, "core", "wordpress", "WordPress", text(updates.core.current), text(updates.core.new_version),
        iconUrl(updates.core.icon_url),
      ),
    );
  }
  for (const [kind, items] of [["plugin", updates.plugins], ["theme", updates.themes]] as const) {
    for (const item of (items ?? []).slice(0, 500)) {
      if (text(item.new_version) === text(item.current_version)) continue;
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
  await chooseMagicLoginUser(env, site, text(status.plugin_version));
  await storePlugins(env, site, text(status.plugin_version));
  await storeUsers(env, site, text(status.plugin_version));
  // KontrolWP Connect's own update comes from this dashboard and runs by itself,
  // even on a site excluded from update checks.
  await queueSelfUpdate(env, siteId, text(status.plugin_version), options.retrySelfUpdate);
  return { ok: true };
}

/**
 * Keep the site's installed plugins for the Plugins page. Best effort: when
 * the list cannot be read, the last one stays.
 */
/** Core auto-update mode and lock from /status, or nulls to keep the stored ones (before 0.7.0). */
export function coreAutoUpdate(status: Pick<PluginStatus, "core_auto_update">): [CoreAutoUpdate | null, number | null] {
  const mode = status.core_auto_update?.mode;
  if (mode !== "all" && mode !== "minor" && mode !== "off") return [null, null];
  return [mode, status.core_auto_update?.locked ? 1 : 0];
}

async function storePlugins(env: Env, site: SiteCredentials, pluginVersion: string): Promise<void> {
  if (!pluginVersion || compareVersions(pluginVersion, PLUGIN_MANAGEMENT_SINCE) < 0) return;
  let list: SitePlugins;
  try {
    list = await callSite<SitePlugins>(site, "GET", `${REST_NAMESPACE}/plugins`);
  } catch (error) {
    if (error instanceof SiteRequestError) return;
    throw error;
  }
  const insert = env.DB.prepare(
    `INSERT OR REPLACE INTO site_plugins (site_id, file, name, version, author, active, network_active, protected, auto_update, icon_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const plugins = (Array.isArray(list.plugins) ? list.plugins : []).slice(0, 500).filter((p) => text(p.file));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM site_plugins WHERE site_id = ?").bind(site.id),
    ...plugins.map((p) =>
      insert.bind(
        site.id,
        text(p.file).slice(0, 300),
        text(p.name).slice(0, 200) || text(p.file),
        text(p.version).slice(0, 40),
        text(p.author).slice(0, 200),
        p.active ? 1 : 0,
        p.network_active ? 1 : 0,
        p.protected ? 1 : 0,
        p.auto_update ? 1 : 0,
        iconUrl(p.icon_url) ?? "",
      ),
    ),
    env.DB.prepare("UPDATE sites SET plugin_auto_updates = ? WHERE id = ?").bind(list.auto_updates === false ? 0 : 1, site.id),
  ]);
}

/**
 * Keep the site's users and roles for the Users page. Best effort: when the
 * list cannot be read, the last one stays.
 */
async function storeUsers(env: Env, site: SiteCredentials, pluginVersion: string): Promise<void> {
  if (!pluginVersion || compareVersions(pluginVersion, USER_MANAGEMENT_SINCE) < 0) return;
  let list: SiteUsers;
  try {
    list = await callSite<SiteUsers>(site, "GET", `${REST_NAMESPACE}/users`);
  } catch (error) {
    if (error instanceof SiteRequestError) return;
    throw error;
  }
  const insert = env.DB.prepare(
    `INSERT OR REPLACE INTO site_users (site_id, user_id, login, email, display_name, roles, registered)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const users = (Array.isArray(list.users) ? list.users : [])
    .filter((user) => Number.isSafeInteger(user.id) && user.id > 0 && text(user.login))
    .slice(0, 2000);
  const roles = (Array.isArray(list.roles) ? list.roles : [])
    .filter((role) => text(role.slug))
    .slice(0, 100)
    .map((role) => ({ slug: text(role.slug).slice(0, 100), name: text(role.name).slice(0, 100) || text(role.slug) }));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM site_users WHERE site_id = ?").bind(site.id),
    ...users.map((user) =>
      insert.bind(
        site.id,
        user.id,
        text(user.login).slice(0, 120),
        text(user.email).slice(0, 200),
        text(user.display_name).slice(0, 200),
        (Array.isArray(user.roles) ? user.roles : []).map((role) => text(role).slice(0, 100)).join(","),
        Math.max(0, Math.trunc(Number(user.registered) || 0)),
      ),
    ),
    env.DB.prepare("UPDATE sites SET user_roles = ? WHERE id = ?").bind(JSON.stringify(roles), site.id),
  ]);
}

/**
 * Magic Login is on by default: a site without a chosen administrator gets
 * its first one (the lowest user id). Best effort; the owner can change it.
 */
async function chooseMagicLoginUser(env: Env, site: SiteCredentials, pluginVersion: string): Promise<void> {
  if (!pluginVersion || compareVersions(pluginVersion, MAGIC_LOGIN_SINCE) < 0) return;
  const row = await env.DB.prepare("SELECT login_user_id FROM sites WHERE id = ?").bind(site.id).first<{ login_user_id: number | null }>();
  if (!row || row.login_user_id) return;
  let admins: SiteAdmin[];
  try {
    ({ admins } = await callSite<{ admins: SiteAdmin[] }>(site, "GET", `${REST_NAMESPACE}/admins`));
  } catch (error) {
    if (error instanceof SiteRequestError) return;
    throw error;
  }
  const first = (Array.isArray(admins) ? admins : [])
    .filter((admin) => Number.isSafeInteger(admin.id) && admin.id > 0)
    .sort((a, b) => a.id - b.id)[0];
  if (!first) return;
  await env.DB
    .prepare("UPDATE sites SET login_user_id = ?, login_user_name = ? WHERE id = ? AND login_user_id IS NULL")
    .bind(first.id, text(first.display_name || first.login).slice(0, 120), site.id)
    .run();
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

export const DEFAULT_SYNC_INTERVAL: SyncInterval = 60;

export async function loadSyncSettings(env: Env): Promise<SyncSettings> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE name = 'sync'").first<{ value: string }>();
  try {
    const value = row ? (JSON.parse(row.value) as Partial<SyncSettings>) : {};
    const interval = SYNC_INTERVALS.find((minutes) => minutes === value.interval_minutes) ?? DEFAULT_SYNC_INTERVAL;
    return { interval_minutes: interval };
  } catch {
    return { interval_minutes: DEFAULT_SYNC_INTERVAL };
  }
}

/**
 * Called by the cron trigger every 15 minutes: syncs every site once the
 * Background sync interval has passed since the last run. A couple of
 * minutes' slack keeps a run that started late from skipping a tick.
 */
export async function runScheduledSync(env: Env, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  // A new KontrolWP Connect never waits for the full sync.
  await queueSelfUpdates(env);
  const { interval_minutes } = await loadSyncSettings(env);
  const last = await env.DB.prepare("SELECT value FROM settings WHERE name = 'sync_last_run'").first<{ value: string }>();
  if (last && now - Number(last.value) < interval_minutes * 60 - 120) return false;
  await env.DB.prepare("INSERT OR REPLACE INTO settings (name, value) VALUES ('sync_last_run', ?)").bind(String(now)).run();
  await enqueueAllSites(env);
  return true;
}

/**
 * Queue one sync per site; called by the scheduled sync. Sites with updates
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
