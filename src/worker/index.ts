import { Hono } from "hono";
import { api } from "./api";
import { requireWebAccess } from "./api/access.ts";
import { ensureSchema } from "./db/schema.ts";
import { runScheduledLinkScans } from "./sites/link-schedule.ts";
import { checkLinks, collectLinks } from "./sites/links.ts";
import { runScheduledSync, syncSite } from "./sites/sync.ts";
import { runNextUpdate, runResync } from "./sites/updates.ts";
import { runScheduledUpdates } from "./sites/update-policy.ts";
import { runScheduledScans } from "./sites/accessibility.ts";
import { runScheduledSeoScans } from "./sites/seo-audit.ts";
import { runScheduledFeedRefresh } from "./sites/vulnerabilities.ts";

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", requireWebAccess);
app.route("/api", api);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      ensureSchema(env.DB).then(async () => {
        // Accessibility scans load the sites' pages too, so they wait for a tick with no sync starting.
        const synced = await runScheduledSync(env);
        await Promise.all([
          runScheduledLinkScans(env),
          runScheduledFeedRefresh(env),
          runScheduledUpdates(env),
          synced ? 0 : runScheduledScans(env),
          synced ? 0 : runScheduledSeoScans(env),
        ]);
      }),
    );
  },
  async queue(batch, env) {
    await ensureSchema(env.DB);
    await Promise.all(
      batch.messages.map(async (message) => {
        try {
          // Unreachable sites are recorded on the site, not retried; only
          // unexpected failures (such as D1 errors) go back to the queue.
          const body = message.body;
          const { siteId } = body;
          if (body.type === "links-collect") {
            await collectLinks(env, siteId, body.scanId, body.page);
          } else if (body.type === "links-check") {
            if (await checkLinks(env, siteId, body.scanId)) {
              await env.SYNC_QUEUE.send({ type: "links-check", siteId, scanId: body.scanId });
            }
          } else if (body.type === "update") {
            const step = await runNextUpdate(env, siteId);
            if (step.next === "continue") await env.SYNC_QUEUE.send({ type: "update", siteId });
            if (step.next === "retry") {
              await env.SYNC_QUEUE.send({ type: "update", siteId }, { delaySeconds: step.delaySeconds });
            }
            if (step.next === "resync") {
              await env.SYNC_QUEUE.send({ type: "resync", siteId, attempt: 1 }, { delaySeconds: step.delaySeconds });
            }
          } else if (body.type === "resync") {
            const again = await runResync(env, siteId, body.attempt);
            if (again !== null) {
              await env.SYNC_QUEUE.send({ type: "resync", siteId, attempt: body.attempt + 1 }, { delaySeconds: again });
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
