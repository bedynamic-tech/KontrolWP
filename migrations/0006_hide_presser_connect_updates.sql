-- Presser Connect updates are no longer listed; Presser queues them itself
-- during sync (src/worker/sites/presser-connect.ts).
DELETE FROM site_updates WHERE slug = 'presser-connect';
