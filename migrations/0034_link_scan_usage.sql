-- Keep scheduled link checks inside D1's free daily limits.
-- The posts a running scan has listed so far (a JSON array of ids), so where
-- links appear is only rewritten for posts that changed, and posts that are
-- gone are dropped once the scan has listed everything.
ALTER TABLE link_scans ADD COLUMN posts_seen TEXT NOT NULL DEFAULT '[]';
-- Finds the next addresses to check without reading the ones already checked.
CREATE INDEX site_links_unchecked ON site_links (site_id, ignored, checked_scan);
-- Finds where one post's links appear.
CREATE INDEX site_link_refs_post ON site_link_refs (site_id, post_id);
