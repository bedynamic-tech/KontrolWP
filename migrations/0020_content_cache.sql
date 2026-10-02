-- Answers for a site's Posts and pages list and a static site's page list,
-- kept so the tab opens without waiting on the site (src/worker/content-cache.ts).
-- A sync, or a change made from the dashboard, deletes the site's rows.
CREATE TABLE content_cache (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  body TEXT NOT NULL,
  cached_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, kind, key)
);
