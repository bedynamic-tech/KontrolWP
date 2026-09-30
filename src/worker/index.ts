import { Hono } from "hono";
import { api } from "./api";
import { requireWebAccess } from "./api/access.ts";
import { enqueueAllSites, syncSite } from "./sites/sync.ts";

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", requireWebAccess);
app.route("/api", api);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(enqueueAllSites(env));
  },
  async queue(batch, env) {
    await Promise.all(
      batch.messages.map(async (message) => {
        try {
          // Unreachable sites are recorded on the site, not retried; only
          // unexpected failures (such as D1 errors) go back to the queue.
          await syncSite(env, message.body.siteId);
          message.ack();
        } catch {
          message.retry({ delaySeconds: Math.min(300, 15 * 2 ** message.attempts) });
        }
      }),
    );
  },
} satisfies ExportedHandler<Env, SyncMessage>;
