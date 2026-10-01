-- 1 when a static site is hosted on Cloudflare Workers, so KontrolWP shows its
-- Deployments and reads its Worker from Cloudflare; a static site hosted
-- elsewhere gets none of that. A static site that already chose a Worker is hosted there.
ALTER TABLE sites ADD COLUMN cf_hosted INTEGER NOT NULL DEFAULT 0;
UPDATE sites SET cf_hosted = 1 WHERE kind = 'static' AND cf_worker IS NOT NULL;
