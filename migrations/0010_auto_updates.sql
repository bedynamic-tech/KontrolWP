-- WordPress's own auto-update settings, as of the last sync (KontrolWP Connect 0.7.0+).
-- 1 when WordPress updates the plugin automatically.
ALTER TABLE site_plugins ADD COLUMN auto_update INTEGER NOT NULL DEFAULT 0;
-- 0 when the site turns plugin auto-updates off in code.
ALTER TABLE sites ADD COLUMN plugin_auto_updates INTEGER NOT NULL DEFAULT 1;
-- Core auto-updates: 'all', 'minor' or 'off'; NULL until a sync reports it.
ALTER TABLE sites ADD COLUMN core_auto_update TEXT;
-- 1 when wp-config.php decides core auto-updates, so KontrolWP cannot change them.
ALTER TABLE sites ADD COLUMN core_auto_update_locked INTEGER NOT NULL DEFAULT 0;
