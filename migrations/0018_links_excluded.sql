-- 1 when the owner excluded the site from broken link detection: scheduled
-- scans skip it, it cannot be scanned by hand, and nothing about its links
-- shows on the Overview.
ALTER TABLE sites ADD COLUMN links_excluded INTEGER NOT NULL DEFAULT 0;
