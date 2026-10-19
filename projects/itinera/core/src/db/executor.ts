/**
 * The only way the core touches storage. Each platform adapts its SQLite
 * binding to this: tauri-plugin-sql in the app, sql.js in the browser harness,
 * node:sqlite in tests and ingestion scripts. Parameters are positional (`?`).
 */
export type SqlValue = string | number | null;

export interface SqlExecutor {
  execute(sql: string, params?: readonly SqlValue[]): Promise<{ rowsAffected: number }>;
  select<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

/** Splits rows into multi-row INSERTs that stay under SQLite's variable limit. */
export async function insertRows(
  db: SqlExecutor,
  head: string,
  columns: number,
  rows: readonly (readonly SqlValue[])[],
  tail = "",
): Promise<void> {
  const perStatement = Math.max(1, Math.floor(900 / columns));
  const placeholder = `(${new Array(columns).fill("?").join(",")})`;
  for (let i = 0; i < rows.length; i += perStatement) {
    const chunk = rows.slice(i, i + perStatement);
    await db.execute(`${head} VALUES ${chunk.map(() => placeholder).join(",")} ${tail}`, chunk.flat());
  }
}
