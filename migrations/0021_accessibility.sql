-- The latest accessibility scan of each site, and a short history of its
-- scores (src/worker/sites/accessibility.ts). A failed attempt keeps the
-- previous result and records when it was tried, so a site that cannot be
-- reached is not retried on every cron run.
CREATE TABLE accessibility_scans (
  site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  attempted_at INTEGER NOT NULL,
  scanned_at INTEGER,
  score INTEGER,
  result TEXT,
  error TEXT
);

CREATE TABLE accessibility_history (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  scanned_at INTEGER NOT NULL,
  score INTEGER NOT NULL,
  PRIMARY KEY (site_id, scanned_at)
);
