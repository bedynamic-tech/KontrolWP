# Deploy your own KontrolWP

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
3. Install KontrolWP Connect on a site, then add the site in KontrolWP with its
   address and the Connection Key the plugin shows.

## 1. Deploy the dashboard

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bedynamic-tech/KontrolWP)

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
   dashboard and the KontrolWP Connect zip, applies pending D1 migrations, then
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

Open the Worker's URL. Until Access protects the Worker, KontrolWP shows a setup
screen instead of the dashboard:

1. In **Workers & Pages**, open your Worker's **Access** tab and select
   **Enable access** with the **Cloudflare account** policy. The setup screen
   links straight to this tab.
2. Reload the page. KontrolWP now shows the two values to add under **Settings,
   Variables and Secrets**: `WEB_ACCESS_TEAM_DOMAIN` and `WEB_ACCESS_AUD`.
3. Select **Check again**.

The Worker verifies the Access JWT on every API request, so a route that
misses Access still fails closed. `keep_vars` in `wrangler.jsonc` keeps these
two variables across deploys.

## 3. Connect a site

Download `kontrolwp-connect-<version>.zip` from the dashboard (the sidebar or the Sites
page), then install and activate it on the site. Under **Settings, KontrolWP
Connect** on the site, copy the Connection Key. In KontrolWP, select **Add
site** and enter the site's https address and the key. KontrolWP checks the
connection, names the site after its WordPress title and syncs it.

## Manual deployment

```sh
npm install
npx wrangler login
npx wrangler d1 create kontrolwp
npx wrangler queues create kontrolwp-sync
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

## Moving from a Presser deployment

KontrolWP was called Presser, and every name changed with it: the Worker
(`kontrolwp`), the D1 database (`kontrolwp`), the queue (`kontrolwp-sync`),
the plugin (`kontrolwp-connect`) and its REST routes (`kontrolwp/v1`). A
deployment made as Presser does not carry over:

1. Deploy as usual. If Workers Builds deploys a Worker still named `presser`,
   rename it to `kontrolwp` under the Worker's **Settings** first; renaming
   keeps its variables and secrets. Otherwise the deploy creates a new
   `kontrolwp` Worker. Either way the database and queue are new and empty.
2. Turn on Access for the new `kontrolwp` hostname, as in step 2 above.
3. On each site, deactivate and delete Presser Connect, install KontrolWP
   Connect, and add the site again with its new Connection Key.
4. Delete the old `presser` database, queue and Worker when nothing needs them.

## Cloudflare usage

KontrolWP is built to fit Cloudflare's free plans. On the Workers Free plan
Cloudflare never bills: when a daily limit is reached, that service stops
working until 00:00 UTC. On Workers Paid, the monthly allowances are far above
what the scheduled jobs use. Rough figures per site per day, with the default
settings (sync every hour, uptime checks every 15 minutes, link checks weekly):

| Service | Per site per day | Free plan limit | Enough for |
| --- | --- | --- | --- |
| Queue operations | about 100 (24 syncs, a share of 96 uptime messages) | 10,000 a day | about 100 sites |
| D1 rows written | about 600 (mostly uptime results) | 100,000 a day | about 150 sites |
| D1 rows read | a few thousand | 5 million a day | well over 500 sites |
| Worker requests | about 30, plus 96 cron runs in total | 100,000 a day | well over 500 sites |
| D1 storage | under 1 MB (30 days of uptime results) | 5 GB | thousands of sites |

Syncs and link checks write only the rows that changed, so a large site (many
users, plugins or links) costs about the same as a small one once its lists
settle. With many more sites on the free plan, choose a longer Background
sync interval in Settings: queue operations fall with it.

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
- **"Add KontrolWP's encryption key" screen:** the Worker has no
  `SITE_SECRETS_KEY`, usually because the deploy command is not
  `npm run deploy` (a plain `wrangler deploy` does not create it). Follow the
  screen: it generates a key in your browser to add as a Worker secret. Also
  set the deploy command to `npm run deploy` under the Worker's **Settings,
  Build**.
- **"KontrolWP could not update its database":** the Worker tried to apply a
  missing migration and D1 refused it. The message names the migration and
  the reason. Fix the cause, then run `npm run db:migrate`, which records
  what it applies so the Worker does not try again.
- **"KontrolWP could not decrypt this site's secret":** the key changed since
  the site was added. Copy the Connection Key from Settings, KontrolWP Connect
  on the site and use **Replace connection key** on the site's page.
- **Sites never sync on their own:** check that the `kontrolwp-sync` queue
  exists and that the Worker's **Settings, Triggers** shows the cron schedule.
