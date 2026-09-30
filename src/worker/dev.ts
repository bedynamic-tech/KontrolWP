import { Hono } from "hono";
import { api } from "./api";
import worker from "./index";

// Only wrangler.dev.jsonc selects this entrypoint. Production has no auth bypass.
const app = new Hono<{ Bindings: Env }>();
app.route("/api", api);

// A fixed key so local development works without .dev.vars. Never deployed:
// production gets its own random key from scripts/deploy.mjs.
const DEV_SITE_SECRETS_KEY = "cHJlc3Nlci1sb2NhbC1kZXZlbG9wbWVudC1rZXktMzI";
const withDevKey = (env: Env): Env => ({ ...env, SITE_SECRETS_KEY: env.SITE_SECRETS_KEY ?? DEV_SITE_SECRETS_KEY });

export default {
  ...worker,
  fetch: (request, env, ctx) => app.fetch(request, withDevKey(env), ctx),
  queue: (batch, env) => worker.queue(batch, withDevKey(env)),
} satisfies ExportedHandler<Env, SyncMessage>;
