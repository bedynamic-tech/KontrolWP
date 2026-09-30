import { Hono } from "hono";
import { api } from "./api";
import worker from "./index";

// Only wrangler.dev.jsonc selects this entrypoint. Production has no auth bypass.
const app = new Hono<{ Bindings: Env }>();
app.route("/api", api);

export default { ...worker, fetch: app.fetch };
