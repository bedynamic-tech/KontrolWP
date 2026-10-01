# Architecture

```
 Browser ──Access──▶ KontrolWP Worker ──signed HTTPS──▶ WordPress + KontrolWP Connect
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

KontrolWP only makes outbound requests to sites. Sites never call the
dashboard, so nothing needs an Access bypass, and the dashboard can sit on a
private hostname.

## The dashboard to plugin protocol

Source of truth: `src/shared/protocol.ts` and
`plugin/presser-connect/includes/class-presser-connect-auth.php`. They are
tested against each other in `tests/protocol.test.mjs`.

**Pairing.** KontrolWP Connect creates the key when it is activated: a random
key id and a random 32-byte secret for that site only. **Settings, KontrolWP
Connect** shows them as a Connection Key (`presser2.` + base64url JSON of the
key id and secret). In KontrolWP, **Add site** takes the site's address and
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
held it. **Create a new key** in KontrolWP Connect invalidates the old one
immediately; **Replace connection key** on the site's page in KontrolWP takes
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

A site the owner excludes from update checks (Site settings on its page) is synced for its
status and comments only: KontrolWP never calls `/updates` for it, drops its
listed and queued updates, and refuses new ones. KontrolWP Connect still
updates itself there, since the exclusion covers WordPress core, plugin and
theme updates only.

## KontrolWP Connect updates

The dashboard ships the plugin it was built with (`src/shared/plugin-version.ts`,
checked against the plugin header by `tests/plugin-lint.test.mjs`). When a
sync finds a site on an older version, it queues KontrolWP Connect's own update
in the site's update queue; it never appears in the updates lists. The
dashboard is behind Access, so WordPress cannot download from it; the job
reads the zip from the Worker's static assets and sends it to `/self-update`.
A finished or failed self-update is not queued again for 6 hours, so a site
that keeps reporting the old version never loops. Sites on a version before
0.4.0 need the new zip installed by hand once; their page says so.

## Magic Login

Magic Login is on by default: sync gives a site with no chosen administrator
its first one (lowest user id, listed by `GET /admins`), Add site asks the
owner to confirm or change it, and the site page's menu changes it later.
The Magic Login button asks the site for a one-time link (`POST /login`) and
opens it in a new tab. The plugin keeps only a SHA-256 hash of the link's
token, in an option that deleting spends: the first request to delete it
signs in, any other gets an error page. A link lasts 60 seconds, and the
plugin checks again that the user is still an administrator when it is used.
Signing in goes through `wp_set_auth_cookie` and fires `wp_login`, so
activity logs record it like any other login. Two-factor plugins
that prompt on `wp_login` (Two Factor, WP 2FA) are told through their own
filters to skip that one sign-in, for that user and request only (0.6.1);
plugins that check during password authentication, such as Wordfence, never
see it. Password logins still get their two-factor prompt. Added in 0.5.0.

## Plugins across sites

Each sync stores the site's installed plugins in `site_plugins` (sites on
KontrolWP Connect 0.6.0 or later; a failed listing keeps the last rows). The
Plugins page reads them from `GET /api/plugins`, joined with each site's
offered update and update job, and groups them by plugin file. Activate,
deactivate and delete (`POST /api/plugins/bulk`) and installs
(`POST /api/plugins/install`) call each chosen site directly, six at a time,
then sync it so the page shows the result; a failure on one site is reported
for that site and does not stop the others. Updates go through each site's
update queue, as on the Overview, and skip sites excluded from updates.
KontrolWP Connect is listed but has no actions.

## Auto-updates

KontrolWP can turn WordPress's own auto-updates on and off (KontrolWP Connect
0.7.0+), using the same site options as WordPress's screens:
`auto_update_plugins` for each plugin, and `auto_update_core_major`,
`auto_update_core_minor` and `auto_update_core_dev` for core. Core has three
modes: all new versions, maintenance and security releases only (WordPress's
default), or off. `/status` reports the core mode, and `/plugins` reports each
plugin's setting; sync stores both. A site whose wp-config.php sets
`WP_AUTO_UPDATE_CORE` or `AUTOMATIC_UPDATER_DISABLED` reports core as locked,
and KontrolWP leaves it alone. The site page sets core and each plugin; the
Plugins page sets plugins across selected sites, and the Sites page's
WordPress auto-updates dialog sets core across chosen sites.

## Umami analytics

Settings stores one Umami connection in the `settings` table: Umami Cloud
with an API key (sent as a bearer token to `https://api.umami.is/v1`), or a
self-hosted Umami with a username and password (KontrolWP logs in at
`/api/auth/login` for each analytics request and sends the token the same
way). The key or password is encrypted under SITE_SECRETS_KEY, bound to the
setting's name, and never returned to the browser. Saving tests the
connection by listing websites.

A site's analytics come from the Umami website whose domain matches the
site's (ignoring `www.`), or the one the owner chose
(`sites.umami_website_id`). `GET /api/sites/:id/analytics?range=&tz=` asks
Umami for stats, pageviews by hour or day in the browser's time zone (empty
buckets filled with zero), and the top pages and referrers. It reads both
Umami 2's stats format (`{value, prev}`) and later versions' (numbers plus
`comparison`), and asks for the `path` metric, falling back to Umami 2's `url`.
Nothing is stored; the page refreshes it every five minutes.

## Plugin routes (`presser/v1`)

| Route | Does |
| --- | --- |
| `GET /status` | Site name, WordPress, PHP and plugin versions, active theme. |
| `GET /updates` | Available core, plugin and theme updates. Refreshes stale data from WordPress.org, at most once per 12 hours for core. |
| `POST /updates/apply` | `{kind: core, plugin or theme, slug, version}`. Runs the same upgraders the Updates screen uses; core also runs the database upgrade. For core, `version` must match the offer the dashboard showed, so a site never installs a version the owner did not see. Refuses when `DISALLOW_FILE_MODS` is set. |
| `POST /self-update` | `{version, package}`. Installs the KontrolWP Connect zip the dashboard ships (base64 in the signed body, so the signature covers it) through WordPress's plugin upgrader, keeping the plugin's folder. Refuses a version that is not newer. Added in 0.4.0. |
| `GET /admins` | Users who can `manage_options`, for the Magic Login setting. Added in 0.5.0. |
| `POST /login` | `{user_id}`. A one-time `wp-login.php?action=presser_login` link for that administrator, valid for 60 seconds. Added in 0.5.0. |
| `GET /plugins` | Installed plugins with version, author and active state, and whether file changes are allowed. Added in 0.6.0; auto-update state in 0.7.0; each plugin's icon from WordPress's last update check in 0.7.1. |
| `POST /plugins/manage` | `{plugin, action: activate, deactivate, delete, enable-auto-update or disable-auto-update}`. Delete deactivates first, then uses `delete_plugins`. KontrolWP Connect refuses to deactivate or delete itself. Added in 0.6.0; auto-update actions in 0.7.0. |
| `POST /core/auto-update` | `{mode: all, minor or off}`. Sets WordPress core auto-updates; refuses when wp-config.php decides them. Added in 0.7.0. |
| `POST /plugins/install` | `{source: wordpress.org, url or zip, slug, url or package, activate}`. Installs through `Plugin_Upgrader::install`: a WordPress.org slug resolves through `plugins_api`, a link is downloaded by the site, a zip (up to 10 MB, base64 in the signed body) is written to a temp file. Added in 0.6.0. |
| `GET /comments` | Pending count and the 50 newest comments awaiting moderation. |
| `POST /comments/moderate` | `{id, action: approve, spam or trash}`. |

## Next steps worth considering

- Backups before updates, and plugin activation.
- Uptime and SSL expiry checks from the Worker.
- Notifications (email or push) when a site fails to sync or has security
  updates, reusing Mailroom's notification code.
- Multisite support.
