-- Per-site switches for features the owner does not want on a site. All on by default.
ALTER TABLE sites ADD COLUMN analytics_excluded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN security_excluded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN accessibility_excluded INTEGER NOT NULL DEFAULT 0;
