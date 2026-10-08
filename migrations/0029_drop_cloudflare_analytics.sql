-- Cloudflare Web Analytics was removed; sites that used it go back to Umami.
UPDATE sites SET analytics_provider = 'umami', analytics_ref = NULL WHERE analytics_provider = 'cloudflare';
