-- PageSpeed Insights (Lighthouse) results for each site (src/worker/sites/performance.ts):
-- the latest test of each strategy (mobile, desktop) and a short history of its scores.
-- A failed attempt keeps the previous result and records when it was tried and why it
-- failed, so a site that cannot be tested is not retried on every cron run.
-- running_since marks a test in progress, so a second one is not started on top of it.
ALTER TABLE sites ADD COLUMN performance_excluded INTEGER NOT NULL DEFAULT 0;

CREATE TABLE performance_scans (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL,
  attempted_at INTEGER NOT NULL,
  scanned_at INTEGER,
  result TEXT,
  error TEXT,
  running_since INTEGER,
  PRIMARY KEY (site_id, strategy)
);

CREATE TABLE performance_history (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL,
  scanned_at INTEGER NOT NULL,
  performance INTEGER,
  accessibility INTEGER,
  best_practices INTEGER,
  seo INTEGER,
  PRIMARY KEY (site_id, strategy, scanned_at)
);
