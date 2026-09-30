# Presser

Presser is a dashboard for managing many WordPress sites from one place, running in the owner's Cloudflare account.

## Language

**Site**:
A WordPress install the owner added to Presser, identified by its public https home URL. It is Waiting to connect until its first successful sync, Connected after one, and Needs attention when the latest sync failed.
_Avoid_: Website, install, instance

**Presser Connect**:
The WordPress plugin installed on every Site. It answers only requests signed with that Site's secret and never contacts the dashboard on its own.
_Avoid_: Agent, client, worker plugin

**Connection Key**:
The string (starting `presser1.`) that pairs one Site with the dashboard. It carries the Site's id and secret, is shown once, and stops working as soon as a new one is created.
_Avoid_: API key, token, password

**Sync**:
One pull of status, available Updates and Pending Comments from a Site, replacing what Presser stored for it. Runs every 30 minutes and on Sync now.
_Avoid_: Refresh, poll, crawl

**Update**:
A newer version of WordPress core, a plugin or a theme that a Site reported during its last Sync.
_Avoid_: Upgrade, patch

**Pending Comment**:
A comment held for moderation on a Site. Presser shows the newest 50 per Site and can approve, spam or trash each one.
_Avoid_: Unapproved comment, queue item
