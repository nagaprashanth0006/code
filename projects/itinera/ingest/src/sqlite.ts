/** SqlExecutor over Node's built-in SQLite (node:sqlite), for scripts and tests. */
import { DatabaseSync } from "node:sqlite";
import type { SqlExecutor, SqlValue } from "@itinera/core";

export function openSqlite(path: string): SqlExecutor & { close(): void } {
  const db = new DatabaseSync(path);
  return {
    async execute(sql: string, params: readonly SqlValue[] = []) {
      if (params.length === 0) {
        db.exec(sql);
        return { rowsAffected: 0 };
      }
      const r = db.prepare(sql).run(...params);
      return { rowsAffected: Number(r.changes) };
    },
    async select<T>(sql: string, params: readonly SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    close: () => db.close(),
  };
}
