-- Regression check after scheduled updates (src/worker/sites/update-check.ts).
-- Before a site's scheduled updates run, Browser Rendering loads its home page
-- and keeps a shrunk copy of the screenshot here; after them it loads the page
-- again, and reverts the updates when the page broke. One row per site.
-- status: waiting (updates running), running (checking), done.
CREATE TABLE update_checks (
  site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  run_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  before_status INTEGER,
  grid_cols INTEGER,
  grid_rows INTEGER,
  grid BLOB
);

-- What the check found for a scheduled run: passed, reverted or skipped, and why.
ALTER TABLE update_runs ADD COLUMN check_result TEXT;
ALTER TABLE update_runs ADD COLUMN check_note TEXT;
