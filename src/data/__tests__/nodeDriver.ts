import { DatabaseSync } from 'node:sqlite';
import type { SqlDriver, SqlValue } from '../sql';

/** Test-only driver: the same SQL the phone runs, on Node's built-in SQLite. */
export function nodeDriver(path = ':memory:'): SqlDriver {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  const plain = (row: unknown) => (row ? { ...(row as Record<string, unknown>) } : null);
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params: SqlValue[] = []) {
      const res = db.prepare(sql).run(...params);
      return { changes: Number(res.changes) };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params).map((r) => plain(r) as T);
    },
    async get<T>(sql: string, params: SqlValue[] = []) {
      return plain(db.prepare(sql).get(...params)) as T | null;
    },
    async transaction(fn) {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async close() {
      db.close();
    },
  };
}
