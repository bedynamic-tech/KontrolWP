-- Updates the owner asked for, run one at a time per site by the queue
-- consumer (src/worker/sites/updates.ts). WordPress goes into maintenance mode
-- while it updates, so a second update sent meanwhile would fail with HTTP 503.
-- `done` rows are cleared by the next sync, which also drops the update itself.
CREATE TABLE update_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('core', 'plugin', 'theme')),
  slug TEXT NOT NULL,
  version TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at INTEGER
);

-- One job per update at a time, so clicking Update twice queues it once.
CREATE UNIQUE INDEX update_jobs_one_per_update ON update_jobs (site_id, kind, slug);
CREATE INDEX update_jobs_by_status ON update_jobs (site_id, status, id);
