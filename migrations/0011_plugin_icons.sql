-- The plugin's icon from WordPress's last update check (Presser Connect 0.7.1+), or ''.
ALTER TABLE site_plugins ADD COLUMN icon_url TEXT NOT NULL DEFAULT '';
