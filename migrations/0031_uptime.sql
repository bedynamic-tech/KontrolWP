-- Uptime monitoring (src/worker/sites/uptime.ts): every site's home page is
-- loaded every 15 minutes. The sites columns hold the latest answer, so lists
-- can show a site that is down; uptime_since is when it last went up or down
-- (or the first check). NULL uptime_up means not checked yet.
ALTER TABLE sites ADD COLUMN uptime_excluded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN uptime_up INTEGER;
ALTER TABLE sites ADD COLUMN uptime_since INTEGER;
ALTER TABLE sites ADD COLUMN uptime_checked_at INTEGER;

-- Every check of the last 30 days. response_ms is the time to the response
-- headers; status_code is NULL when the site did not answer at all.
CREATE TABLE uptime_checks (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  checked_at INTEGER NOT NULL,
  up INTEGER NOT NULL,
  status_code INTEGER,
  response_ms INTEGER,
  error TEXT,
  PRIMARY KEY (site_id, checked_at)
);

-- The TLS certificate each site serves, read once a day. source is 'server'
-- (from the TLS handshake) or 'ct' (Certificate Transparency logs), NULL when
-- it could not be read; error then says why. names is a JSON array.
CREATE TABLE ssl_certificates (
  site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  source TEXT,
  subject TEXT NOT NULL DEFAULT '',
  issuer TEXT NOT NULL DEFAULT '',
  valid_from INTEGER,
  expires_at INTEGER,
  names TEXT NOT NULL DEFAULT '[]',
  covers_host INTEGER,
  error TEXT
);
