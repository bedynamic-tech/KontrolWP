-- The link checker (KontrolWP Connect 0.9.0+). One scan per site at a time:
-- the site lists its content's links, then the Worker checks each address.
CREATE TABLE link_scans (
  site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  -- Increases with every scan, so rows from an older one can be told apart.
  scan_id INTEGER NOT NULL DEFAULT 1,
  -- 'collecting' (reading the site), 'checking', 'done' or 'failed'.
  status TEXT NOT NULL,
  error TEXT,
  posts_scanned INTEGER NOT NULL DEFAULT 0,
  total_urls INTEGER NOT NULL DEFAULT 0,
  checked_urls INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  -- Last progress; a scan that stops moving is shown as stopped.
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);

-- Each address found, and what checking it found.
CREATE TABLE site_links (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  -- 'pending', 'ok', 'broken', 'unresponsive' or 'blocked'.
  status TEXT NOT NULL DEFAULT 'pending',
  http_status INTEGER,
  error TEXT,
  checked_at INTEGER,
  -- The scan that last found it in the content, and the one that last
  -- checked it. A rescan keeps showing the old result until it is checked.
  scan_id INTEGER NOT NULL,
  checked_scan INTEGER NOT NULL DEFAULT 0,
  -- The owner marked it fine; it stays out of the problem list.
  ignored INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, url)
);
CREATE INDEX site_links_status ON site_links (site_id, status);

-- Where each address appears.
CREATE TABLE site_link_refs (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  post_id INTEGER NOT NULL,
  post_title TEXT NOT NULL DEFAULT '',
  post_type TEXT NOT NULL DEFAULT '',
  permalink TEXT NOT NULL DEFAULT '',
  link_text TEXT NOT NULL DEFAULT '',
  -- 'link' or 'image'.
  kind TEXT NOT NULL DEFAULT 'link'
);
CREATE INDEX site_link_refs_url ON site_link_refs (site_id, url);
