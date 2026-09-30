import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migrationsDir = new URL("../../migrations/", import.meta.url);

/** The files in migrations/, as the Worker bundles them. */
export const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(new URL(name, migrationsDir), "utf8") }));

/** The slice of D1 Presser uses, backed by an in-memory node:sqlite database. */
export function fakeD1(sqlite = new DatabaseSync(":memory:")) {
  const statement = (sql, params = []) => ({
    sql,
    params,
    bind: (...values) => statement(sql, values),
    run: async () => {
      const result = sqlite.prepare(sql).run(...params);
      return { meta: { changes: Number(result.changes) } };
    },
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
  });
  return {
    sqlite,
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        for (const s of statements) sqlite.prepare(s.sql).run(...s.params);
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
