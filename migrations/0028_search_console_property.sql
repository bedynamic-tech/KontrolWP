-- The Search Console property the owner chose for a site (a URL prefix or sc-domain:); NULL matches by the site's domain.
ALTER TABLE sites ADD COLUMN gsc_property TEXT;
