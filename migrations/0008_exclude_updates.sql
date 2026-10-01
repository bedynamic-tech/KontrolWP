-- 1 when the owner excluded the site from update checks: sync skips its
-- updates and KontrolWP queues nothing for it.
ALTER TABLE sites ADD COLUMN updates_excluded INTEGER NOT NULL DEFAULT 0;
