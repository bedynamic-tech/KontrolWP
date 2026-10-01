-- KontrolWP Connect 0.2 creates the Connection Key on the site. `key_id` is the
-- id the plugin gave the key; requests carry it in X-KontrolWP-Key-Id.
ALTER TABLE sites ADD COLUMN key_id TEXT;
