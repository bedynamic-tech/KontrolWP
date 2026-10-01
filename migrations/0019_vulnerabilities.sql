-- Known vulnerabilities in WordPress core and in the plugins the connected
-- sites have installed, copied from the Wordfence Intelligence feed
-- (src/worker/sites/vulnerabilities.ts). One row per affected version range;
-- a site is matched against them when its Security tab opens. Each refresh
-- stamps the rows it saw and deletes the others.
CREATE TABLE vulnerabilities (
  vuln_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('core', 'plugin')),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  cve TEXT,
  cvss REAL,
  severity TEXT NOT NULL DEFAULT 'unknown',
  from_version TEXT NOT NULL DEFAULT '*',
  from_inclusive INTEGER NOT NULL DEFAULT 1,
  to_version TEXT NOT NULL DEFAULT '*',
  to_inclusive INTEGER NOT NULL DEFAULT 1,
  patched_in TEXT,
  refreshed_at INTEGER NOT NULL,
  PRIMARY KEY (vuln_id, kind, slug, from_version, to_version)
);

CREATE INDEX vulnerabilities_software ON vulnerabilities (kind, slug);
