-- The site's icon as Presser Connect 0.2.1+ reports it (Settings, General,
-- Site Icon). NULL when the site has none or runs an older plugin; the
-- dashboard then tries /favicon.ico.
ALTER TABLE sites ADD COLUMN icon_url TEXT;
