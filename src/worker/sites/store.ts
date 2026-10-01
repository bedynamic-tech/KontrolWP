import { compareVersions, PLUGIN_MANAGEMENT_SINCE, USER_MANAGEMENT_SINCE } from "../../shared/plugin-version.ts";
import type { SiteDeployment, FleetLinks, FleetPlugin, FleetPlugins, FleetUser, FleetUsers, PendingComment, SiteSummary, SiteUpdate, UserRole } from "../../shared/types.ts";
import type { SiteCredentials } from "./client.ts";
import { SELF_UPDATE } from "./kontrolwp-connect.ts";
import { decryptSecret } from "./secrets.ts";

const SUMMARY_COLUMNS = `
  s.id, s.kind, s.name, s.url, s.status, s.last_error, s.last_synced_at, s.wp_version,
  s.php_version, s.plugin_version, s.theme_name, s.icon_url, s.pending_comments, s.created_at,
  s.login_user_id, s.login_user_name, s.updates_excluded,
  s.core_auto_update, s.core_auto_update_locked, s.plugin_auto_updates, s.umami_website_id,
  s.cf_account_id, s.cf_worker, s.cf_error,
  (SELECT MAX(d.created_at) FROM site_deployments d WHERE d.site_id = s.id AND d.type = 'deployment') AS last_deployed_at,
  j.status AS self_update_status, j.version AS self_update_version, j.error AS self_update_error,
  (SELECT COUNT(*) FROM site_updates u WHERE u.site_id = s.id) AS update_count`;

const SELF_UPDATE_JOIN = `LEFT JOIN update_jobs j
  ON j.site_id = s.id AND j.kind = 'plugin' AND j.slug = '${SELF_UPDATE.slug}'`;

export async function listSites(db: D1Database): Promise<SiteSummary[]> {
  const { results } = await db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM sites s ${SELF_UPDATE_JOIN} ORDER BY s.name COLLATE NOCASE`)
    .all<SiteRow>();
  return results.map(summary);
}

export async function getSite(db: D1Database, id: number): Promise<SiteSummary | null> {
  const row = await db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM sites s ${SELF_UPDATE_JOIN} WHERE s.id = ?`)
    .bind(id)
    .first<SiteRow>();
  return row && summary(row);
}

type SiteFlag = "updates_excluded" | "core_auto_update_locked" | "plugin_auto_updates";
type SiteRow = Omit<SiteSummary, SiteFlag> & Record<SiteFlag, number>;

const summary = (row: SiteRow): SiteSummary => ({
  ...row,
  updates_excluded: Boolean(row.updates_excluded),
  core_auto_update_locked: Boolean(row.core_auto_update_locked),
  plugin_auto_updates: Boolean(row.plugin_auto_updates),
});

/** The site's URL and decrypted secret. Throws SecretsKeyError when the key is wrong. */
export async function getCredentials(env: Env, id: number): Promise<SiteCredentials | null> {
  const row = await env.DB
    .prepare("SELECT id, url, key_id, secret FROM sites WHERE id = ? AND kind = 'wordpress'")
    .bind(id)
    .first<{ id: number; url: string; key_id: string | null; secret: string }>();
  if (!row) return null;
  return {
    id: row.id,
    url: row.url,
    // Sites added before 0.2 have no key id and must be reconnected.
    keyId: row.key_id ?? "",
    secret: await decryptSecret(env.SITE_SECRETS_KEY, row.id, row.secret),
  };
}

/**
 * A finished update keeps its row until the sync after the site's queue
 * empties. Count it as in progress for this long, so the dashboard keeps
 * polling until that sync removes it.
 */
const SETTLE_SECONDS = 5 * 60;

export async function listUpdates(db: D1Database, siteId?: number): Promise<SiteUpdate[]> {
  // Excluded sites have no stored updates; the filter covers a sync in flight.
  const where = siteId === undefined ? "WHERE s.updates_excluded = 0" : "WHERE u.site_id = ?";
  const settle = SETTLE_SECONDS;
  const statement = db.prepare(
    `SELECT u.site_id, s.name AS site_name, s.url AS site_url, u.kind, u.slug, u.name, u.current_version, u.new_version,
            u.icon_url, j.status AS job_status, j.error AS job_error,
            (j.status IN ('queued', 'running') OR (j.status = 'done' AND j.started_at > unixepoch() - ?)) AS job_active
     FROM site_updates u JOIN sites s ON s.id = u.site_id
     LEFT JOIN update_jobs j ON j.site_id = u.site_id AND j.kind = u.kind AND j.slug = u.slug ${where}
     ORDER BY CASE u.kind WHEN 'core' THEN 0 WHEN 'plugin' THEN 1 ELSE 2 END,
              s.name COLLATE NOCASE, u.name COLLATE NOCASE`,
  );
  const { results } = await (siteId === undefined ? statement.bind(settle) : statement.bind(settle, siteId)).all<
    Omit<SiteUpdate, "job_active"> & { job_active: number | null }
  >();
  return results.map((row) => ({ ...row, job_active: Boolean(row.job_active) }));
}

export async function listComments(db: D1Database, siteId?: number, limit = 100): Promise<PendingComment[]> {
  const where = siteId === undefined ? "" : "WHERE c.site_id = ?";
  const statement = db.prepare(
    `SELECT c.site_id, s.name AS site_name, c.comment_id, c.author, c.author_email, c.content,
            c.post_title, c.post_url, c.created_at
     FROM site_comments c JOIN sites s ON s.id = c.site_id ${where}
     ORDER BY c.created_at DESC LIMIT ${limit}`,
  );
  const { results } = await (siteId === undefined ? statement : statement.bind(siteId)).all<PendingComment>();
  return results;
}

/** Broken and unresponsive links across every site, broken first. */
export async function listFleetLinks(db: D1Database, limit = 50): Promise<FleetLinks> {
  const problems = "l.ignored = 0 AND l.status IN ('broken', 'unresponsive')";
  const [{ results }, total, scanned] = await Promise.all([
    db
      .prepare(
        `SELECT l.site_id, s.name AS site_name, l.url, l.status, l.http_status, l.error, l.checked_at,
           (SELECT r.post_title FROM site_link_refs r WHERE r.site_id = l.site_id AND r.url = l.url ORDER BY r.post_title LIMIT 1) AS post_title,
           (SELECT COUNT(DISTINCT r.post_id) FROM site_link_refs r WHERE r.site_id = l.site_id AND r.url = l.url) AS post_count
         FROM site_links l JOIN sites s ON s.id = l.site_id
         WHERE ${problems}
         ORDER BY l.status = 'unresponsive', s.name COLLATE NOCASE, l.url
         LIMIT ${limit}`,
      )
      .all<FleetLinks["items"][number]>(),
    db.prepare(`SELECT COUNT(*) AS n FROM site_links l WHERE ${problems}`).first<{ n: number }>(),
    db.prepare("SELECT 1 AS found FROM link_scans WHERE finished_at IS NOT NULL LIMIT 1").first(),
  ]);
  return { total: total?.n ?? 0, scanned: !!scanned, items: results };
}

export async function listFleetPlugins(db: D1Database): Promise<FleetPlugins> {
  const [{ results }, { results: sites }] = await Promise.all([
    db
      .prepare(
        `SELECT p.site_id, s.name AS site_name, s.url AS site_url, s.icon_url AS site_icon_url, s.updates_excluded,
                s.plugin_version AS site_plugin_version, s.plugin_auto_updates AS site_plugin_auto_updates,
                p.file, p.name, p.version, p.author, p.active, p.network_active, p.protected, p.auto_update,
                u.new_version, COALESCE(NULLIF(u.icon_url, ''), NULLIF(p.icon_url, '')) AS icon_url, j.status AS job_status, j.error AS job_error
         FROM site_plugins p JOIN sites s ON s.id = p.site_id
         LEFT JOIN site_updates u ON u.site_id = p.site_id AND u.kind = 'plugin' AND u.slug = p.file
         LEFT JOIN update_jobs j ON j.site_id = p.site_id AND j.kind = 'plugin' AND j.slug = p.file
         ORDER BY p.name COLLATE NOCASE, s.name COLLATE NOCASE`,
      )
      .all<Record<string, unknown>>(),
    db.prepare("SELECT id, name, plugin_version FROM sites WHERE kind = 'wordpress' ORDER BY name COLLATE NOCASE").all<{
      id: number;
      name: string;
      plugin_version: string | null;
    }>(),
  ]);
  const flags = ["updates_excluded", "site_plugin_auto_updates", "active", "network_active", "protected", "auto_update"] as const;
  return {
    plugins: results.map((row) => {
      const plugin = { ...row } as unknown as FleetPlugin;
      for (const flag of flags) plugin[flag] = Boolean(row[flag]);
      return plugin;
    }),
    unsupported_sites: sites.filter(
      (site) => !site.plugin_version || compareVersions(site.plugin_version, PLUGIN_MANAGEMENT_SINCE) < 0,
    ),
  };
}

export async function listFleetUsers(db: D1Database): Promise<FleetUsers> {
  const [{ results }, { results: sites }] = await Promise.all([
    db
      .prepare(
        `SELECT u.site_id, s.name AS site_name, s.url AS site_url, s.icon_url AS site_icon_url,
                u.user_id, u.login, u.email, u.display_name, u.roles, u.registered,
                (s.login_user_id = u.user_id) AS magic_login
         FROM site_users u JOIN sites s ON s.id = u.site_id
         ORDER BY LOWER(COALESCE(NULLIF(u.email, ''), u.login)), s.name COLLATE NOCASE`,
      )
      .all<Record<string, unknown>>(),
    db.prepare("SELECT id, name, plugin_version, user_roles FROM sites WHERE kind = 'wordpress' ORDER BY name COLLATE NOCASE").all<{
      id: number;
      name: string;
      plugin_version: string | null;
      user_roles: string;
    }>(),
  ]);
  // Every role any site has, named as the first site that has it names it.
  const roles = new Map<string, UserRole>();
  for (const site of sites) {
    let list: UserRole[] = [];
    try {
      list = JSON.parse(site.user_roles || "[]");
    } catch {
      // A malformed list counts as none.
    }
    for (const role of Array.isArray(list) ? list : []) if (role?.slug && !roles.has(role.slug)) roles.set(role.slug, role);
  }
  return {
    users: results.map((row) => ({
      ...(row as unknown as FleetUser),
      roles: String(row.roles ?? "").split(",").filter(Boolean),
      magic_login: Boolean(row.magic_login),
    })),
    roles: [...roles.values()],
    unsupported_sites: sites
      .filter((site) => !site.plugin_version || compareVersions(site.plugin_version, USER_MANAGEMENT_SINCE) < 0)
      .map(({ id, name, plugin_version }) => ({ id, name, plugin_version })),
  };
}

const DEPLOYMENT_COLUMNS = "type, ref, created_at, status, message, author, source, branch, commit_hash";

/** A static site's deployments and builds as of the last sync, newest first. */
export async function listDeployments(db: D1Database, siteId: number): Promise<SiteDeployment[]> {
  const { results } = await db
    .prepare(`SELECT ${DEPLOYMENT_COLUMNS} FROM site_deployments WHERE site_id = ? ORDER BY created_at DESC, type`)
    .bind(siteId)
    .all<SiteDeployment>();
  return results;
}
