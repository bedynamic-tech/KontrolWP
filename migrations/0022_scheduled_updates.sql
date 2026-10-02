-- Scheduled updates (src/worker/sites/update-policy.ts). `update_policy` is a
-- site's own policy as JSON, NULL to follow the global one; `scheduled_update_run`
-- is the local date ("2026-10-03") of the site's latest scheduled run, so each
-- site runs once per due day. `update_runs` is the log of what each run queued.
ALTER TABLE sites ADD COLUMN update_policy TEXT;
ALTER TABLE sites ADD COLUMN scheduled_update_run TEXT;

CREATE TABLE update_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  ran_at INTEGER NOT NULL,
  queued INTEGER NOT NULL,
  skipped INTEGER NOT NULL,
  items TEXT NOT NULL
);
CREATE INDEX update_runs_by_time ON update_runs (ran_at);
