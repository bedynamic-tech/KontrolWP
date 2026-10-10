-- 1 while the site's maintenance mode is on, as KontrolWP last saw it when it
-- read or changed the setting. Only the dashboard turns it on or off.
ALTER TABLE sites ADD COLUMN maintenance INTEGER NOT NULL DEFAULT 0;
