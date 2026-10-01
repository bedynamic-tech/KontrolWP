-- Dashboard settings by name, such as the Umami connection (JSON; secrets
-- inside are encrypted under SITE_SECRETS_KEY).
CREATE TABLE settings (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- The Umami website the owner chose for the site; NULL matches by domain.
ALTER TABLE sites ADD COLUMN umami_website_id TEXT;
