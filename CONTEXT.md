# KontrolWP

KontrolWP is a dashboard for managing many WordPress sites from one place, running in the owner's Cloudflare account.

## Language

**Site**:
A WordPress install the owner added to KontrolWP, identified by its public https home URL and named after its WordPress title (a Static site: its domain). The owner can rename any Site from its page; the new name then survives syncs until reset. It is Waiting to connect until its first successful sync, Connected after one, and Needs attention when the latest sync failed.
_Avoid_: Website, install, instance

**Static site**:
A static website hosted on Cloudflare Workers, added by its public https address with no plugin. KontrolWP checks that it answers, shows its Umami analytics and Domain, and, only when the owner says it is hosted on Cloudflare Workers, a Cloudflare API token is saved in Settings and its Worker is chosen, its Deployments. A static site hosted elsewhere gets no Cloudflare features. Its Pages tab lists the pages in its sitemap. It has no Updates, Plugins, Users, Links or Magic Login.
_Avoid_: Jamstack site, Pages site

**Deployment**:
One entry in a Static site's history, from Cloudflare: a version that went live on its Worker (the newest is Live), or a Workers Builds run with its status and log.
_Avoid_: Release, build job

**KontrolWP Connect**:
The WordPress plugin installed on every Site. It answers only requests signed with that Site's secret and never contacts the dashboard on its own.
_Avoid_: Agent, client, worker plugin

**Connection Key**:
The string (starting `kontrolwp2.`) that pairs one Site with the dashboard. KontrolWP Connect creates it and shows it under Settings, KontrolWP Connect; the owner pastes it into KontrolWP with the Site's address. It carries a key id and the secret, and stops working as soon as the plugin creates a new one.
_Avoid_: API key, token, password

**PageSpeed test**:
One run of Google's PageSpeed Insights (Lighthouse) on a Site's home page, as a phone or as a desktop: four scores out of 100, lab measurements, Core Web Vitals from real visits when Google has enough, and the biggest time savings. Shown on the Site's Performance tab; weekly once a Google API key is saved.
_Avoid_: Speed scan, audit, benchmark

**Sync**:
One pull of status, available Updates and Pending Comments from a Site, replacing what KontrolWP stored for it. Runs every 6 hours and on Sync now.
_Avoid_: Refresh, poll, crawl

**Update**:
A newer version of WordPress core, a plugin or a theme that a Site reported during its last Sync.
_Avoid_: Upgrade, patch

**Update Queue**:
The Updates the owner asked KontrolWP to install on one Site, run one at a time in the order they were queued. An Update in it is Queued, Updating, Updated (until the next Sync) or failed.
_Avoid_: Job list, batch

**Pending Comment**:
A comment held for moderation on a Site. KontrolWP shows the newest 50 per Site and can approve, spam or trash each one.
_Avoid_: Unapproved comment, queue item
