# KontrolWP

**One dashboard for all your WordPress sites, self-hosted on Cloudflare.**

Updates, plugins, users, content, SEO and analytics across every site, without
logging in to each one. It runs entirely in your own Cloudflare account, behind
Cloudflare Access.

[Website and feature tour](https://kontrolwp.com) ·
[Deployment guide](docs/deployment.md) ·
[Architecture](docs/architecture.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bedynamic-tech/KontrolWP)

## Features

- **Updates.** Core, plugin and theme updates across all sites, queued in one
  click or on a schedule.
- **Plugins and users.** Install, activate, update and remove plugins, and
  manage users, on one site or many at once.
- **Content and comments.** Posts and pages, custom post types and pending
  comments for every site.
- **Analytics.** Umami or Google Analytics, plus Search Console.
- **Uptime.** Every site's home page is checked every 15 minutes, with
  response times and 30 days of outages. SSL certificate expiry sits with
  the domain details.
- **Tools.** Per-site link checks, code snippets, database cleanup, PageSpeed performance, SEO
  (redirects, 404 log, sitemaps, imports), login branding, security,
  accessibility and domain checks.
- **Static sites.** Uptime, pages, analytics and Cloudflare Workers
  deployments for static sites.
- **Magic Login.** Open any site's admin without a password.

## How it works

Each WordPress site runs the **KontrolWP Connect** plugin, paired with the
dashboard by a Connection Key. The plugin only answers signed requests and
never calls out on its own. The dashboard is a Cloudflare Worker using D1,
Queues and Cron Triggers, and re-syncs every site in the background.

## Deploy

Click **Deploy to Cloudflare** above, then follow the dashboard's setup screen
to turn on Cloudflare Access. To add a site, install KontrolWP Connect and
enter the site's address with the Connection Key the plugin shows. For manual
setup and updating your instance, see the
[deployment guide](docs/deployment.md).

---

Built by Dynamic Technologies LLC.
