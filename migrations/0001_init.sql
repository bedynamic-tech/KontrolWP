-- A WordPress site the dashboard manages through Presser Connect.
-- `secret` is the HMAC key shared with the plugin through the Connection Key.
CREATE TABLE sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'error')),
  last_error TEXT,
  last_synced_at INTEGER,
  wp_version TEXT,
  php_version TEXT,
  plugin_version TEXT,
  theme_name TEXT,
  pending_comments INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- The latest available updates each site reported. Replaced on every sync.
CREATE TABLE site_updates (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('core', 'plugin', 'theme')),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  current_version TEXT NOT NULL,
  new_version TEXT NOT NULL,
  PRIMARY KEY (site_id, kind, slug)
);

-- The latest comments awaiting moderation on each site. Replaced on every sync.
CREATE TABLE site_comments (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  comment_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  author_email TEXT NOT NULL,
  content TEXT NOT NULL,
  post_title TEXT NOT NULL,
  post_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, comment_id)
);

CREATE INDEX site_comments_created ON site_comments (created_at DESC);
