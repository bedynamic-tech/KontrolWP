-- Each site's users, as KontrolWP Connect 0.8.0+ lists them, for the
-- fleet-wide Users page. Replaced at every sync.
CREATE TABLE site_users (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  login TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  -- Role slugs, comma separated.
  roles TEXT NOT NULL DEFAULT '',
  registered INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, user_id)
);
CREATE INDEX site_users_email ON site_users (email);

-- The site's roles as JSON [{slug, name}], for choosing one on the Users page.
ALTER TABLE sites ADD COLUMN user_roles TEXT NOT NULL DEFAULT '[]';
