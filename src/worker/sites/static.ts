import { CloudflareError, fetchBuilds, fetchDeployments, loadCloudflareToken, workerTag } from "../cloudflare.ts";
import { clearContentCache } from "../content-cache.ts";
import type { SiteDeployment } from "../../shared/types.ts";
import { findIcon } from "./icons.ts";
import { decode, meta } from "./seo-audit-check.ts";
import { SecretsKeyError } from "./secrets.ts";
import type { SyncResult } from "./sync.ts";

const TIMEOUT_MS = 10_000;

/**
 * Ask a static site for its home page. A static site runs no KontrolWP
 * Connect, so answering is all KontrolWP can check: `error` says why it did
 * not, and `icon` is the https icon the page declares.
 */
export async function inspectStaticSite(url: string): Promise<{ error: string | null; icon: string | null }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "KontrolWP" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return { error: timedOut ? "The site did not respond in time" : "Could not reach the site", icon: null };
  }
  if (!response.ok) return { error: `The site answered HTTP ${response.status}`, icon: null };
  let icon: string | null = null;
  if ((response.headers.get("Content-Type") ?? "").includes("html")) {
    icon = findIcon(await response.text().catch(() => ""), response.url || url);
  }
  return { error: null, icon };
}

/** Words a home page title often starts with that are not the site's name. */
const GENERIC_TITLE = /^(home|homepage|welcome|index|main)$/i;

/** The site's own name from its home page HTML: og:site_name, application-name, or the title without its tagline. */
export function siteNameFromHtml(html: string): string {
  const named = meta(html, "og:site_name") || meta(html, "application-name");
  if (named) return named.slice(0, 120);
  const title = decode(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const parts = title
    .split(/\s+[|\u2013\u2014\u00b7:\u2022-]\s+/)
    .map((part) => part.trim())
    .filter((part) => part && !GENERIC_TITLE.test(part));
  return (parts[0] ?? title).slice(0, 120);
}

/** The name a static site gives itself, or "" when it cannot be read. */
export async function readStaticSiteName(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "KontrolWP" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok || !(response.headers.get("Content-Type") ?? "").includes("html")) return "";
    return siteNameFromHtml((await response.text()).slice(0, 200_000));
  } catch {
    return "";
  }
}

interface StaticRow {
  id: number;
  url: string;
  cf_hosted: number;
  cf_account_id: string | null;
  cf_worker: string | null;
  cf_worker_tag: string | null;
}

/**
 * Check a static site is up and, when a Cloudflare Worker is chosen, replace
 * its stored deployments and builds. Like a WordPress sync, a failure is
 * recorded on the site rather than thrown; a failed Cloudflare read does not
 * mark the site down, it only sets `cf_error`.
 */
export async function syncStaticSite(env: Env, siteId: number): Promise<SyncResult> {
  try {
    return await runStaticSync(env, siteId);
  } finally {
    // A deploy may have changed the sitemap; read it afresh.
    await clearContentCache(env.DB, siteId);
  }
}

async function runStaticSync(env: Env, siteId: number): Promise<SyncResult> {
  const site = await env.DB.prepare(
    "SELECT id, url, cf_hosted, cf_account_id, cf_worker, cf_worker_tag FROM sites WHERE id = ? AND kind = 'static'",
  )
    .bind(siteId)
    .first<StaticRow>();
  if (!site) return { ok: false, error: "Site not found" };

  const [{ error, icon }] = await Promise.all([inspectStaticSite(site.url), syncDeployments(env, site)]);
  if (error) {
    await env.DB.prepare("UPDATE sites SET status = 'error', last_error = ? WHERE id = ?").bind(error, siteId).run();
    return { ok: false, error };
  }
  await env.DB.prepare(
    "UPDATE sites SET status = 'connected', last_error = NULL, last_synced_at = ?, icon_url = COALESCE(?, icon_url) WHERE id = ?",
  )
    .bind(Math.floor(Date.now() / 1000), icon, siteId)
    .run();
  return { ok: true };
}

/** Read the chosen Worker's deployments and builds; the outcome lands in `cf_error`. */
async function syncDeployments(env: Env, site: StaticRow): Promise<void> {
  // A site hosted elsewhere is never looked up on Cloudflare.
  if (!site.cf_hosted || !site.cf_worker || !site.cf_account_id) return;
  const setError = (message: string | null) =>
    env.DB.prepare("UPDATE sites SET cf_error = ? WHERE id = ?").bind(message, site.id).run();
  try {
    const token = await loadCloudflareToken(env);
    if (!token) return void (await setError("Cloudflare is not connected. Add an API token in Settings."));

    const deployments = await fetchDeployments(token, site.cf_account_id, site.cf_worker);
    // Builds are optional: a Worker deployed with wrangler has none, and the
    // token may lack the Builds permission. Deployments still show.
    let builds: SiteDeployment[] = [];
    let buildsError: string | null = null;
    try {
      let tag = site.cf_worker_tag;
      if (!tag) {
        tag = await workerTag(token, site.cf_account_id, site.cf_worker);
        if (tag) await env.DB.prepare("UPDATE sites SET cf_worker_tag = ? WHERE id = ?").bind(tag, site.id).run();
      }
      if (tag) builds = await fetchBuilds(token, site.cf_account_id, tag);
    } catch (error) {
      if (!(error instanceof CloudflareError)) throw error;
      buildsError = error.status === 404 ? null : error.message;
    }

    const insert = env.DB.prepare(
      `INSERT OR REPLACE INTO site_deployments (site_id, type, ref, created_at, status, message, author, source, branch, commit_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    await env.DB.batch([
      env.DB.prepare("DELETE FROM site_deployments WHERE site_id = ?").bind(site.id),
      ...[...deployments, ...builds].map((row) =>
        insert.bind(
          site.id,
          row.type,
          row.ref,
          row.created_at,
          row.status,
          row.message,
          row.author,
          row.source,
          row.branch,
          row.commit_hash,
        ),
      ),
      env.DB.prepare("UPDATE sites SET cf_error = ? WHERE id = ?").bind(buildsError, site.id),
    ]);
  } catch (error) {
    if (error instanceof CloudflareError || error instanceof SecretsKeyError)
      return void (await setError(error.message));
    throw error;
  }
}
