// A site's list (plugins, users, updates...) is read again at every sync, and
// it is nearly always the same as last time. D1 counts every row written, and
// the free plan allows 100,000 a day, so rewriting whole lists each hour adds
// up quickly. These helpers write only the rows that changed.

type Value = string | number | null;

export interface SiteRows {
  table: string;
  siteId: number;
  /** Columns besides site_id that identify a row (its primary key). */
  key: string[];
  /** Every stored column besides site_id, key columns included. */
  columns: string[];
  /** The fresh list, each row's values in `columns` order. */
  rows: Value[][];
}

// A value bound as a number to a text column reads back as text, so compare as text.
const same = (a: Value, b: Value) => (a === null || b === null ? a === b : String(a) === String(b));

/**
 * The statements that turn the stored rows into `rows`: an insert for each
 * new or changed row and a delete for each one gone. Empty when nothing changed.
 */
export async function siteRowChanges(db: D1Database, spec: SiteRows): Promise<D1PreparedStatement[]> {
  const { table, siteId, key, columns, rows } = spec;
  const keyIndex = key.map((name) => columns.indexOf(name));
  const keyOf = (row: Value[]) => JSON.stringify(keyIndex.map((i) => (row[i] === null ? null : String(row[i]))));
  const { results } = await db
    .prepare(`SELECT ${columns.join(", ")} FROM ${table} WHERE site_id = ?`)
    .bind(siteId)
    .all<Record<string, Value>>();
  const stored = new Map(results.map((record) => {
    const row = columns.map((name) => record[name] ?? null);
    return [keyOf(row), row] as const;
  }));

  const statements: D1PreparedStatement[] = [];
  const insert = db.prepare(
    `INSERT OR REPLACE INTO ${table} (site_id, ${columns.join(", ")}) VALUES (?${", ?".repeat(columns.length)})`,
  );
  const fresh = new Set<string>();
  for (const row of rows) {
    const id = keyOf(row);
    // The last of two rows with one key wins, as it would with INSERT OR REPLACE.
    fresh.add(id);
    const old = stored.get(id);
    if (old && old.every((value, i) => same(value, row[i]))) continue;
    stored.set(id, row);
    statements.push(insert.bind(siteId, ...row));
  }
  const remove = db.prepare(`DELETE FROM ${table} WHERE site_id = ?${key.map((name) => ` AND ${name} = ?`).join("")}`);
  for (const [id, row] of stored) {
    if (!fresh.has(id)) statements.push(remove.bind(siteId, ...keyIndex.map((i) => row[i])));
  }
  return statements;
}
