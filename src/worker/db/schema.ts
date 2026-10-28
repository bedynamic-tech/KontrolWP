import { applyMigrations, type Migration } from "./migrate.ts";

const files = import.meta.glob<string>("../../../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

const MIGRATIONS: Migration[] = Object.entries(files).map(([path, sql]) => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  sql,
}));

let ready = false;

/**
 * Bring the database up to date once per Worker instance. Each caller runs the
 * check itself until one succeeds, rather than awaiting another's: a Worker
 * cannot settle a promise begun by a request, cron run or queue message that
 * has since ended, so a shared one left pending would hang every later request
 * in the instance. Concurrent runs are safe; applyMigrations skips a migration
 * another run just applied. A failure is not remembered, so the next call tries again.
 */
export async function ensureSchema(db: D1Database): Promise<void> {
  if (ready) return;
  await applyMigrations(db, MIGRATIONS);
  ready = true;
}
