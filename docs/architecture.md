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
A site is often still restarting or in maintenance right after an update, and a
sync that fails leaves the finished updates listed (a successful sync is what
removes them), so a failed sync after updates sends a `resync` message, tried
again after 45 seconds, then 45 seconds longer each time, up to five syncs.

A 503 puts the job back in the queue for 30 seconds, up to five attempts. Any
other error marks it failed with the site's message, shown on the update with
**Try again**; the next job still runs. A job left running for 15 minutes is
marked failed, and the cron restarts any site whose queue stalled.

A site the owner excludes from update checks (Site settings on its page) is synced for its
status and comments only: KontrolWP never calls `/updates` for it, drops its
listed and queued updates, and refuses new ones. KontrolWP Connect still
updates itself there, since the exclusion covers WordPress core, plugin and
theme updates only.

## Scheduled updates

Settings, Scheduled updates holds the global policy (`settings` row
`update_policy`): which of WordPress, plugins and themes to update, how often
(daily, weekly or monthly), the day and the hour, in the time zone chosen under
Link checks. A site's Plugins tab (the dropdown above its plugin list) can follow it, use its own schedule
(`sites.update_policy`) or run none, and both levels can leave individual
plugins out (by plugin file such as `akismet/akismet.php`); a plugin is left out
if either level excludes it. On a site, each plugin row has a Scheduled updates
switch; switching it on also turns WordPress's own auto-updates off for that
plugin. A site's own schedule runs even while the global
policy is off.

`runScheduledUpdates` (`src/worker/sites/update-policy.ts`) runs on every 15-minute
cron tick. A site is due from the scheduled hour on a day its schedule runs, until it has
run that local day (`sites.scheduled_update_run`, claimed first so overlapping
ticks never both start it). A due site gets its waiting updates queued through
`enqueueUpdate`, plugins and themes first and WordPress last, with core pinned to
the version KontrolWP last saw, and the sites start 120 seconds apart. From there
they are ordinary update jobs, run one at a time per site. Sites excluded from
updates or in error are skipped; a site in error runs once it recovers the same
day. WordPress updates are off by default. Each run that queued or left out
anything is logged in `update_runs` (kept 90 days) and listed in Settings and in
the site's settings.

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
from public sources (no key is needed) and keeps the answer in `settings` for a
day; "Check again" sends `?refresh=1` to skip it. DNS records
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

## Cached live reads

The Posts and pages list, a site's plugin, administrator and user lists, its
security settings report (all read live from the site) and a static site's
sitemap are kept in `content_cache` for an hour, per site and
per query. A sync, a dashboard change that edits posts (removing links) or
plugins (activate, deactivate, delete, auto-update, install), users (add,
change, delete) or security fixes, or deleting the site clears that site's rows, so the next read is fresh. An answer older than an hour is
only shown when the site cannot be reached. Umami visitor numbers are kept five
minutes, never shown once old, and cleared when the Umami settings or the
site's chosen Umami website change.

## Icons

Site favicons and plugin icons load through `GET /api/icon?url=`, which fetches
public https images (at most 512 KB) and answers with a week-long
`Cache-Control`, also kept in Cloudflare's cache, so a slow site is waited on
once. A missing icon is a 404 and the page shows the first letter instead.

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
keeps a revision to restore, then re-read so the list matches. A site keeps at most 10,000 addresses; a scan that reaches that says so in the Links tab (`scan.truncated`).
From 0.25.0 the listing reads each post's content as visitors get it (`the_content` filters applied, so shortcodes, dynamic blocks and page builders such as Kadence add their links) as well as the saved content, merged. Rendering has a 12 second budget per listing page; posts after it are read from the saved content only, and the response reports how many (`unrendered`). Remove link works on the saved content, so a link that exists only in rendered output cannot be unwrapped.

Broken links on the site itself also get a Redirect button (sites with the redirects feature). It opens the redirect dialog from the Redirects tab with the link's path and query as the From address, so the To address has the same page suggestions. Links to other sites have no button.

From 0.28.0 the first page of the link listing also carries the site's header and footer links, as two pseudo-items with ids -1 (Header) and -2 (Footer) and type `area`. They come from the nav menus assigned to theme locations (a location with "footer" in its name counts as footer) and from the `<header>` and `<footer>` elements of the home page, each address once. Their refs show as Header or Footer in the Links tab with no edit button, and Remove link ignores them (it only edits posts, ids above 0).
The Enable broken link checks setting in Site settings (`PUT /api/sites/:id/links-excluded`)
excludes a site: its scan and every link it found are deleted, scheduled
checks skip it, Scan now answers 409, and its Links tab says detection is off.
Including it again leaves the tab ready to scan.

## Security

The Security tab (WordPress sites) shows known vulnerabilities and insecure settings.

Vulnerabilities come from the free Wordfence Intelligence production feed
(`https://www.wordfence.com/api/intelligence/v3/vulnerabilities/production`, since the smaller scanner feed left the CVSS scores out). The keyless v2 feed was retired in 2026 (it answers 410); v3 needs a free API key from a Wordfence account, sent as a bearer token and limited to one download every 30 minutes. Settings stores the key encrypted (`settings` row `wordfence`), checks it by downloading the feed, and nothing is downloaded without one. The feed is one
very large JSON object, so `src/worker/sites/vulnerabilities.ts` reads it as a stream, splits
out one entry at a time and keeps only WordPress core and the plugins some connected site has
installed (`site_plugins`). The rows go to the `vulnerabilities` table, one per affected
version range. The cron trigger refreshes them once a day, and an hour after a failed
attempt, and no download starts within 65 minutes of any earlier attempt (Wordfence documents 30 minutes but refused one at 31). A failure sets a wait that doubles from one hour up to six, or the `Retry-After` Wordfence sends if longer; each attempt is recorded before it starts so two runs never overlap, and rows stored in an older format (`FEED_VERSION`) are downloaded again by the scheduled job. When a download fails but earlier data exists, the tab shows that data with a quiet note. There is no refresh button, because Wordfence allows one download every 30 minutes; saving the key in Settings does the first download. A
feed that fails or comes back empty leaves the stored rows alone, and the error shows on the
tab. `GET /api/sites/:id/security` matches the site's WordPress version and plugin versions
from the last sync against those rows when the tab opens, so nothing per site is stored.
Themes are not matched because sites report only their active theme's name.

The settings findings combine what the dashboard already knows (HTTPS, a PHP version that no
longer gets fixes, a waiting core update, inactive plugins) with the plugin's `GET /security`
report (0.12.0). Sites on an older plugin show only the first group, with a note.

The Settings list on the tab is one list: `securityItems` folds each hardening fix into the finding it clears (code editor, XML-RPC, errors), so nothing shows twice, and open items come first. Hardening (plugin 0.13.0) mirrors MainWP's site fixes: directory listing, WordPress version, RSD and Windows Live Writer tags, database and PHP error display, readme.html, plus the code editor and XML-RPC. Each fix is a Fix now button that becomes a checkmark; the dashboard has no off control. Applied fixes are stored in the `kontrolwp_connect_hardening` option on the site, hooks are applied each time the plugin loads and files (index.php, readme.html) when a fix is switched on, and switching one off restores it. Only an index.php with the plugin's exact content is ever removed. `applied` is read from the live site, so the tab also shows protection something else provides. The "admin" user stays a manual fix.

## Posts and pages

The Posts and pages tab (KontrolWP Connect 0.10.0) lists a WordPress site's
posts, pages and, from 0.11.0, custom post types read live from the site (`GET /api/sites/:id/content`, which
asks the plugin's `POST /content`), 25 per page, newest first. It filters by
status (published, scheduled, draft, pending review, private), by type and
by search, and each status chip shows its count for the chosen type. Trash is
left out. The list is read-only: View opens the permalink, and Edit uses
Magic Login to open the post's editor, as on the Links tab. Nothing is stored
in D1, and static sites do not have the tab.

## Performance (PageSpeed Insights)

Every site (WordPress and static) has a Performance tab. `src/worker/sites/performance.ts`
asks Google's PageSpeed Insights API to run Lighthouse on the home page as a
phone and as a desktop. Each test keeps the four category scores (Performance,
Accessibility, Best practices, SEO), the lab measurements (FCP, LCP, TBT, CLS,
Speed Index), the Core Web Vitals from real Chrome visits (the page's own, or
the whole site's when the page has too few) and up to six of the biggest time
savings. Requests carry a `fields` list so Google answers with a few kilobytes
instead of a megabyte; if Google rejects or ignores it, the Worker asks for the
full answer from then on.

The latest result per device is in `performance_scans` and the scores per test
in `performance_history` (last 90 per device). A test takes about half a
minute, longer than a request may keep working after it answers, so Run test
claims the site (`running_since`, cleared after five minutes if lost) and sends
a `performance` message to the queue; the tab polls until it finishes. The
15-minute cron tests one site not tested in the last week, only when an API key
is saved in Settings, Integrations (stored encrypted like the Wordfence key) or
Google is connected there: without either, Google's shared quota refuses most
tests. A saved key wins; otherwise the test carries the connected account's
access token (the `openid` scope every sign-in has), so the quota is the OAuth
client's Google Cloud project, which needs the PageSpeed Insights API turned on. A failed test keeps the
previous result and shows why.

## Accessibility

Every site (WordPress and static) has an Accessibility tab. `src/worker/sites/accessibility.ts`
fetches the home page and up to four same-site pages it links to, and
`accessibility-check.ts` reads each page's HTML for what markup alone shows:
missing alt text, form labels, link and button names, frame titles, page title
and language, heading structure, a main landmark, a skip link, a viewport that
blocks zooming, positive tabindex, timed refreshes, autoplay and vague link
text. Colour contrast and anything script- or layout-dependent are not checked,
and the tab says so. `src/shared/accessibility.ts` holds the rule catalog (impact
and WCAG 2.1 criterion) and the score: 100 minus a penalty per kind of problem,
by impact and how often it occurs.

The latest result is in `accessibility_scans` and the score per scan in
`accessibility_history` (last 90). The 15-minute cron scans up to three sites not
tried in the last day, so each site is scanned daily; opening a never-scanned
tab, Scan now (at most one per 30 seconds) and switching a fix scan too.

Fixes (plugin 0.14.0, WordPress only) are `GET /accessibility` and
`POST /accessibility/fixes` on the plugin. Each is saved in the
`kontrolwp_connect_accessibility` option and applied by rewriting the finished
HTML of pages visitors see (an output buffer on `template_redirect`, never in
the admin, feeds, REST or Ajax; a page is sent unchanged if anything fails).
Nothing in the database or theme changes, so turning a fix off restores the page.
The fixes: empty alt on images with no alt attribute, field names from
placeholders, names for icon-only links (social, email, phone), titles for
iframes, zooming allowed in the viewport tag, and a skip link to the main
content. A page cache may keep serving old HTML, so a scan can still show a
problem after its fix is on; the tab says so.

## Load on the sites

Small hosts have few database connections, so everything that reads a site is
spread out. A sync asks for status, updates and comments one after another and
stops at the first failure; a failure that is 5xx is retried once after three
seconds, except WordPress's "Error establishing a database connection", which is
not asked again until the next sync and shows as plain text. The home page is
loaded for the site's icon at most once a week. The sync queue consumer runs at
most four sites at once (`max_concurrency`). Accessibility scans read three
pages one at a time with a pause, stop at the first server error, skip sites in
error, run one site per cron tick, and never in a tick that starts a sync.

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
| `GET /security` | No body. Settings worth fixing: whether errors are printed into pages (`WP_DEBUG` with `WP_DEBUG_DISPLAY`), whether the wp-admin code editor is allowed, whether a user named `admin` exists and whether XML-RPC is on. Read-only. Added in 0.12.0. |
| `GET /accessibility` | No body. Returns `{fixes: {id: {enabled, applied}}}` for the accessibility fixes. Added in 0.14.0. |
| `POST /accessibility/fixes` | `{ids: [fix ids], enabled}`. Switches accessibility fixes on or off. Ids: `image_alt`, `form_labels`, `link_names`, `frame_titles`, `viewport_zoom`, `skip_link`. Added in 0.14.0. |
| `GET /seo` | No body. Returns `{settings, conflict, site_name, tagline, home_url, discouraged}`. `conflict` names another active SEO plugin. Added in 0.15.0. |
| `POST /seo/settings` | The settings object. Cleaned and saved; returns the same as `GET /seo`. Added in 0.15.0. |
| `POST /seo/pages` | `{page, search}`. Published posts and pages with their overrides, 20 at a time: `{items: [...], total}`. Added in 0.15.0. |
| `POST /seo/redirects` | `{page, search, per_page?, export?, auto?}`. `auto` lists only automatic rules. Redirect rules, newest first: `{items: [{id, source, match_type, target, status_code, enabled, auto, hits, last_hit}], total, log_404, auto: {enabled, on_delete, target}}`. `export` returns up to 5000. Added in 0.16.0. |
| `POST /seo/redirect` | A rule `{source, match_type, target, status_code, enabled}`, plus `id` to change one. 409 when the source already exists. Added in 0.16.0. |
| `POST /seo/redirects/bulk` | `{action: enable\|disable\|delete, ids}`. Added in 0.16.0. |
| `POST /seo/redirects/import` | `{rows}`. Existing sources are skipped, bad rows reported: `{added, skipped, errors}`. Added in 0.16.0. |
| `POST /seo/redirects/settings` | `{log_404?, auto_enabled?, on_delete?, delete_target?}`; only what is sent changes. `on_delete` is `none`, `410` or `301` (which needs `delete_target`). Returns `{log_404, auto}`. The automatic fields were added in 0.18.0.|
| `POST /seo/404s`, `POST /seo/404s/clear` | `{page}` lists logged missing addresses by hits, 25 per page. Clear empties the log. Added in 0.16.0. |
| `POST /seo/migrate` | Lists installed SEO plugins that can be imported from: `{sources: [{id, name, active}]}`. Ids: `yoast`, `rankmath`, `aioseo`, `seopress`, `slimseo`. Added in 0.17.0. |
| `POST /seo/migrate/preview` | `{source}`. What an import would bring in, without changing anything. Added in 0.17.0. |
| `POST /seo/migrate/run` | `{source, settings, pages, redirects}`. Imports the chosen parts and returns counts. Only adds. Added in 0.17.0. |
| `POST /seo/migrate/deactivate` | `{source}`. Deactivates that plugin and its add-on; never deletes. Added in 0.17.0. |
| `POST /seo/tools` | No body. `{settings, conflict, public, robots_file_exists, robots_default, llms_auto, urls}`: verification codes, robots.txt and llms.txt modes and texts, and IndexNow. Added in 0.20.0. |
| `POST /seo/tools/save` | `{verify: {google, bing, yandex, baidu, pinterest}, robots_mode, robots_text, llms_mode, llms_text, indexnow}`. Refuses a robots.txt that has a bad line or blocks the whole site. Returns the same as `/seo/tools`. Added in 0.20.0. |
| `POST /snippets` | No body. `{settings: {skip_editors, snippets: [{id, name, code, location, enabled, scope, paths}]}, limits}`. Plugin 0.29.0. |
| `POST /snippets/save` | `{skip_editors, snippets: [...]}`. Names, code and addresses are checked and capped; a snippet without a usable id is given one. Answers like `/snippets`. Plugin 0.29.0. |
| `POST /update-emails` | No body. `{disabled}`. Plugin 0.30.0. |
| `POST /update-emails/save` | `{disabled}`. Answers like `/update-emails`. Plugin 0.30.0. |
| `POST /login-url` | No body. `{enabled, slug, redirect, active, locked, conflicts, login_url, default_login_url}`. Plugin 0.31.0. |
| `POST /login-url/save` | `{enabled, slug, redirect}`. A slug is checked against reserved names, existing files and posts; refused with 409 while another login-hiding plugin is active. Answers like `/login-url`. Plugin 0.31.0. |
| `POST /login-logo` | No body. `{enabled, source, size, logo_url, width, height, drawn, active, upload_url, site_logo_url, site_logo_kind}`. `logo_url` is the chosen source's logo. Plugin 0.32.0; `source` and the last three fields 0.33.0. |
| `POST /login-logo/save` | `{enabled, size, source?, image?, remove?}`. `source` is `site` (the logo set in WordPress) or `upload`. `image` is a PNG, JPEG, GIF or WebP up to 1 MB as base64, added to the media library and replacing the previous one; `remove` deletes it and turns the logo off. Answers like `/login-logo`. Plugin 0.32.0. |
| `POST /seo/content` | No body. `{settings, conflict, seo_enabled, html_support, site_icon, site_name}`: schema, breadcrumbs, link, image alt and feed footer settings. Added in 0.21.0. |
| `POST /seo/content/save` | The settings object (see `SeoContentSettings`). Returns the same as `/seo/content`. Added in 0.21.0. |
| `POST /seo/score` | `{id, seo_title?, description?, keyword?}`. The content checklist for one page, using the unsaved values when sent: `{keyword, status, checks}`. Added in 0.23.0. |
| `POST /seo/page` | `{id, seo_title?, description?, noindex?, image?}`. Saves one page's overrides; an empty value removes one. Added in 0.15.0. |
| `POST /security/fixes` | `{ids: [fix ids], enabled}`. Switches hardening fixes on or off and returns each fix's `{enabled, applied}`. Ids: `directory_listing`, `generator`, `rsd`, `wlw`, `db_errors`, `php_errors`, `readme`, `file_edit`, `xmlrpc`. Added in 0.13.0. |
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

The Deployments list shows builds only, newest first, with a Live chip, in place of Build passed, on the build the live version came from (`src/shared/deployments.ts`): the newest successful build that started no later than two minutes after the newest deployment. A live version no build explains, and a site with no builds, keep their deployment rows.

### Pages from the sitemap

A static site's Pages tab (`GET /api/sites/:id/pages`) reads the site's
sitemap live each time the tab opens, and the page caches it for five minutes.
The Worker takes the address from `robots.txt` (`Sitemap:` lines), then tries
`/sitemap.xml` and `/sitemap_index.xml`. A sitemap index is followed into up to
20 child sitemaps; `.gz` files are decompressed. Only addresses on the site's
own host (with or without `www.`) are fetched or listed, each file is capped
at 10 MB, and at most 5,000 pages are kept. Pages are listed newest `lastmod`
first and searched in the browser. Nothing is stored in D1, and a sitemap
has no page titles, so rows show the path.

### SEO health check for static sites

A static site has an SEO tab that only reads the site (`src/worker/sites/seo-audit.ts`). A check fetches the home page, up to four more pages sampled evenly from the sitemap (or the pages the home page links to when there is no sitemap), `robots.txt`, the sitemap and one made-up address, at most about 30 requests when a sitemap index has many children. `seo-audit-check.ts` reads each page's HTML for title, description, H1, canonical, noindex, viewport, social tags and structured data; `src/shared/seo-audit.ts` holds the rule catalog (impact and what to change) and the score. Titles and descriptions that several checked pages share, pages the sitemap or home page lists that answer an error, a `robots.txt` that disallows everything, a missing or unlisted sitemap and a made-up address that answers 200 are found across pages. The latest result is in `seo_scans` and the score per check in `seo_history` (last 90). The 15-minute cron checks one static site not tried in the last day (skipped on a tick that starts a sync), and opening a never-checked tab or Check now (at most one per 30 seconds) runs one. Nothing is changed on the site, so each recommendation says what to edit in the site's own files. It has no per-site switch yet, and security and accessibility checks are separate.

There is no layout setting: wide screens always use two columns and phones one. A site's Overview puts Updates and Comments left and Analytics right when Umami is connected, and the SEO tab's Settings, Content and Verification and files views (`TwoColumns.tsx`) put their sections in CSS columns balanced by height. The Pages list under Settings stays full width.

A site's Links, Code snippets, Performance, SEO, Security, Accessibility and Domain tabs sit under one Tools tab with its own row of tabs (a dropdown on phones). Each keeps its own `?tab=` value, so `?tab=links` still opens Links inside Tools, and `?tab=tools` opens the first one the site has.

## Per-site feature switches

Site settings can turn off analytics, broken link checks, security checks and accessibility checks for one site. All are on by default. The flags are `analytics_excluded`, `security_excluded` and `accessibility_excluded` on `sites` (migration 0023), set through `PUT /sites/:id/feature-excluded`, and `links_excluded` as before. A turned-off feature answers 409 on its routes, is skipped by the cron (accessibility scans, link scans, and the vulnerability feed refresh when no WordPress site has security on), and its tab is hidden. Stored analytics, security and accessibility results are kept, so turning a feature back on shows them again. Turning broken link checks off still clears that site's links.

## SEO

The SEO tab (plugin 0.15.0, WordPress only) is an Easy-mode set of basics. The settings live on the site, in the autoloaded option `kontrolwp_connect_seo`, and the per-page overrides are post meta (`_kontrolwp_seo_title`, `_kontrolwp_seo_description`, `_kontrolwp_seo_noindex`, `_kontrolwp_seo_image`). The dashboard stores nothing of its own: `src/worker/sites/seo.ts` reads and writes through the plugin routes above and keeps the answers in `content_cache` under kind `seo` (cleared when anything is saved).

When SEO is on, the plugin prints a description, canonical link and Open Graph and Twitter tags in `wp_head`, sets the document title from a template (`%title%`, `%sitename%`, `%tagline%`, `%sep%`) or the page's own title, adds `noindex` through `wp_robots` for search, author and date pages and for pages marked hidden, and can turn the core sitemap off. If Yoast SEO, Rank Math, All in One SEO, SEOPress, Slim SEO or The SEO Framework is active it prints nothing and the tab says so. WordPress's own "Discourage search engines" switch is reported but not changed. Turning SEO off, or deleting the plugin, leaves pages as WordPress renders them.

Redirects (plugin 0.16.0) have their own tables, `{prefix}kontrolwp_redirects` and `{prefix}kontrolwp_404s`, created on first use with `dbDelta`, so deactivating the plugin keeps the rules. A rule has a match type (`exact`, ignoring case and a trailing slash; `prefix`, where `$1` in the target is the rest of the path; `regex`, with `$1` to `$n` groups), a status code (301, 302, 307, 308, 410, 451) and a hit count. A small autoloaded option (`kontrolwp_connect_redirects_state`) records whether any rule or the 404 log is on, so a site with neither adds no database work to a page view. Rules run on `template_redirect` at priority 1, skip admin, REST, Ajax, cron and XML-RPC requests, keep the visitor's query string, and refuse a rule that would redirect to the address it came from. The 404 log (its own "404 log" view in the SEO tab) is opt-in, keeps at most 500 addresses, and ignores image, script and other file requests. Redirect answers are never cached by the dashboard, because hit counts change with every visit. The Redirects view in the SEO tab imports and exports CSV (columns `source,target,status_code,match_type,enabled`, read by header name when there is a header; see `src/shared/redirect-csv.ts`).

Automatic redirects (plugin 0.18.0) are off until switched on in the Redirects view, and the setting lives in the same autoloaded state option, so the hooks are only added when it is on. Rules they create have `auto = 1` (the table gains that column through `dbDelta`, `DB_VERSION` 2), show as Automatic in the list and can be filtered, edited or deleted like any other. When published content gets a new permalink (`post_updated`, comparing `get_permalink` before and after) or a term's link changes (`edit_terms` and `edited_term`), the old path gets a 301 to the new one. Earlier automatic rules that pointed at the old path are repointed at the new one, an automatic rule starting at the new path is removed, and a rule a person made for the same path is left alone, so there are no chains or loops. A hierarchical page that has children also gets an automatic prefix rule (`/old/$1` to `/new/$1`), since the children move without being saved. When published content is trashed or deleted, the setting decides: nothing (the default), a 410, or a 301 to a chosen address; the path is kept in post meta so restoring from the trash removes that rule, and so does publishing new content at the path. A hierarchical term with children gets the same prefix rule when its address changes. A deleted term follows the same delete setting as content, and the terms directly below it, which move up a level when WordPress re-parents them, get a 301 from their old address to their new one. Creating a term at an address removes an automatic rule from it. Terms deeper than the children of a deleted term, and more than 50 children, are not followed. Rules are stored as paths relative to the site's home address, as the other rules are.

Importing from another SEO plugin (plugin 0.17.0, `class-kontrolwp-connect-migrate.php`) detects Yoast SEO, Rank Math, All in One SEO, SEOPress and Slim SEO whether or not they are active, since their data stays in the database. The dashboard's Import view previews what would come across (site-wide settings, per-page titles, descriptions, hidden-from-search flags and social images, and redirections where the plugin has them), then imports the parts chosen. Title templates are converted to KontrolWP's tokens and tokens with no equivalent are dropped. Importing only adds: page values are written only where KontrolWP has none, text settings only where KontrolWP is still at its default, hiding is only switched on, redirects that already exist are skipped, and KontrolWP's SEO tags are turned on. Running it again therefore changes nothing. Deactivating the old plugin is a separate call that the worker accepts only with `confirm: true`, and deactivates rather than deletes, so the plugin and its data remain. Redirections are read for Yoast Premium, Rank Math, All in One SEO and SEOPress; Slim SEO's are not imported. The storage names each plugin uses are from their documented formats and have not been checked against live installs, so anything unrecognised is skipped, not guessed. From 0.26.0 the import also brings in focus keywords per page (Yoast, Rank Math, SEOPress and All in One SEO; the first keyword of a list), and, for Yoast, Rank Math and All in One SEO, the Twitter card type, verification codes (Google, Bing, Yandex, Baidu, Pinterest), removing the category base, the organisation or person structured data (type, name, logo and social profile links) and the breadcrumb home label and separator. Yoast and Rank Math add the content types and archives hidden from search, title and description templates by content type (only types whose template differs from the site-wide one) and switching author archives off (to a redirect). Rank Math also brings the outside-link settings and a custom robots.txt, applied only while KontrolWP is on WordPress's default. SEOPress verification codes use keys written from memory and not checked against its source. Not imported, because KontrolWP has no field for them: per-page canonical address, nofollow and other robots flags, per-page social titles, descriptions and Twitter fields, schema type per page, primary category, per-page breadcrumb title, XML sitemap choices, local business data, llms.txt and 404 logs. Settings are written into KontrolWP's SEO, content and tools options as one import: keys with a `content.` or `tools.` prefix in the preview belong to the last two.

Indexing defaults (plugin 0.19.0): attachment pages, tag pages and author pages on a one-author site are hidden from search by default, and sections can be hidden by taxonomy and content type (`hidden_taxonomies`, `hidden_types`). Whatever is hidden is also left out of the core sitemap, along with pages marked hidden, and the people sitemap goes when author pages are hidden, so the sitemap and robots rules never disagree. A site that saved its SEO settings before these existed keeps the old behaviour (`UNCHANGED_FOR_EXISTING`); only sites that never saved get the new defaults. WordPress's placeholder tagline ("Just another WordPress site") is no longer used as a description or in titles. Pages two and later of a list get "Page N" in the title and their own canonical address, and the social image falls back to the site icon. SEO itself still starts switched off, since turning it on changes what every page prints.

Verification and files (plugin 0.20.0, `class-kontrolwp-connect-seo-tools.php`) are separate from the main SEO option: small settings in the autoloaded `kontrolwp_connect_seo_tools` and the two texts in `kontrolwp_connect_seo_tools_texts`, which is not autoloaded and read only when a file is requested. Verification codes (Google, Bing, Yandex, Baidu, Pinterest) are printed as meta tags on the home page; a whole pasted meta tag is reduced to its code. A custom robots.txt replaces WordPress's through the `robots_txt` filter, accepts only robots directives and comments, refuses a rule that blocks the whole site for every crawler, and is ignored while WordPress discourages search engines. A real `robots.txt` file on disk wins over WordPress, so the dashboard warns when one exists. `/llms.txt` is answered on `parse_request`: automatic text lists the site name, tagline, up to 20 pages and 20 recent posts that are not hidden (cached for an hour), or a custom text. IndexNow makes a key once, serves it at `/{key}.txt`, and on publish, update and unpublish sends a non-blocking submission for that one URL (once a minute per post, never for hidden or noindex content). None of this is applied while another SEO plugin is active, and nothing is written to the site's files.

Code snippets (plugin 0.29.0, `class-kontrolwp-connect-snippets.php`, Code snippets tab) print small pieces of HTML or JavaScript, such as analytics and tracking codes, in the head, at the start of the body (`wp_body_open`, which needs a theme that calls it) or in the footer. They are stored in the `kontrolwp_connect_snippets` option, which is not autoloaded, with a tiny autoloaded `kontrolwp_connect_snippets_active` count so a site with none switched on pays for no extra query. Each snippet has a name, code (up to 30000 characters), a location, an on switch, and a scope: every page, only listed page addresses, or every page except them (an address such as `/pricing` matches that page, and `/blog/*` everything under it). Snippets can be written only through the signed dashboard routes, which are the only way the plugin accepts them; the code is printed exactly as written, preceded by a comment naming the snippet. They are never printed in the admin, in feeds, in robots.txt or in the customizer preview, and by default not for logged-in users who can edit posts (setting `skip_editors`), so the owner's own visits are not counted. They work whether or not SEO Management is on. A plugin or theme that also prints the same code (WPCode, Kadence) is not detected; the owner removes it there.

Update emails (plugin 0.30.0, `class-kontrolwp-connect-update-emails.php`, a row in Site settings) suppress the emails WordPress sends about updates through `auto_core_update_send_email`, `auto_plugin_update_send_email`, `auto_theme_update_send_email`, `send_core_update_notification_email` and `automatic_updates_send_debug_email`. They are suppressed by default: the `kontrolwp_connect_update_emails` option holds `allow` only when the dashboard has turned them back on, so a site with nothing stored follows the default. Updates themselves still run.

Custom login URL (plugin 0.31.0, `class-kontrolwp-connect-login-url.php`, the Login page section of the Security tab) serves the WordPress login form at a chosen address, like WPS Hide Login. Only the `kontrolwp_connect_login_url` option is stored (`enabled`, `slug`, `redirect`), so switching it off, clearing the address, deactivating the plugin or defining `KONTROLWP_DISABLE_LOGIN_URL` in wp-config.php restores wp-login.php with nothing to clean up. At `plugins_loaded` the request is classified; at `wp_loaded` it either loads wp-login.php for the custom address (a path, or `?slug` without pretty permalinks), or answers a 404 template (or a redirect home) for direct wp-login.php requests and signed-out wp-admin requests. `admin-ajax.php`, `admin-post.php`, `load-styles.php`, `load-scripts.php`, `install.php`, `upgrade.php` and `repair.php` stay reachable signed out; REST, XML-RPC, cron and WP-CLI are never touched. Links to wp-login.php made through `site_url`, `network_site_url` and `wp_redirect` (password reset emails, logout, Magic Login) are rewritten to the custom address, and core's /login, /admin and /dashboard redirects are removed so they do not reveal it. Direct wp-login.php still works for a password-protected post's form and a Magic Login token link. The feature stays off while WPS Hide Login or a similar plugin is active.

Login page logo (plugin 0.32.0, `class-kontrolwp-connect-login-logo.php`, the Branding tab under Tools) replaces the WordPress logo above the login form with either the logo already set in WordPress (source `site`, plugin 0.33.0: the `custom_logo` theme mod, then the `site_logo` option, then the Site Icon, read live so it follows changes there) or an uploaded image (source `upload`), linked to the home page and titled with the site name through `login_headerurl` and `login_headertext`. The image is kept in the media library, marked with `_kontrolwp_login_logo` so only that attachment is ever replaced or deleted; the `kontrolwp_connect_login_logo` option holds `enabled`, `source` (missing before 0.33.0, read as `upload` when an image is stored, else `site`), `size` and the uploaded attachment with its pixel size. An inline style on `login_enqueue_scripts` draws it as the `#login h1 a` background, fitted into a box per size (small 84 by 84 like core, medium 200 by 100, large 320 by 140) and never enlarged. Switching it off or deactivating the plugin brings the WordPress logo back; uninstalling deletes the image. It also applies on the custom login address, which serves the same wp-login.php.

Content features (plugin 0.21.0, `class-kontrolwp-connect-seo-content.php`, option `kontrolwp_connect_seo_content`) all need SEO tags switched on and no other SEO plugin active, and none edits stored content: they act as pages are rendered. Site schema prints one JSON-LD `@graph` on the home page (WebSite, and an Organization or Person with logo and `sameAs` links); posts get Article markup; posts, pages and term archives get a BreadcrumbList, and the same trail is available as the `[kontrolwp_breadcrumbs]` shortcode and `kontrolwp_breadcrumbs()`. External-link rules (new tab, nofollow, with `noopener` added whenever a link opens a new tab) and image alt text run on `the_content` through `WP_HTML_Tag_Processor` (WordPress 6.2 and later; otherwise they do nothing). Alt text is only added to images that have no `alt` attribute at all, from the media library's alt text or a readable title, never a camera file name, and an empty `alt=""` is left as the author's mark for decoration. The feed footer is added to `the_content_feed` and `the_excerpt_rss`. A site that already used SEO before 0.21.0 and has not saved these starts with schema, breadcrumbs, alt text and the feed footer off, so an update changes nothing on its pages. Image title attributes, stripping the category base and disabling author archives were first left out, then added in 0.22.0 as opt-in settings that are all off by default (see below).

Archive and template settings (plugin 0.22.0). Three new keys in the SEO settings (`kontrolwp_connect_seo`) and one in the content settings: `strip_category_base`, `author_archives` (`keep`, `redirect` or `404`), `type_templates` (post type to `{title, description}`) and `image_title`. All are off or empty by default, so an update changes nothing on a live site. They live in `class-kontrolwp-connect-seo-archives.php` (category base and author archives) and the existing SEO classes.

- Category base. `term_link` drops `/category/` (or the site's own base) from a category's address, a `category_rewrite_rules` filter adds rules for the short address, its feeds and its later pages, and `template_redirect` sends the old address to the new one with a 301. The stored rewrite rules are cleared when the setting changes and whenever a category is created, edited or deleted, and on deactivation. A category keeps its old address when its short address is already used by a published page or post, or is a path WordPress uses (`RESERVED`), and beyond 500 categories the rest keep theirs. It does nothing without pretty permalinks. The dashboard shows a real address before and after. Turning it off later makes the short addresses stop working, which the setting's help says.
- Author archives. `redirect` sends `is_author()` requests to the home page with a 301; `404` answers not found. Either leaves the users sitemap out.
- Type templates. A post's title comes from its own override, then its type's template, then the site-wide template; its description from its own override, then its type's description template, then the excerpt. The new `%excerpt%` token is the trimmed excerpt or opening text.
- Image titles. Images without a `title` attribute get the media library title or a readable file name (never a camera name), in content and in theme-printed images. Alt text remains the setting that matters.

Local SEO is a nested `local` object in the same option: an on/off switch and a list of up to 50 locations (older settings that held one business become one location). Each location has a type (`LocalBusiness` or a subtype such as `Dentist`), name, phone, email, address, map location, price range, logo, photo, opening hours and profile links. A location with no page is marked up on the home page; a location tied to a page (`page_id`, chosen in the dashboard) is marked up on that page only, with that page's address as its `url`. Several locations on one page share one JSON-LD `@graph`. A location needs a name (the site name is the fallback) and a phone number or street address, or nothing is printed for it. Anything invalid (an unknown type, a time that is not `HH:MM`, a coordinate out of range, a non-http link) is dropped when the settings are saved, and the block is encoded so it cannot close its own script tag. `GET /seo` also returns `location_pages`, the title and address of each tied page that still exists.

Content checklist (plugin 0.23.0, `class-kontrolwp-connect-seo-score.php`). Each published page can have an optional focus keyword (post meta `_kontrolwp_seo_keyword`, saved through `/seo/page`). `/seo/score` returns a checklist for one page: focus keyword in the title, description length (70 to 160 characters), subheadings (pages over 300 words), links to the site's own pages and to other sites (pages over 150 words; the outside link is optional), image alt text (an empty `alt` counts as decoration), and readability from sentence length (pages over 100 words; sentence length keeps it language independent). Checks that do not apply, or that need a keyword that is not set, are skipped. The overall status is only `good` or `needs_work`, never a number, and it is guidance rather than a ranking promise. The Edit dialog on a page checks the unsaved title, description and keyword after a short pause, and the page list shows each page's status. Nothing here changes a page.

SEO caching. SEO reads follow the same pattern as the other modules: the answer is kept in `content_cache` (kind `seo`) for an hour, a sync or any change made from the dashboard clears the site's answers, and an answer past the hour is used only when the site cannot be reached. Kept: the settings (which include Local SEO), the page list, the content settings, the tools settings and previews, the redirect rules (per page and search), the 404 log (five minutes, because it changes with every visitor), and the import list and previews. Always live: every write (settings, page overrides, redirect edits, bulk changes, CSV import, clearing the 404 log, running or deactivating an import), redirect exports, the per-page checklist (it checks unsaved text), and the llms.txt and robots.txt reachability check, which exists to show what a visitor gets right now.

Switching a module off hides it. With SEO Management off (plugin 0.24.0), the SEO tab shows only the Enable switch in Settings, plus Import; the Redirects, 404 log, Content and Tools views and every other settings section are hidden, and the saved values are kept and reappear when it is switched back on. On the site, the verification codes, robots.txt, llms.txt and IndexNow no longer run while SEO Management is off, as the content features, archive settings and page tags already did not. Redirect rules keep running on the site, so turning SEO Management off hides their editor but does not stop them, and Import stays because it is how another plugin's settings are brought in. For the checks in Site settings, switching off update checks hides the Updates section on the overview and the core auto-update row; the Links, Security, Analytics, Accessibility and Performance tabs were already hidden when their switch is off, and a link to a hidden tab opens the Overview.


## Overview health cards

Every site's Overview starts with a Health section of up to five cards: Links and Security (WordPress only), SEO, Accessibility, Performance. Each reads the same query as its tab (so the data is shared and cached), shows one line of result and one of detail, and opens its tab when selected. A card is left out when the site has that feature switched off. The Accessibility, SEO and Performance cards only read the last scan; they never start one.

## Analytics providers

A site reads its analytics from one provider, `sites.analytics_provider` (`umami` by default, or `ga4`), chosen in the site's settings. `GET /sites/:id/analytics` and `/analytics/details` pick the provider and return the same `SiteAnalytics` shape, so the Overview card, the Analytics tab and the export do not care where the numbers came from; `provider` says which. `analytics_ref` is the owner's chosen source within a non-Umami provider; null matches by domain.


Google Analytics 4 (`src/worker/ga4.ts`, `src/worker/google.ts`) is read through "Connect to Google" in Settings. The owner creates an OAuth client (type Web application) in their own Google Cloud project once, because every deployment has its own address, saves its client ID and secret in Settings (the secret is encrypted under the `google_client` setting), and lists `https://<this app>/api/google/callback` as an authorized redirect URI. `POST /api/google/connect` stores a one-time state (`google_oauth_state`, ten minutes) and returns Google's sign-in address; `GET /api/google/callback` checks the state, trades the code for tokens, reads the account's email and saves the encrypted refresh token under the `google` setting, then returns to Settings. The scopes are read-only (`analytics.readonly`, `webmasters.readonly`, plus `openid email` to label the account), asked for with offline access. Access tokens come from the refresh token and are kept for 50 minutes in memory; one covers every scope. The consent screen should be set to In production, or Google expires the refresh token after seven days. Connections saved earlier with a service account's JSON key (the `google` setting without `kind: "oauth"`) still work, signed with Web Crypto (RS256), and show in Settings until disconnected or replaced. A property is matched to a site by the domain of its web data stream; its time zone is read so GA's wall-clock hours and days land in the browser's buckets. Day ranges use GA's own totals for the period and the one before; a 24 hour range is added up from hours, so its visitors figure is a sum of hourly users. The Analytics Data API, Analytics Admin API, Search Console API and (for site setup) Site Verification API must be enabled in the OAuth client's Google Cloud project.

## Search Console

The Analytics tab of every site starts with a Search Console section (above the analytics; the tab shows when either Google or an analytics provider is connected) (`src/worker/search-console.ts`, `SearchConsoleSection.tsx`) once Google is connected; without it the section says how to connect. It uses the same Google connection as Analytics with the read-only Search Console scope, so the signed-in account must be a user of the property in Search Console. A site is matched to a property by domain, preferring a domain property (`sc-domain:`) over a URL-prefix one, or the owner chooses one (`sites.gsc_property`). On the Overview it is a compact module under the analytics (stat tiles only, with an icon that opens the Analytics tab, as the analytics module has). It reads totals for the period and the one before, a daily series, and the top ten queries and pages. Search Console data is two days late, so a period ends two days ago; answers are cached for an hour.

Setting a WordPress site up in Search Console (`POST /api/sites/:id/search-console/setup`, `src/worker/search-console-setup.ts`) is offered where a site has no property. It needs a "Connect to Google" sign-in that also allowed `webmasters` (write, replacing the read-only scope) and `siteverification.verify_only`; a sign-in made before that shows "Allow setup in Google", which signs in again with those scopes and returns to the site page (`return_to`, a path on this app only). The Worker then asks the Site Verification API for a META token for the URL-prefix property (`https://site/`), saves its code as the Google verification code through the SEO tools (so SEO Management must be on and no other SEO plugin active), asks Google to verify (retrying while a cached home page still lacks the tag), adds the property and submits `wp-sitemap.xml`. A site already in Search Console only gets its sitemap submitted. A domain property cannot be made this way, since that proof is a DNS record; static websites have no plugin to print the tag, so they are left to Search Console.

