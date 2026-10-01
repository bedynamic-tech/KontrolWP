// Applies the SQL files in migrations/ that the database has not seen yet.
// `npm run deploy` already runs `wrangler d1 migrations apply`, but a Worker
// deployed another way (such as a plain `wrangler deploy`) would otherwise run
// new code against an old schema. Applied migrations are recorded in the same
// d1_migrations table Wrangler uses, so the two never apply one twice.

export interface Migration {
  /** File name, such as 0001_init.sql, exactly as Wrangler records it. */
  name: string;
  sql: string;
}

export class MigrationError extends Error {}

const TABLE = "d1_migrations";

/** Split a migration into statements, ignoring semicolons in comments and strings. */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (char === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      current += "\n";
    } else if (char === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 1;
      current += " ";
    } else if (char === "'" || char === '"' || char === "`") {
      const start = i;
      i++;
      while (i < sql.length && !(sql[i] === char && sql[i + 1] !== char)) i += sql[i] === char ? 2 : 1;
      current += sql.slice(start, i + 1);
    } else if (char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function appliedNames(db: D1Database): Promise<Set<string>> {
  const { results } = await db.prepare(`SELECT name FROM ${TABLE}`).all<{ name: string }>();
  return new Set(results.map((row) => row.name));
}

/** Apply every migration the database is missing, oldest first. */
export async function applyMigrations(db: D1Database, migrations: Migration[]): Promise<string[]> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${TABLE}(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    )
    .run();
  let applied = await appliedNames(db);
  const ran: string[] = [];
  for (const migration of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (applied.has(migration.name)) continue;
    // One batch is one transaction: the schema change and its record land together.
    const statements = splitStatements(migration.sql).map((sql) => db.prepare(sql));
    statements.push(db.prepare(`INSERT INTO ${TABLE} (name) VALUES (?)`).bind(migration.name));
    try {
      await db.batch(statements);
      ran.push(migration.name);
    } catch (error) {
      // Another request may have applied it at the same moment.
      applied = await appliedNames(db);
      if (applied.has(migration.name)) continue;
      const reason = error instanceof Error ? error.message : String(error);
      throw new MigrationError(`KontrolWP could not update its database (${migration.name}): ${reason}`);
    }
  }
  return ran;
}
