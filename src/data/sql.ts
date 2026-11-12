export type SqlValue = string | number | null;

/**
 * The few database operations the app needs. Implemented for expo-sqlite on
 * the phone and for node:sqlite in tests, so the same SQL is tested.
 */
export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T | null>;
  /** Runs `fn` between BEGIN and COMMIT on the same connection; rolls back on error. */
  transaction(fn: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

/** Serializes database work so a transaction is never interleaved with other queries. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
