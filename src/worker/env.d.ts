interface SyncMessage {
  siteId: number;
}

interface Env {
  WEB_ACCESS_TEAM_DOMAIN?: string;
  WEB_ACCESS_AUD?: string;
  DB: D1Database;
  SYNC_QUEUE: Queue<SyncMessage>;
}
