# Architecture

```
 Browser ──Access──▶ Presser Worker ──signed HTTPS──▶ WordPress + Presser Connect
                      │  React SPA (static assets)
                      │  Hono API  /api/*
                      │  Cron: every 6 h ─▶ Queue ─▶ sync one site
                      └─ D1: sites, updates, comments
```

## Cloudflare pieces

| Piece | Binding | Purpose |
| --- | --- | --- |
| Worker + static assets | | Serves the React dashboard and the `/api/*` routes, one Worker like Mailroom. |
| Cloudflare Access | | Protects the whole Worker. `requireWebAccess` also verifies the `Cf-Access-Jwt-Assertion` JWT on every API call, so a misconfigured route still fails closed. |
| D1 | `DB` | Sites with their encrypted secrets, plus the latest snapshot of updates and pending comments per site. The Worker applies any migration the database is missing on its first request, recording it in Wrangler's `d1_migrations` table, so a deploy that skipped `wrangler d1 migrations apply` still works. |
| Worker secret | `SITE_SECRETS_KEY` | AES-256 key that encrypts each site's secret in D1. Created by `scripts/deploy.mjs` on the first deploy and never replaced. |
| Queue | `SYNC_QUEUE` | One message per site, so a slow or broken site never delays the others and unexpected failures retry. Also runs queued updates (below). |
| Cron Trigger | | `0 */6 * * *` (every 6 hours) enqueues every site. |

Presser only makes outbound requests to sites. Sites never call the
dashboard, so nothing needs an Access bypass, and the dashboard can sit on a
private hostname.

## The dashboard to plugin protocol

Source of truth: `src/shared/protocol.ts` and
`plugin/presser-connect/includes/class-presser-connect-auth.php`. They are
tested against each other in `tests/protocol.test.mjs`.

**Pairing.** Presser Connect creates the key when it is activated: a random
key id and a random 32-byte secret for that site only. **Settings, Presser
Connect** shows them as a Connection Key (`presser2.` + base64url JSON of the
key id and secret). In Presser, **Add site** takes the site's address and
that key, checks both by calling `/status` before saving anything, and takes
the site's name from WordPress. The name is refreshed on every sync.

**Requests.** The dashboard calls the plugin's REST routes at
`https://site/?rest_route=/presser/v1/...` (works with or without pretty
permalinks) and signs each request with HMAC-SHA256 over:

```
presser-v1
METHOD
/presser/v1/route
unix timestamp
random nonce
sha256 hex of the body
```

Requests carry the key id in `X-Presser-Key-Id`. The plugin rejects a
request unless the key id matches, the timestamp is
within five minutes, the signature matches (constant-time compare) and the
nonce has not been used before. Only after the signature checks out is the
nonce stored, so unsigned traffic cannot fill the store.

**Secrets at rest.** The dashboard stores each site's secret in D1
encrypted with AES-256-GCM under `SITE_SECRETS_KEY`, with the site id as
associated data so a ciphertext only opens for its own row. A copy of the
database alone cannot sign requests to any site. The deploy script creates
the key the first time and never replaces it, because a new key would make
every stored secret unreadable; if that ever happens, each site shows a clear
error and needs a new Connection Key.

**Why a per-site shared secret.** A leaked key only exposes the one site that
held it. **Create a new key** in Presser Connect invalidates the old one
immediately; **Replace connection key** on the site's page in Presser takes
the new one. The dashboard requires `https://` site URLs and uses
`global_fetch_strictly_public`, so a site URL cannot point back into
Cloudflare or a private network.

## Updates run one at a time per site

WordPress puts a site in maintenance mode while it installs an update and
answers every other request with HTTP 503, so two updates sent together make
the second fail. **Update** in the dashboard therefore only adds a row to
`update_jobs` and sends an `update` message for the site. The consumer
(`src/worker/sites/updates.ts`) claims the site's oldest queued job in one
statement that also checks nothing else is running for that site, so two
consumers never update one site at once. After each job it sends another
message if more are queued, and syncs the site once the queue is empty.

A 503 puts the job back in the queue for 30 seconds, up to five attempts. Any
other error marks it failed with the site's message, shown on the update with
**Try again**; the next job still runs. A job left running for 15 minutes is
marked failed, and the cron restarts any site whose queue stalled.

## Presser Connect updates

The dashboard ships the plugin it was built with (`src/shared/plugin-version.ts`,
checked against the plugin header by `tests/plugin-lint.test.mjs`). When a
sync finds a site on an older version, it queues Presser Connect's own update
in the site's update queue; it never appears in the updates lists. The
dashboard is behind Access, so WordPress cannot download from it; the job
reads the zip from the Worker's static assets and sends it to `/self-update`.
A finished or failed self-update is not queued again for 6 hours, so a site
that keeps reporting the old version never loops. Sites on a version before
0.4.0 need the new zip installed by hand once; their page says so.

## Plugin routes (`presser/v1`)

| Route | Does |
| --- | --- |
| `GET /status` | Site name, WordPress, PHP and plugin versions, active theme. |
| `GET /updates` | Available core, plugin and theme updates. Refreshes stale data from WordPress.org, at most once per 12 hours for core. |
| `POST /updates/apply` | `{kind: core, plugin or theme, slug, version}`. Runs the same upgraders the Updates screen uses; core also runs the database upgrade. For core, `version` must match the offer the dashboard showed, so a site never installs a version the owner did not see. Refuses when `DISALLOW_FILE_MODS` is set. |
| `POST /self-update` | `{version, package}`. Installs the Presser Connect zip the dashboard ships (base64 in the signed body, so the signature covers it) through WordPress's plugin upgrader, keeping the plugin's folder. Refuses a version that is not newer. Added in 0.4.0. |
| `GET /comments` | Pending count and the 50 newest comments awaiting moderation. |
| `POST /comments/moderate` | `{id, action: approve, spam or trash}`. |

## Next steps worth considering

- Backups before updates, and plugin activation.
- Uptime and SSL expiry checks from the Worker.
- Notifications (email or push) when a site fails to sync or has security
  updates, reusing Mailroom's notification code.
- Multisite support.
