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
| Queue | `SYNC_QUEUE` | One message per site, so a slow or broken site never delays the others and unexpected failures retry. Also runs queued updates (below) and the link checker. The consumer takes one message per run: a Worker run opens at most six connections at once and queues the rest with their timeouts already running, so syncing several sites in one run made healthy sites time out. A sync that can't reach a site, or gets a 5xx, tries once more three seconds later before the site shows as unreachable. |
| Cron Trigger | | `*/15 * * * *` checks whether a sync is due and, once the Background sync interval (Settings; every hour by default) has passed since the last run, enqueues every site. |

KontrolWP only makes outbound requests to sites. Sites never call the
dashboard, so nothing needs an Access bypass, and the dashboard can sit on a
private hostname.

## The dashboard to plugin protocol

Source of truth: `src/shared/protocol.ts` and
`plugin/kontrolwp-connect/includes/class-kontrolwp-connect-auth.php`. They are
tested against each other in `tests/protocol.test.mjs`.

**Pairing.** KontrolWP Connect creates the key when it is activated: a random
key id and a random 32-byte secret for that site only. **Settings, KontrolWP
Connect** shows them as a Connection Key (`kontrolwp2.` + base64url JSON of the
key id and secret). In KontrolWP, **Add site** takes the site's address and
that key, checks both by calling `/status` before saving anything, and takes
the site's name from WordPress. The name is refreshed on every sync.

**Requests.** The dashboard calls the plugin's REST routes at
`https://site/?rest_route=/kontrolwp/v1/...` (works with or without pretty
permalinks) and signs each request with HMAC-SHA256 over:

```
kontrolwp-v1
METHOD
/kontrolwp/v1/route
unix timestamp
random nonce
sha256 hex of the body
```

Requests carry the key id in `X-KontrolWP-Key-Id`. The plugin rejects a
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
in the site's update queue; it never appears in the updates lists. It does
not wait for a sync either: the first dashboard load after a deploy that ships
a new version, and every 15-minute cron tick, queue it on each site whose last
sync reported an older version. The
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
With a `post_id` (0.9.0), the link opens that post's editor instead of the
dashboard, if the administrator can edit it; the Links tab uses this.

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

## Users across sites

Each sync stores the site's users in `site_users` and its roles in
`sites.user_roles` (sites on KontrolWP Connect 0.8.0 or later; a failed
listing keeps the last rows). A site page's Users section reads the site live
(`GET /api/sites/:id/users`) and adds, changes the role of, sends a password
reset to, or deletes its users one request at a time. The Users page reads the
stored rows from `GET /api/users` and groups them by email address, so one
person on several sites is one row that expands to each site. Its actions
(`POST /api/users/bulk`) and Add user (`POST /api/users`) call each chosen
site directly, six at a time, then sync it; a failure on one site is reported
for that user on that site and does not stop the others.

Two guards keep a site reachable. KontrolWP Connect refuses to delete or
demote a site's only administrator, and gives a deleted user's posts to the
earliest other administrator. The Worker refuses to delete or demote the
administrator Magic Login signs in as. Password resets and new-user emails
are sent by the site, so they depend on its mail setup.

## Domain

A site's Domain tab asks `GET /api/sites/:id/domain`, which looks the domain up
live from public sources; nothing is stored and no key is needed. DNS records
come from Cloudflare's DNS-over-HTTPS resolver (`cloudflare-dns.com`): A, AAAA,
CNAME, MX, NS, TXT, CAA and SOA at the registered domain, and CNAME, A and
AAAA at the site's own host when it differs. Registration comes from the
registry's RDAP service, found through IANA's bootstrap file (cached for a
day): registrar, registration, last change and expiry dates, nameservers,
DNSSEC and status codes. Without a public-suffix list, the lookup drops a
label at a time from the host until the registry knows the name, so
`www.example.co.uk` resolves to `example.co.uk`. Registries without RDAP
(some country-code domains) show DNS only, with a note. The tab warns when the
domain expires within 30 days.

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

The site page's Analytics tab (shown once Umami is connected) asks
`GET /api/sites/:id/analytics/details`, which adds Umami's other breakdowns
for the same period: entry and exit pages, countries, cities, browsers,
operating systems, devices and events, plus visitors online now from
`/websites/:id/active`. A breakdown the Umami version rejects (entry and exit
pages came in Umami 3) is left out rather than failing the page.

## Links

A site's Links tab finds broken links and images in its published content
(every public post type except media). Scan now writes a new `scan_id` to
`link_scans` and queues a `links-collect` message. Each one asks the site for
50 posts (`POST /links`) and stores every http(s) address in `site_links` and
where it appears in `site_link_refs`; the last page drops addresses no longer
in the content and queues `links-check`. Each `links-check` checks 10
addresses, five at a time, and queues the next until none are left, so one
run stays well under Cloudflare's subrequest limit and the site itself does
no checking. A check sends HEAD, then GET when a server refuses HEAD,
follows redirects, and gives up after 10 seconds:

- **Broken:** 404, 410 or any other 4xx, or a domain that does not exist.
- **Unresponsive:** a timeout, a failed connection or a 5xx.
- **Couldn't check:** 401, 403 or 429, which usually mean the other site
  blocks automated requests; they often work in a browser.

A rescan keeps the last result on each address until it is checked again.
Messages from a replaced scan are dropped by `scan_id`, and a scan with no
progress for 15 minutes shows as stopped. Owners can check one link again
after fixing it, or ignore it; ignored links are never checked again.
Every site's links are also checked on a schedule (Settings > Link checks:
every 1, 3, 5 or 7 days, 7 by default, or off) at midnight in the owner's
time zone, which the dashboard saves from the browser the first time it
loads. The first cron tick in that hour queues one scan per site on
KontrolWP Connect 0.9.0 or later, two minutes apart through the queue's
message delay, so sites are checked one after another rather than all at
once. Check again first asks the site for just the
posts the link was found in (`post_ids`, 0.9.2), so a link taken out of them
leaves the list without a full scan; older sites only re-check the address.
Remove link (0.9.3), per link or for every broken one, asks the site to
unwrap the link in each post it appears in (`POST /links/unlink`): the link
text stays, buttons are left alone since unwrapping breaks the block, and
images are not touched. Posts are saved with `wp_update_post`, so WordPress
keeps a revision to restore, then re-read so the list matches. A site keeps at most 5,000 addresses.
The Check for broken links setting in Site settings (`PUT /api/sites/:id/links-excluded`)
excludes a site: its scan and every link it found are deleted, scheduled
checks skip it, Scan now answers 409, and its Links tab says detection is off.
Including it again leaves the tab ready to scan.

## Posts and pages

The Posts and pages tab (KontrolWP Connect 0.10.0) lists a WordPress site's
posts, pages and, from 0.11.0, custom post types read live from the site (`GET /api/sites/:id/content`, which
asks the plugin's `POST /content`), 25 per page, newest first. It filters by
status (published, scheduled, draft, pending review, private), by type and
by search, and each status chip shows its count for the chosen type. Trash is
left out. The list is read-only: View opens the permalink, and Edit uses
Magic Login to open the post's editor, as on the Links tab. Nothing is stored
in D1, and static sites do not have the tab.

## Plugin routes (`kontrolwp/v1`)

| Route | Does |
| --- | --- |
| `GET /status` | Site name, WordPress, PHP and plugin versions, active theme. |
| `GET /updates` | Available core, plugin and theme updates. Refreshes stale data from WordPress.org, at most once per 12 hours for core. |
| `POST /updates/apply` | `{kind: core, plugin or theme, slug, version}`. Runs the same upgraders the Updates screen uses; core also runs the database upgrade. For core, `version` must match the offer the dashboard showed, so a site never installs a version the owner did not see. Refuses when `DISALLOW_FILE_MODS` is set. |
| `POST /self-update` | `{version, package}`. Installs the KontrolWP Connect zip the dashboard ships (base64 in the signed body, so the signature covers it) through WordPress's plugin upgrader, keeping the plugin's folder. Refuses a version that is not newer. Added in 0.4.0. |
| `GET /admins` | Users who can `manage_options`, for the Magic Login setting. Added in 0.5.0. |
| `POST /login` | `{user_id, post_id}`. A one-time `wp-login.php?action=kontrolwp_login` link for that administrator, valid for 60 seconds; with `post_id` it lands in that post's editor. Added in 0.5.0; `post_id` in 0.9.0. |
| `GET /plugins` | Installed plugins with version, author and active state, and whether file changes are allowed. Added in 0.6.0; auto-update state in 0.7.0; each plugin's icon from WordPress's last update check in 0.7.1. |
| `POST /plugins/manage` | `{plugin, action: activate, deactivate, delete, enable-auto-update or disable-auto-update}`. Delete deactivates first, then uses `delete_plugins`. KontrolWP Connect refuses to deactivate or delete itself. Added in 0.6.0; auto-update actions in 0.7.0. |
| `POST /core/auto-update` | `{mode: all, minor or off}`. Sets WordPress core auto-updates; refuses when wp-config.php decides them. Added in 0.7.0. |
| `POST /plugins/install` | `{source: wordpress.org, url or zip, slug, url or package, activate}`. Installs through `Plugin_Upgrader::install`: a WordPress.org slug resolves through `plugins_api`, a link is downloaded by the site, a zip (up to 10 MB, base64 in the signed body) is written to a temp file. Added in 0.6.0. |
| `GET /users` | Up to 2,000 users with login, email, display name, roles and registration time, the site's roles, and the total. Added in 0.8.0. |
| `POST /users/create` | `{login, email, role, first_name, last_name, password, notify}`. Adds a user through `wp_insert_user`; an empty password gets a random one, and `notify` sends WordPress's set-your-password email. Added in 0.8.0. |
| `POST /users/manage` | `{user_id, action: set-role, reset-password or delete, role}`. Refuses to demote or delete the only administrator; delete gives the user's content to the earliest other administrator. Added in 0.8.0. |
| `POST /links` | `{page, per_page, post_ids}` (up to 100). One page of published content, each post with the absolute http(s) addresses of its links and images, their link text or alt text, and the post's title, type and permalink. With `post_ids` (up to 100), just those posts, if still published. Added in 0.9.0; `post_ids` in 0.9.2. |
| `POST /content` | `{page, per_page, type: all or a post type slug, status: all, publish, future, draft, pending or private, search}`. One page of posts, pages and custom post types (newest first, up to 100 per page) with title, type, status, author, dates and permalink, the count of each status for the chosen type, the total matching, and the site's public post types with their names (custom types, 0.11.0). Read-only; trash is left out. Added in 0.10.0. |
| `POST /links/unlink` | `{items: [{url, post_ids}]}` (up to 50). Unwraps links to `url` in those published posts, keeping the text; leaves button blocks. Saves through `wp_update_post` (a revision is kept) without kses, so nothing else in the post is filtered. Returns posts changed and buttons kept per address. Added in 0.9.3. |
| `GET /comments` | Pending count and the 50 newest comments awaiting moderation. |
| `POST /comments/moderate` | `{id, action: approve, spam or trash}`. |

## Next steps worth considering

- Backups before updates, and plugin activation.
- Uptime and SSL expiry checks from the Worker.
- Notifications (email or push) when a site fails to sync or has security
  updates, reusing Mailroom's notification code.
- Multisite support.

## Static sites and Cloudflare

`sites.cf_hosted` says whether a static site is hosted on Cloudflare Workers
(chosen by the owner, off by default); only then does a sync read Cloudflare,
and only then do the Deployments tab, Worker setting and deployment routes
exist. A site hosted elsewhere never contacts Cloudflare.

`sites.kind` is `wordpress` (managed through KontrolWP Connect) or `static`
(a website on Cloudflare Workers). A static site has an empty `secret`, so
`getCredentials` returns null for it and nothing can sign a request to it;
`WORDPRESS_ONLY` routes answer 400 for it. `POST /api/sites` with
`kind: "static"` takes the address, an optional name and an optional Worker,
and refuses an address that does not answer.

`syncSite` hands a static site to `syncStaticSite` (src/worker/sites/static.ts),
which fetches the home page (any non-2xx answer or no answer marks the site
down; it also finds the icon) and, in parallel, reads the chosen Worker's
deployments and builds into `site_deployments`, replaced at every sync. A
failed Cloudflare read only sets `sites.cf_error`; the last rows stay.

Settings stores one Cloudflare API token in the `settings` table, encrypted
like the Umami secret. src/worker/cloudflare.ts reads, never writes:
`GET /accounts`, `/accounts/:id/workers/scripts` (names and tags),
`/workers/scripts/:name/deployments` (the first is live) and the Workers
Builds API (`/builds/workers/:tag/builds`, `/builds/builds/:uuid/logs`). The
Builds API needs a user token with Workers Builds Configuration; without it the
deployments still show. Build logs are read from Cloudflare when opened, one
cursor page at a time, and only for builds the site listed at its last sync.
