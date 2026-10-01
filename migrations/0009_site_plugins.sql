-- Installed plugins per site, as KontrolWP Connect 0.6.0+ lists them, for the
-- fleet-wide Plugins page. Replaced at every sync.
CREATE TABLE site_plugins (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0,
  network_active INTEGER NOT NULL DEFAULT 0,
  protected INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, file)
);
