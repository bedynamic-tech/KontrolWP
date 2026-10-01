import type { PendingComment, SiteSummary, SiteUpdate } from "../../shared/types.ts";
import type { SiteCredentials } from "./client.ts";
import { SELF_UPDATE } from "./presser-connect.ts";
import { decryptSecret } from "./secrets.ts";

const SUMMARY_COLUMNS = `
  s.id, s.name, s.url, s.status, s.last_error, s.last_synced_at, s.wp_version,
  s.php_version, s.plugin_version, s.theme_name, s.icon_url, s.pending_comments, s.created_at,
  s.login_user_id, s.login_user_name,
  j.status AS self_update_status, j.version AS self_update_version, j.error AS self_update_error,
  (SELECT COUNT(*) FROM site_updates u WHERE u.site_id = s.id) AS update_count`;

const SELF_UPDATE_JOIN = `LEFT JOIN update_jobs j
  ON j.site_id = s.id AND j.kind = 'plugin' AND j.slug = '${SELF_UPDATE.slug}'`;

export async function listSites(db: D1Database): Promise<SiteSummary[]> {
  const { results } = await db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM sites s ${SELF_UPDATE_JOIN} ORDER BY s.name COLLATE NOCASE`)
    .all<SiteSummary>();
  return results;
}

export async function getSite(db: D1Database, id: number): Promise<SiteSummary | null> {
  return db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM sites s ${SELF_UPDATE_JOIN} WHERE s.id = ?`).bind(id).first<SiteSummary>();
}

/** The site's URL and decrypted secret. Throws SecretsKeyError when the key is wrong. */
export async function getCredentials(env: Env, id: number): Promise<SiteCredentials | null> {
  const row = await env.DB
    .prepare("SELECT id, url, key_id, secret FROM sites WHERE id = ?")
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
  const where = siteId === undefined ? "" : "WHERE u.site_id = ?";
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
