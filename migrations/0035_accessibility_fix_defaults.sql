-- Whether a site has been given the default accessibility fixes from Settings
-- (src/worker/sites/accessibility.ts). Sites already connected keep the fixes
-- they have; only sites connected from now on get the defaults on first sync.
ALTER TABLE sites ADD COLUMN accessibility_defaults_applied INTEGER NOT NULL DEFAULT 0;
UPDATE sites SET accessibility_defaults_applied = 1;
