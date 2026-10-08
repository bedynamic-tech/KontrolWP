-- Where a site's analytics come from: umami (the default), cloudflare (Web Analytics) or ga4.
-- analytics_ref is the owner's choice of source within that provider (a Web Analytics site or a GA4 property);
-- NULL matches the source by the site's domain. Umami keeps its own umami_website_id.
ALTER TABLE sites ADD COLUMN analytics_provider TEXT NOT NULL DEFAULT 'umami';
ALTER TABLE sites ADD COLUMN analytics_ref TEXT;
