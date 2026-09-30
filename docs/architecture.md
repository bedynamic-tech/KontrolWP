# Architecture

```
 Browser ──Access──▶ Presser Worker ──signed HTTPS──▶ WordPress + Presser Connect
                      │  React SPA (static assets)
                      │  Hono API  /api/*
                      │  Cron: every 30 min ─▶ Queue ─▶ sync one site
                      └─ D1: sites, updates, comments
```

## Cloudflare pieces

| Piece | Binding | Purpose |
| --- | --- | --- |
| Worker + static assets | | Serves the React dashboard and the `/api/*` routes, one Worker like Mailroom. |
| Cloudflare Access | | Protects the whole Worker. `requireWebAccess` also verifies the `Cf-Access-Jwt-Assertion` JWT on every API call, so a misconfigured route still fails closed. |
| D1 | `DB` | Sites with their secrets, plus the latest snapshot of updates and pending comments per site. |
| Queue | `SYNC_QUEUE` | One message per site, so a slow or broken site never delays the others and unexpected failures retry. |
| Cron Trigger | | `*/30 * * * *` enqueues every site. |

Presser only makes outbound requests to sites. Sites never call the
dashboard, so nothing needs an Access bypass, and the dashboard can sit on a
private hostname.

## The dashboard to plugin protocol

Source of truth: `src/shared/protocol.ts` and
`plugin/presser-connect/includes/class-presser-connect-auth.php`. They are
tested against each other in `tests/protocol.test.mjs`.

**Pairing.** Adding a site creates a random 32-byte secret for that site
only. The dashboard shows it once, packed in a Connection Key
(`presser1.` + base64url JSON of site id, secret and dashboard origin). The
owner pastes the key into **Settings, Presser Connect** on the site. The
secret never travels again.

**Requests.** The dashboard calls the plugin's REST routes at
`https://site/?rest_route=/presser/v1/...` (works with or without pretty
permalinks) and signs each request with HMAC-SHA256 over:

```
presser-v1
METHOD
/presser/v1/route
unix timestamp
random nonce
sha256 hex of the body
```

The plugin rejects a request unless the site id matches, the timestamp is
within five minutes, the signature matches (constant-time compare) and the
nonce has not been used before. Only after the signature checks out is the
nonce stored, so unsigned traffic cannot fill the store.

**Why a per-site shared secret.** A leaked key only exposes the one site that
held it. Rotating a key (**New connection key**) invalidates the old one
immediately. The dashboard requires `https://` site URLs and uses
`global_fetch_strictly_public`, so a site URL cannot point back into
Cloudflare or a private network.

## Plugin routes (`presser/v1`)

| Route | Does |
| --- | --- |
| `GET /status` | Site name, WordPress, PHP and plugin versions, active theme. |
| `GET /updates` | Available core, plugin and theme updates. Refreshes stale data from WordPress.org, at most once per 12 hours for core. |
| `POST /updates/apply` | `{kind: plugin or theme, slug}`. Runs the same bulk upgrader the Updates screen uses. Refuses when `DISALLOW_FILE_MODS` is set. |
| `GET /comments` | Pending count and the 50 newest comments awaiting moderation. |
| `POST /comments/moderate` | `{id, action: approve, spam or trash}`. |

Core updates are shown but applied from WordPress itself for now, since a
failed core update over REST is hard to recover from remotely.

## Next steps worth considering

- Encrypt site secrets at rest in D1 with a Worker secret.
- Core updates, plugin activation and backups before updates.
- Uptime and SSL expiry checks from the Worker.
- Notifications (email or push) when a site fails to sync or has security
  updates, reusing Mailroom's notification code.
- Multisite support.
- Deploy to Cloudflare button and automatic builds on push, like Mailroom.
