# Deploy your own Presser

The recommended path is Cloudflare's guided deployment, followed by turning on
Access. No local CLI or API keys are needed.

## Before you start

- A GitHub account and a Cloudflare account.
- A Cloudflare Zero Trust team for protecting the dashboard with Access (the
  free plan is enough).

Workers, D1, Queues and Cron Triggers usage belongs to your account and is
subject to Cloudflare's quotas and billing.

## At a glance

1. Deploy with the button. The database, queue and migrations are automatic.
2. Open the dashboard and follow its setup screen: turn on Access for the
   Worker, then paste the two values it shows. The API rejects requests until
   this is done.
3. Add a site, install Presser Connect on it and paste its Connection Key.

## 1. Deploy the dashboard

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bedynamic-tech/Presser)

1. Sign in to Cloudflare and connect GitHub when prompted. The source
   repository must be public for other people to use this button.
2. Choose the destination account, repository and Worker name. For your first
   instance the default names are fine. For more instances in the same
   account, use different Worker, database and queue names.
3. Review the resource bindings: `DB` (D1) and `SYNC_QUEUE` (Queues).
   Cloudflare provisions them in your account and writes their values into
   your new repository. In `wrangler.jsonc`, the queue consumer's `queue` must
   match the `SYNC_QUEUE` producer, including if you rename it.

   The repository Cloudflare creates belongs to you, and your instance lives
   there. Upstream changes do not arrive automatically; see [Updates](#updates).
4. Set the **deploy command** to `npm run deploy`. Leave the **build command**
   empty, because the deploy script builds the app itself. If Cloudflare
   pre-fills `npm run build`, clearing it avoids building twice.
5. Deploy and wait for Workers Builds to finish. The script builds the
   dashboard and the Presser Connect zip, applies pending D1 migrations, then
   deploys the Worker and its assets. On the first deploy it also creates the
   `SITE_SECRETS_KEY` Worker secret that encrypts site secrets; later deploys
   keep it. Never delete or change it, or every site will need a new
   Connection Key.

Cloudflare's [Deploy to Cloudflare documentation](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
describes resource provisioning and repository creation.

### Database binding without an account-specific ID

The shared configs intentionally omit `database_id`. The project pins
Wrangler to 4.124.0, which resolves `database_name` in the authenticated
Cloudflare account for deployments and remote migrations. An existing
database with that name is reused, so use a distinct name for each
independent instance in the same account. If Cloudflare writes an explicit
database ID into your instance's config, keep it consistent with the database
name; Wrangler uses that ID when present.

## 2. Turn on Cloudflare Access

Open the Worker's URL. Until Access protects the Worker, Presser shows a setup
screen instead of the dashboard:

1. In **Workers & Pages**, open your Worker's **Access** tab and select
   **Enable access** with the **Cloudflare account** policy. The setup screen
   links straight to this tab.
2. Reload the page. Presser now shows the two values to add under **Settings,
   Variables and Secrets**: `WEB_ACCESS_TEAM_DOMAIN` and `WEB_ACCESS_AUD`.
3. Select **Check again**.

The Worker verifies the Access JWT on every API request, so a route that
misses Access still fails closed. `keep_vars` in `wrangler.jsonc` keeps these
two variables across deploys.

## 3. Connect a site

Select **Add site**, enter its name and https address, then follow the steps:
download `presser-connect.zip`, install and activate it on the site, paste the
Connection Key under **Settings, Presser Connect**, and select **Sync now**.

## Manual deployment

```sh
npm install
npx wrangler login
npx wrangler d1 create presser
npx wrangler queues create presser-sync
npm run deploy
```

If you chose different resource names, update the database, the producer
queue and the consumer queue in `wrangler.jsonc`.

To deploy on every push instead, commit your instance configuration, connect
the repository through **Workers & Pages, Create, Import a repository**, and
use `npm run deploy` as the deploy command with an empty build command.
Pushes to the production branch then deploy automatically.

## Updates

Your repository does not follow upstream on its own. To bring in changes, add
this repository as a remote, merge its `main` into yours, keep your own
resource names in `wrangler.jsonc`, and push. The deploy command applies any
new migrations before the new Worker goes live.

## Troubleshooting

- **The button cannot import the repository:** the upstream repository must
  be public.
- **A push did not trigger a deployment:** check that the repository is still
  connected under the Worker's **Settings, Build** and that the deploy command
  is `npm run deploy`. Builds only run on the production branch (normally
  `main`).
- **D1 database not found:** `database_name` in `wrangler.jsonc` must match a
  database in the account. For manual setup, create it before running
  migrations.
- **"Add Presser's encryption key" screen:** the Worker has no
  `SITE_SECRETS_KEY`, usually because the deploy command is not
  `npm run deploy` (a plain `wrangler deploy` does not create it). Follow the
  screen: it generates a key in your browser to add as a Worker secret. Also
  set the deploy command to `npm run deploy` under the Worker's **Settings,
  Build**.
- **"Presser could not decrypt this site's secret":** the key changed since
  the site was added. Create a new connection key for the site and paste it
  into Presser Connect.
- **Sites never sync on their own:** check that the `presser-sync` queue
  exists and that the Worker's **Settings, Triggers** shows the cron schedule.
