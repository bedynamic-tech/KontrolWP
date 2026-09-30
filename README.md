# Presser

Self-hosted WordPress manager on Cloudflare.

Presser is one dashboard for all your WordPress sites. Each site runs the
**Presser Connect** plugin, and the dashboard pulls in what needs your
attention: plugin, theme and core updates, and comments waiting for review.
Update plugins and themes and moderate comments without logging in to each
site.

Everything runs in your own Cloudflare account, behind Cloudflare Access.

## What it does today

- **Sites.** Add a site, install Presser Connect, paste its Connection Key.
- **Updates.** Every available core, plugin and theme update across all sites,
  with one-click plugin and theme updates.
- **Comments.** Every pending comment across all sites, with Approve, Spam and
  Trash.
- **Background sync.** Every site is re-checked every 30 minutes.

## Get started

1. Create the resources and deploy:
   ```sh
   npm install
   npx wrangler d1 create presser
   npx wrangler queues create presser-sync
   npm run deploy
   ```
2. Open the Worker's URL and follow the setup screen to turn on Cloudflare
   Access and add `WEB_ACCESS_TEAM_DOMAIN` and `WEB_ACCESS_AUD`.
3. Select **Add site**, download `presser-connect.zip`, install it on your
   site and paste the Connection Key under **Settings, Presser Connect**.

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
