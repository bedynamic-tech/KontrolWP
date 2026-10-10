-- Previous versions (src/worker/sites/updates.ts). Before KontrolWP updates a
-- plugin or theme, KontrolWP Connect keeps the installed copy on the site; each
-- sync replaces this list of what can be put back.
CREATE TABLE site_rollbacks (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('plugin', 'theme')),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  -- The kept version, and the one installed now.
  version TEXT NOT NULL,
  current_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, kind, slug)
);

-- A revert runs through the Update Queue like an update, since WordPress
-- replaces the files the same way. One job per plugin or theme at a time.
ALTER TABLE update_jobs ADD COLUMN action TEXT NOT NULL DEFAULT 'update' CHECK (action IN ('update', 'rollback'));

-- The version the owner reverted away from. Scheduled updates skip it until a
-- newer one is out or the owner installs it by hand.
CREATE TABLE update_holds (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  slug TEXT NOT NULL,
  version TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (site_id, kind, slug)
);
