-- The icon for each available update, as Presser Connect 0.3+ reports it:
-- the plugin's icon from WordPress.org (or its commercial updater), the
-- theme's screenshot, or the WordPress logo for core.
ALTER TABLE site_updates ADD COLUMN icon_url TEXT;
