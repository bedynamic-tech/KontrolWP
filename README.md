# Presser

Self-hosted WordPress manager on Cloudflare.

Presser is one dashboard for all your WordPress sites. Each site runs the
**Presser Connect** plugin, and the dashboard pulls in what needs your
attention: plugin, theme and core updates, and comments waiting for review.
Update WordPress, plugins and themes and moderate comments without logging
in to each site.

Everything runs in your own Cloudflare account, behind Cloudflare Access.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bedynamic-tech/Presser)

## What it does today

- **Sites.** Install Presser Connect, then add the site with its address and
  the Connection Key the plugin shows. The name comes from WordPress.
- **Updates.** Every available core, plugin and theme update across all sites,
  each queued with one click. Each site installs its updates one at a time.
  Presser Connect itself updates automatically from the dashboard.
- **Comments.** Every pending comment across all sites, with Approve, Spam and
  Trash.
- **Background sync.** every site is re-checked every 6 hours.

## Get started

1. **Deploy.** Click **Deploy to Cloudflare** above. The database, queue and
   migrations are set up for you.
2. **Secure.** The setup screen walks you through turning on Cloudflare Access.
3. **Connect.** Install Presser Connect on the site, then select **Add site**
   and enter the site's address and the Connection Key from Settings,
   Presser Connect.

Prefer to set things up by hand? Follow the
[manual deployment guide](docs/deployment.md#manual-deployment).

## Develop

```sh
npm install
npm run db:migrate:local
npm run dev        # http://localhost:5173, no Access locally
npm run check      # typecheck
npm test           # unit tests, plus PHP interop tests when php is installed
```

See [docs/architecture.md](docs/architecture.md) for how the pieces fit and
how the plugin authenticates the dashboard.

## Built on

Cloudflare Workers, D1, Queues, Cron Triggers and Access. The deployment
setup follows [Mailroom +](https://github.com/bedynamic-tech/mailroom).
