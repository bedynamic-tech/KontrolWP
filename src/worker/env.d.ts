interface SyncMessage {
  /** "sync" pulls the site's state; "update" runs its next queued update. Absent means sync. */
  type?: "sync" | "update";
  siteId: number;
}

interface Env {
  WEB_ACCESS_TEAM_DOMAIN?: string;
  WEB_ACCESS_AUD?: string;
  /** base64url of 32 random bytes; encrypts site secrets. Created by scripts/deploy.mjs. */
  SITE_SECRETS_KEY?: string;
  DB: D1Database;
  /** The built dashboard, including downloads/presser-connect.zip. */
  ASSETS: Fetcher;
  SYNC_QUEUE: Queue<SyncMessage>;
}
