/**
 * Posts, pages, sitemaps and a site's plugin, admin, user and security lists are read live from the site, which is the slow
 * part of opening those tabs. The answer is kept for an hour. A sync, or a
 * change made from the dashboard, clears the site's answers so nothing stale
 * shows; an answer past the hour is only used when the site cannot be reached.
 */

const MAX_AGE = 3600;

export type CacheKind = "content" | "pages" | "plugins" | "admins" | "users" | "security" | "analytics" | "accessibility";

export async function cachedRead<T>(
  db: D1Database,
  siteId: number,
  kind: CacheKind,
  key: string,
  read: () => Promise<T>,
  options: { now?: number; maxAge?: number; staleOnError?: boolean } = {},
): Promise<T> {
  const { now = Math.floor(Date.now() / 1000), maxAge = MAX_AGE, staleOnError = true } = options;
  const row = await db
    .prepare("SELECT body, cached_at FROM content_cache WHERE site_id = ? AND kind = ? AND key = ?")
    .bind(siteId, kind, key)
    .first<{ body: string; cached_at: number }>()
    .catch(() => null);
  let stored: T | undefined;
  try {
    if (row) stored = JSON.parse(row.body) as T;
  } catch {
    // A damaged row is replaced by the read below.
  }
  if (row && stored !== undefined && now - row.cached_at < maxAge) return stored;
  try {
    const fresh = await read();
    await db
      .prepare("INSERT OR REPLACE INTO content_cache (site_id, kind, key, body, cached_at) VALUES (?, ?, ?, ?, ?)")
      .bind(siteId, kind, key, JSON.stringify(fresh), now)
      .run()
      .catch((error: unknown) => console.error("content cache", error));
    return fresh;
  } catch (error) {
    if (staleOnError && stored !== undefined) return stored;
    throw error;
  }
}

/** Forget what was kept for a site, after a sync or a change that alters its content. */
export async function clearContentCache(db: D1Database, siteId: number): Promise<void> {
  await db
    .prepare("DELETE FROM content_cache WHERE site_id = ?")
    .bind(siteId)
    .run()
    .catch((error: unknown) => console.error("content cache", error));
}

/** Forget one kind of answer for every site, after a setting that all of them depend on changes. */
export async function clearContentCacheKind(db: D1Database, kind: CacheKind): Promise<void> {
  await db
    .prepare("DELETE FROM content_cache WHERE kind = ?")
    .bind(kind)
    .run()
    .catch((error: unknown) => console.error("content cache", error));
}
