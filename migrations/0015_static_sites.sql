-- 'wordpress' sites run KontrolWP Connect; 'static' sites are static websites
-- hosted on Cloudflare Workers, which KontrolWP checks over HTTP and, when a
-- Cloudflare API token is saved in Settings, reads deployments and builds for.
ALTER TABLE sites ADD COLUMN kind TEXT NOT NULL DEFAULT 'wordpress';
-- The Cloudflare account and Worker (script name and immutable tag) a static
-- site is deployed from; NULL when none is chosen.
ALTER TABLE sites ADD COLUMN cf_account_id TEXT;
ALTER TABLE sites ADD COLUMN cf_worker TEXT;
ALTER TABLE sites ADD COLUMN cf_worker_tag TEXT;
-- Why the last Cloudflare read failed; NULL when it worked or none is set up.
ALTER TABLE sites ADD COLUMN cf_error TEXT;

-- A static site's recent deployments and builds, as the Cloudflare API listed
-- them at the last sync. Replaced at every sync.
-- type 'deployment': a version went live (ref is the deployment id); always
-- status 'live'. type 'build': a Workers Builds run (ref is the build uuid);
-- status is queued, building, success, failed or cancelled.
CREATE TABLE site_deployments (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deployment', 'build')),
  ref TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  commit_hash TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (site_id, type, ref)
);
CREATE INDEX site_deployments_recent ON site_deployments (site_id, created_at DESC);
