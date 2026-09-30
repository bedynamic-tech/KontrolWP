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

let ready: Promise<unknown> | null = null;

/**
 * Bring the database up to date once per Worker instance. A failure is not
 * cached, so the next request tries again.
 */
export function ensureSchema(db: D1Database): Promise<unknown> {
  ready ??= applyMigrations(db, MIGRATIONS).catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}
