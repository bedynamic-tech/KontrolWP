import { compareVersions, LINK_RECHECK_SINCE, LINK_UNLINK_SINCE } from "../../shared/plugin-version.ts";
import { REST_NAMESPACE } from "../../shared/protocol.ts";
import type { LinkRef, LinkScan, LinkStatus, LinkUnlinkResult, SiteLink, SiteLinks } from "../../shared/types.ts";
import { callSite, SiteRequestError, type SiteCredentials } from "./client.ts";
import { getCredentials } from "./store.ts";

/**
 * The link checker. KontrolWP Connect lists the links in the site's
 * published content a page of posts at a time; the Worker then checks each
 * address itself, a few per queue message, so no single run makes more
 * requests than Cloudflare allows and the site does no extra work.
 */

/** Posts per listing page. */
const POSTS_PER_PAGE = 50;
/** Addresses checked per queue message. */
export const URLS_PER_CHECK = 10;
const CHECK_CONCURRENCY = 5;
const CHECK_TIMEOUT_MS = 10_000;
/** Addresses kept per site, so one huge site can't run an endless scan. */
const MAX_URLS = 5000;
/** A running scan with no progress for this long has stopped (its queue messages ran out of retries). */
const STALE_AFTER = 15 * 60;
/** Links listed in the tab: problems first, then ignored ones. */
const MAX_LISTED = 1000;

const USER_AGENT = "Mozilla/5.0 (compatible; KontrolWP link checker)";

interface ScanRow {
  scan_id: number;
  status: Exclude<LinkScan["status"], "stopped">;
  error: string | null;
  posts_scanned: number;
  total_urls: number;
  checked_urls: number;
  started_at: number;
  updated_at: number;
  finished_at: number | null;
}

interface ListedPost {
  post_id: number;
  title: string;
  type: string;
  permalink: string;
  links: { url: string; text: string; kind: "link" | "image" }[];
}

interface LinksPage {
  items: ListedPost[];
  page: number;
  total_pages: number;
  total_posts: number;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function loadScan(db: D1Database, siteId: number): Promise<ScanRow | null> {
  return db.prepare("SELECT * FROM link_scans WHERE site_id = ?").bind(siteId).first<ScanRow>();
}

/**
 * Start a new scan of the site, replacing any running one. With
 * `delaySeconds` the scan waits in the queue that long first (scheduled
 * checks space sites out); its start time is set to when it begins.
 */
export async function startLinkScan(env: Env, siteId: number, now = nowSeconds(), delaySeconds = 0): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO link_scans (site_id, scan_id, status, posts_scanned, total_urls, checked_urls, started_at, updated_at)
     VALUES (?, 1, 'collecting', 0, 0, 0, ?, ?)
     ON CONFLICT (site_id) DO UPDATE SET
       scan_id = scan_id + 1, status = 'collecting', error = NULL, posts_scanned = 0, total_urls = 0,
       checked_urls = 0, started_at = excluded.started_at, updated_at = excluded.updated_at, finished_at = NULL
     RETURNING scan_id`,
  )
    .bind(siteId, now + delaySeconds, now + delaySeconds)
    .first<{ scan_id: number }>();
  const scanId = row!.scan_id;
  await env.SYNC_QUEUE.send(
    { type: "links-collect", siteId, scanId, page: 1 },
    delaySeconds ? { delaySeconds } : undefined,
  );
  return scanId;
}

/**
 * Exclude a site from broken link detection, or include it again. Excluding
 * drops its scan and every link found, which also ends a scan still queued;
 * including it leaves the Links tab ready to scan.
 */
export async function setLinksExcluded(db: D1Database, siteId: number, excluded: boolean): Promise<void> {
  await db.batch([
    db.prepare("UPDATE sites SET links_excluded = ? WHERE id = ?").bind(excluded ? 1 : 0, siteId),
    ...(excluded
      ? [
          db.prepare("DELETE FROM site_link_refs WHERE site_id = ?").bind(siteId),
          db.prepare("DELETE FROM site_links WHERE site_id = ?").bind(siteId),
          db.prepare("DELETE FROM link_scans WHERE site_id = ?").bind(siteId),
        ]
      : []),
  ]);
}

async function failScan(env: Env, siteId: number, scanId: number, error: string): Promise<void> {
  const now = nowSeconds();
  await env.DB.prepare(
    "UPDATE link_scans SET status = 'failed', error = ?, updated_at = ?, finished_at = ? WHERE site_id = ? AND scan_id = ?",
  )
    .bind(error, now, now, siteId, scanId)
    .run();
}

/** Read one page of the site's links into the database, then queue the next page or the checks. */
export async function collectLinks(env: Env, siteId: number, scanId: number, page: number): Promise<void> {
  const scan = await loadScan(env.DB, siteId);
  // A newer scan replaced this one.
  if (!scan || scan.scan_id !== scanId || scan.status !== "collecting") return;
  const site = await getCredentials(env, siteId);
  if (!site) return;

  let listing: LinksPage;
  try {
    listing = await callSite<LinksPage>(site, "POST", `${REST_NAMESPACE}/links`, { page, per_page: POSTS_PER_PAGE });
  } catch (error) {
    if (!(error instanceof SiteRequestError)) throw error;
    await failScan(
      env,
      siteId,
      scanId,
      error.status === 404 && !error.code
        ? "KontrolWP Connect on this site is too old to list links. It updates automatically; select Sync now, then scan again."
        : error.message,
    );
    return;
  }

  const items = Array.isArray(listing.items) ? listing.items : [];
  const statements: D1PreparedStatement[] = [];
  // The first page starts the list of where each link appears over.
  if (page === 1) statements.push(env.DB.prepare("DELETE FROM site_link_refs WHERE site_id = ?").bind(siteId));
  const known = await env.DB.prepare("SELECT COUNT(*) AS n FROM site_links WHERE site_id = ? AND scan_id = ?")
    .bind(siteId, scanId)
    .first<{ n: number }>();
  let room = MAX_URLS - (known?.n ?? 0);
  const added = new Set<string>();
  for (const post of items) {
    for (const link of Array.isArray(post.links) ? post.links : []) {
      const url = cleanUrl(link.url);
      if (!url) continue;
      if (!added.has(url)) {
        if (room <= 0) continue;
        added.add(url);
        room--;
        statements.push(
          env.DB.prepare(
            `INSERT INTO site_links (site_id, url, scan_id) VALUES (?, ?, ?)
             ON CONFLICT (site_id, url) DO UPDATE SET scan_id = excluded.scan_id`,
          ).bind(siteId, url, scanId),
        );
      }
      statements.push(refStatement(env.DB, siteId, url, post, link));
    }
  }
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));

  const lastPage = page >= (Number(listing.total_pages) || 0);
  const now = nowSeconds();
  await env.DB.prepare(
    "UPDATE link_scans SET posts_scanned = MIN(posts_scanned + ?, ?), updated_at = ? WHERE site_id = ? AND scan_id = ?",
  )
    .bind(POSTS_PER_PAGE, Number(listing.total_posts) || 0, now, siteId, scanId)
    .run();
  if (!lastPage) {
    await env.SYNC_QUEUE.send({ type: "links-collect", siteId, scanId, page: page + 1 });
    return;
  }

  // Every page is in: drop links no longer in the content, then check the rest
  // (ignored links stay listed but are never checked again).
  await env.DB.prepare("DELETE FROM site_links WHERE site_id = ? AND scan_id <> ?").bind(siteId, scanId).run();
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM site_links WHERE site_id = ? AND ignored = 0")
    .bind(siteId)
    .first<{ n: number }>();
  const totalUrls = total?.n ?? 0;
  await env.DB.prepare(
    `UPDATE link_scans SET status = ?, posts_scanned = ?, total_urls = ?, updated_at = ?, finished_at = ?
     WHERE site_id = ? AND scan_id = ?`,
  )
    .bind(totalUrls ? "checking" : "done", Number(listing.total_posts) || 0, totalUrls, now, totalUrls ? null : now, siteId, scanId)
    .run();
  if (totalUrls) await env.SYNC_QUEUE.send({ type: "links-check", siteId, scanId });
}

/** Check the next few unchecked addresses; returns whether more remain. */
export async function checkLinks(env: Env, siteId: number, scanId: number, fetcher: typeof fetch = fetch): Promise<boolean> {
  const scan = await loadScan(env.DB, siteId);
  if (!scan || scan.scan_id !== scanId || scan.status !== "checking") return false;
  const { results } = await env.DB.prepare(
    "SELECT url FROM site_links WHERE site_id = ? AND checked_scan < ? AND ignored = 0 ORDER BY url LIMIT ?",
  )
    .bind(siteId, scanId, URLS_PER_CHECK)
    .all<{ url: string }>();
  const urls = results.map((row) => row.url);

  const checks = await mapLimit(urls, CHECK_CONCURRENCY, (url) => checkUrl(url, fetcher));
  const now = nowSeconds();
  await env.DB.batch(
    urls.map((url, i) =>
      env.DB.prepare(
        `UPDATE site_links SET status = ?, http_status = ?, error = ?, checked_at = ?, checked_scan = ?
         WHERE site_id = ? AND url = ?`,
      ).bind(checks[i].status, checks[i].http_status, checks[i].error, now, scanId, siteId, url),
    ),
  );

  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM site_links WHERE site_id = ? AND checked_scan < ? AND ignored = 0")
    .bind(siteId, scanId)
    .first<{ n: number }>();
  const remaining = left?.n ?? 0;
  await env.DB.prepare(
    `UPDATE link_scans SET checked_urls = total_urls - ?, updated_at = ?, status = ?, finished_at = ?
     WHERE site_id = ? AND scan_id = ?`,
  )
    .bind(remaining, now, remaining ? "checking" : "done", remaining ? null : now, siteId, scanId)
    .run();
  return remaining > 0;
}

export interface LinkCheck {
  status: Exclude<LinkStatus, "pending">;
  http_status: number | null;
  error: string | null;
}

/**
 * Whether an address loads. HEAD first, since it skips the body; servers
 * that refuse HEAD get a GET. Redirects are followed to where they end.
 */
export async function checkUrl(url: string, fetcher: typeof fetch = fetch): Promise<LinkCheck> {
  let response: Response;
  try {
    response = await request(fetcher, url, "HEAD");
    if ([400, 403, 404, 405, 429, 500, 501, 503].includes(response.status)) {
      // Plenty of servers answer HEAD wrongly; a GET is the real test.
      response = await request(fetcher, url, "GET");
    }
  } catch (error) {
    return failure(error);
  }
  return classify(response.status);
}

async function request(fetcher: typeof fetch, url: string, method: "HEAD" | "GET"): Promise<Response> {
  const response = await fetcher(url, {
    method,
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,image/*,*/*;q=0.8" },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  // Only the status matters; don't download the page.
  await response.body?.cancel().catch(() => undefined);
  return response;
}

export function classify(status: number): LinkCheck {
  if (status < 400) return { status: "ok", http_status: status, error: null };
  if (status === 401 || status === 403 || status === 429) {
    return { status: "blocked", http_status: status, error: "The site refused the check, so it may work in a browser." };
  }
  // Cloudflare answers 530 when the address's domain doesn't resolve.
  if (status === 530) return { status: "broken", http_status: null, error: "The domain doesn't exist." };
  if (status >= 500) return { status: "unresponsive", http_status: status, error: "The server returned an error." };
  if (status === 404 || status === 410) return { status: "broken", http_status: status, error: "Page not found." };
  return { status: "broken", http_status: status, error: null };
}

function failure(error: unknown): LinkCheck {
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return { status: "unresponsive", http_status: null, error: `No answer within ${CHECK_TIMEOUT_MS / 1000} seconds.` };
  }
  const message = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|DNS|resolve/i.test(message)) {
    return { status: "broken", http_status: null, error: "The domain doesn't exist." };
  }
  if (/redirect/i.test(message)) return { status: "broken", http_status: null, error: "Too many redirects." };
  return { status: "unresponsive", http_status: null, error: "Could not connect." };
}

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index]);
      }
    }),
  );
  return results;
}

/** An http(s) address to check, without its fragment, or null. */
export function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || !URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  return url.href;
}

/** The Links tab's data. */
export async function listLinks(db: D1Database, siteId: number, now = nowSeconds()): Promise<SiteLinks> {
  const scan = await loadScan(db, siteId);
  const { results: countRows } = await db
    .prepare("SELECT status, ignored, COUNT(*) AS n FROM site_links WHERE site_id = ? GROUP BY status, ignored")
    .bind(siteId)
    .all<{ status: LinkStatus; ignored: number; n: number }>();
  const counts: SiteLinks["counts"] = { ok: 0, broken: 0, unresponsive: 0, blocked: 0, ignored: 0, total: 0 };
  for (const row of countRows) {
    counts.total += row.n;
    if (row.ignored) counts.ignored += row.n;
    else if (row.status !== "pending") counts[row.status] += row.n;
  }

  const { results: rows } = await db
    .prepare(
      `SELECT url, status, http_status, error, checked_at, ignored FROM site_links
       WHERE site_id = ? AND (ignored = 1 OR status IN ('broken', 'unresponsive', 'blocked'))
       ORDER BY ignored, CASE status WHEN 'broken' THEN 0 WHEN 'unresponsive' THEN 1 ELSE 2 END, url
       LIMIT ?`,
    )
    .bind(siteId, MAX_LISTED)
    .all<Omit<SiteLink, "ignored" | "refs"> & { ignored: number }>();
  const { results: refRows } = rows.length
    ? await db
        .prepare(
          `SELECT r.url, r.post_id, r.post_title, r.post_type, r.permalink, r.link_text, r.kind
           FROM site_link_refs r JOIN site_links l ON l.site_id = r.site_id AND l.url = r.url
           WHERE r.site_id = ? AND (l.ignored = 1 OR l.status IN ('broken', 'unresponsive', 'blocked'))
           ORDER BY r.post_title, r.post_id`,
        )
        .bind(siteId)
        .all<LinkRef & { url: string }>()
    : { results: [] };
  const refs = new Map<string, LinkRef[]>();
  for (const { url, ...ref } of refRows) {
    const list = refs.get(url) ?? [];
    // One row per post: the same address twice in a post is one fix.
    if (!list.some((r) => r.post_id === ref.post_id && r.kind === ref.kind)) list.push(ref);
    refs.set(url, list);
  }

  return {
    scan: scan && {
      status:
        (scan.status === "collecting" || scan.status === "checking") && now - scan.updated_at > STALE_AFTER
          ? "stopped"
          : scan.status,
      error: scan.error,
      posts_scanned: scan.posts_scanned,
      total_urls: scan.total_urls,
      checked_urls: scan.checked_urls,
      started_at: scan.started_at,
      finished_at: scan.finished_at,
    },
    counts,
    links: rows.map((row) => ({ ...row, ignored: !!row.ignored, refs: refs.get(row.url) ?? [] })),
  };
}

/**
 * Check one address again now, after it was fixed. First the site re-reads
 * the posts it was found in, so a link taken out of them leaves the list
 * instead of being checked. Returns false if the site has no such link.
 */
export async function recheckLink(env: Env, siteId: number, url: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const row = await env.DB.prepare("SELECT ignored FROM site_links WHERE site_id = ? AND url = ?")
    .bind(siteId, url)
    .first<{ ignored: number }>();
  if (!row) return false;
  // Ignored links are never checked again.
  if (row.ignored) return true;
  if (!(await stillLinked(env, siteId, url))) return true;
  const check = await checkUrl(url, fetcher);
  await env.DB.prepare("UPDATE site_links SET status = ?, http_status = ?, error = ?, checked_at = ? WHERE site_id = ? AND url = ?")
    .bind(check.status, check.http_status, check.error, nowSeconds(), siteId, url)
    .run();
  return true;
}

/**
 * Re-read the posts an address was found in and replace where their links
 * appear. Drops addresses no post links to any more; returns whether this
 * one is still in any. Sites before 0.9.2 can't list chosen posts, so the
 * answer there is always yes, as is any failure to reach the site.
 */
async function stillLinked(env: Env, siteId: number, url: string): Promise<boolean> {
  const version = await env.DB.prepare("SELECT plugin_version FROM sites WHERE id = ?")
    .bind(siteId)
    .first<{ plugin_version: string | null }>();
  if (!version?.plugin_version || compareVersions(version.plugin_version, LINK_RECHECK_SINCE) < 0) return true;
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT post_id FROM site_link_refs WHERE site_id = ? AND url = ? ORDER BY post_id LIMIT 50",
  )
    .bind(siteId, url)
    .all<{ post_id: number }>();
  const postIds = results.map((row) => row.post_id).filter((id) => id > 0);
  if (!postIds.length) return true;
  const site = await getCredentials(env, siteId);
  if (!site) return true;
  try {
    await rereadPosts(env, site, postIds);
  } catch (error) {
    if (error instanceof SiteRequestError) return true;
    throw error;
  }

  const still = await env.DB.prepare("SELECT 1 AS found FROM site_links WHERE site_id = ? AND url = ?")
    .bind(siteId, url)
    .first();
  return !!still;
}

/** Ask the site for these posts again (up to 50: D1 binds at most 100 values per statement) and replace where their links appear. */
async function rereadPosts(env: Env, site: SiteCredentials, postIds: number[]): Promise<void> {
  const siteId = site.id;
  const listing = await callSite<LinksPage>(site, "POST", `${REST_NAMESPACE}/links`, { post_ids: postIds, per_page: 100 });

  const inPosts = `site_id = ? AND post_id IN (${postIds.map(() => "?").join(", ")})`;
  const { results: before } = await env.DB.prepare(`SELECT DISTINCT url FROM site_link_refs WHERE ${inPosts}`)
    .bind(siteId, ...postIds)
    .all<{ url: string }>();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`DELETE FROM site_link_refs WHERE ${inPosts}`).bind(siteId, ...postIds),
  ];
  for (const post of Array.isArray(listing.items) ? listing.items : []) {
    // Only the posts asked about; anything else is not ours to replace.
    if (!postIds.includes(Number(post.post_id))) continue;
    for (const link of Array.isArray(post.links) ? post.links : []) {
      const linkUrl = cleanUrl(link.url);
      if (linkUrl) statements.push(refStatement(env.DB, siteId, linkUrl, post, link));
    }
  }
  // Addresses these posts linked to that no post links to any more leave the list.
  for (const { url: old } of before) {
    statements.push(
      env.DB.prepare(
        `DELETE FROM site_links WHERE site_id = ? AND url = ? AND NOT EXISTS
           (SELECT 1 FROM site_link_refs r WHERE r.site_id = site_links.site_id AND r.url = site_links.url)`,
      ).bind(siteId, old),
    );
  }
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));

}

function refStatement(db: D1Database, siteId: number, url: string, post: ListedPost, link: ListedPost["links"][number]) {
  return db
    .prepare(
      `INSERT INTO site_link_refs (site_id, url, post_id, post_title, post_type, permalink, link_text, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      siteId,
      url,
      Number(post.post_id) || 0,
      String(post.title ?? "").slice(0, 300),
      String(post.type ?? "").slice(0, 40),
      String(post.permalink ?? "").slice(0, 2048),
      String(link.text ?? "").slice(0, 200),
      link.kind === "image" ? "image" : "link",
    );
}

/** Thrown when links can't be removed on this site, phrased for the dashboard. */
export class UnlinkError extends Error {}

/**
 * Take the links to these addresses out of every post they appear in,
 * keeping the link text, then re-read those posts so the list matches.
 */
export async function unlinkLinks(env: Env, siteId: number, urls: string[]): Promise<LinkUnlinkResult> {
  const version = await env.DB.prepare("SELECT plugin_version FROM sites WHERE id = ?")
    .bind(siteId)
    .first<{ plugin_version: string | null }>();
  if (!version?.plugin_version || compareVersions(version.plugin_version, LINK_UNLINK_SINCE) < 0) {
    throw new UnlinkError(
      `Removing links needs KontrolWP Connect ${LINK_UNLINK_SINCE} or later. It updates automatically; select Sync now to check.`,
    );
  }
  const site = await getCredentials(env, siteId);
  if (!site) throw new UnlinkError("Site not found");

  const result: LinkUnlinkResult = { links_removed: 0, posts_changed: 0, buttons_kept: 0, images_kept: 0 };
  const touched = new Set<number>();
  for (let i = 0; i < urls.length; i += 50) {
    const items: { url: string; post_ids: number[] }[] = [];
    for (const url of urls.slice(i, i + 50)) {
      const { results } = await env.DB.prepare(
        `SELECT DISTINCT post_id, kind FROM site_link_refs WHERE site_id = ? AND url = ? AND post_id > 0 ORDER BY post_id`,
      )
        .bind(siteId, url)
        .all<{ post_id: number; kind: string }>();
      // Only links are removed; an image that doesn't load is left for the owner.
      if (results.some((row) => row.kind === "image")) result.images_kept++;
      const postIds = [...new Set(results.filter((row) => row.kind === "link").map((row) => row.post_id))].slice(0, 100);
      if (postIds.length) items.push({ url, post_ids: postIds });
    }
    if (!items.length) continue;
    const response = await callSite<{ results?: { posts_changed?: number; buttons_kept?: number }[] }>(
      site,
      "POST",
      `${REST_NAMESPACE}/links/unlink`,
      { items },
    );
    for (const row of Array.isArray(response.results) ? response.results : []) {
      result.posts_changed += Number(row.posts_changed) || 0;
      result.buttons_kept += Number(row.buttons_kept) || 0;
    }
    for (const item of items) for (const id of item.post_ids) touched.add(id);
  }

  const before = await countLinks(env.DB, siteId);
  const ids = [...touched];
  for (let i = 0; i < ids.length; i += 50) await rereadPosts(env, site, ids.slice(i, i + 50));
  result.links_removed = before - (await countLinks(env.DB, siteId));
  return result;
}

async function countLinks(db: D1Database, siteId: number): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM site_links WHERE site_id = ?").bind(siteId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function ignoreLink(db: D1Database, siteId: number, url: string, ignored: boolean): Promise<boolean> {
  const result = await db.prepare("UPDATE site_links SET ignored = ? WHERE site_id = ? AND url = ?")
    .bind(ignored ? 1 : 0, siteId, url)
    .run();
  return result.meta.changes > 0;
}
