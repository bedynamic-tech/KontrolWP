/**
 * "sync" pulls the site's state; "update" runs its next queued update.
 * Absent means sync. The link checker reads one page of the site's links
 * per "links-collect" and checks a few addresses per "links-check".
 */
type SyncMessage =
  | { type?: "sync" | "update"; siteId: number }
  | { type: "links-collect"; siteId: number; scanId: number; page: number }
  | { type: "links-check"; siteId: number; scanId: number };

interface Env {
  WEB_ACCESS_TEAM_DOMAIN?: string;
  WEB_ACCESS_AUD?: string;
  /** base64url of 32 random bytes; encrypts site secrets. Created by scripts/deploy.mjs. */
  SITE_SECRETS_KEY?: string;
  DB: D1Database;
  /** The built dashboard, including downloads/kontrolwp-connect-<version>.zip. */
  ASSETS: Fetcher;
  SYNC_QUEUE: Queue<SyncMessage>;
}
