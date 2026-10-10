/**
 * "sync" pulls the site's state; "update" runs its next queued update.
 * Absent means sync. The link checker reads one page of the site's links
 * per "links-collect" and checks a few addresses per "links-check".
 * "performance" runs a PageSpeed Insights test the dashboard asked for.
 * "uptime" checks that a few sites answer (src/worker/sites/uptime.ts).
 * "update-check" looks at a site's home page before and after its scheduled
 * updates (src/worker/sites/update-check.ts).
 */
type SyncMessage =
  | { type?: "sync" | "update"; siteId: number }
  | { type: "resync"; siteId: number; attempt: number }
  | { type: "links-collect"; siteId: number; scanId: number; page: number }
  | { type: "links-check"; siteId: number; scanId: number }
  | { type: "performance"; siteId: number }
  | { type: "uptime"; siteIds: number[] }
  | { type: "update-check"; siteId: number; runId: number; phase: "before" | "after" };

interface Env {
  WEB_ACCESS_TEAM_DOMAIN?: string;
  WEB_ACCESS_AUD?: string;
  /** base64url of 32 random bytes; encrypts site secrets. Created by scripts/deploy.mjs. */
  SITE_SECRETS_KEY?: string;
  DB: D1Database;
  /** The built dashboard, including downloads/kontrolwp-connect-<version>.zip. */
  ASSETS: Fetcher;
  SYNC_QUEUE: Queue<SyncMessage>;
  /** Cloudflare Browser Rendering, for the regression check after scheduled updates. */
  BROWSER?: Fetcher;
}
