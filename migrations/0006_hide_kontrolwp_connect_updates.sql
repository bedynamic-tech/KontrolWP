-- KontrolWP Connect updates are no longer listed; KontrolWP queues them itself
-- during sync (src/worker/sites/kontrolwp-connect.ts).
DELETE FROM site_updates WHERE slug = 'kontrolwp-connect';
