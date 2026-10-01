import { Hono } from "hono";
import { api } from "./api";
import { requireWebAccess } from "./api/access.ts";
import { ensureSchema } from "./db/schema.ts";
import { runScheduledSync, syncSite } from "./sites/sync.ts";
import { runNextUpdate } from "./sites/updates.ts";

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", requireWebAccess);
app.route("/api", api);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(ensureSchema(env.DB).then(() => runScheduledSync(env)));
  },
  async queue(batch, env) {
    await ensureSchema(env.DB);
    await Promise.all(
      batch.messages.map(async (message) => {
        try {
          // Unreachable sites are recorded on the site, not retried; only
          // unexpected failures (such as D1 errors) go back to the queue.
          const { siteId } = message.body;
          if (message.body.type === "update") {
            const step = await runNextUpdate(env, siteId);
            if (step.next === "continue") await env.SYNC_QUEUE.send({ type: "update", siteId });
            if (step.next === "retry") {
              await env.SYNC_QUEUE.send({ type: "update", siteId }, { delaySeconds: step.delaySeconds });
            }
          } else {
            await syncSite(env, siteId);
          }
          message.ack();
        } catch {
          message.retry({ delaySeconds: Math.min(300, 15 * 2 ** message.attempts) });
        }
      }),
    );
  },
} satisfies ExportedHandler<Env, SyncMessage>;
