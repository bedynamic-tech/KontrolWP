# KontrolWP

Self-hosted WordPress manager on Cloudflare.

KontrolWP is one dashboard for all your WordPress sites. Each site runs the
**KontrolWP Connect** plugin, and the dashboard pulls in what needs your
attention: plugin, theme and core updates, and comments waiting for review.
Update WordPress, plugins and themes and moderate comments without logging
in to each site.

Everything runs in your own Cloudflare account, behind Cloudflare Access.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bedynamic-tech/KontrolWP)

## What it does today

- **Sites.** Install KontrolWP Connect, then add the site with its address and
  the Connection Key the plugin shows. The name comes from WordPress.
- **Updates.** Every available core, plugin and theme update across all sites,
  each queued with one click. Each site installs its updates one at a time.
  KontrolWP Connect itself updates automatically from the dashboard.
- **Plugins.** Every plugin across all sites: install, activate, deactivate,
  delete and auto-updates, on one site or many at once.
- **Users.** Every user across all sites, grouped by email: add, change role,
  send a password reset or delete, on one site or many at once.
- **Links.** Scan a site's published posts and pages for broken and
  unresponsive links and images, then open each post's editor to fix them.
- **Comments.** Every pending comment across all sites, with Approve, Spam and
  Trash.
- **Background sync.** Every site is re-checked every hour by default; Settings can make it every 15 minutes up to every 6 hours.

## Built on

Cloudflare Workers, D1, Queues, Cron Triggers and Access. The deployment
setup follows [Mailroom +](https://github.com/bedynamic-tech/mailroom).
