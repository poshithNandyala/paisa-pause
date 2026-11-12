import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { Repository } from './repository';
import type { SqlDriver } from './sql';

export type StorageKind = 'real' | 'demo';

const DB_NAMES: Record<StorageKind, string> = {
  real: 'paisa-pause.db',
  demo: 'paisa-pause-sample.db',
};

const KEY_NAMES: Record<StorageKind, string> = {
  real: 'paisa_pause_db_key_v1',
  demo: 'paisa_pause_sample_db_key_v1',
};

export interface EncryptionInfo {
  /** True only when SQLCipher answered `PRAGMA cipher_version` on this database. */
  on: boolean;
  cipherVersion: string | null;
}

export interface OpenedStorage {
  kind: StorageKind;
  repo: Repository;
  encryption: EncryptionInfo;
}

/** The database exists but can't be opened with the stored key. */
export class LockedError extends Error {}

function expoDriver(db: SQLite.SQLiteDatabase): SqlDriver {
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params = []) => {
      const res = await db.runAsync(sql, params);
      return { changes: res.changes };
    },
    all: (sql, params = []) => db.getAllAsync(sql, params),
    get: (sql, params = []) => db.getFirstAsync(sql, params),
    transaction: (fn) => db.withTransactionAsync(fn),
    close: () => db.closeAsync(),
  };
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

async function getOrCreateKey(kind: StorageKind): Promise<{ key: string; created: boolean }> {
  const existing = await SecureStore.getItemAsync(KEY_NAMES[kind]);
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return { key: existing, created: false };
  // 32 random bytes from the platform's secure random source.
  const key = toHex(Crypto.getRandomBytes(32));
  await SecureStore.setItemAsync(KEY_NAMES[kind], key);
  return { key, created: true };
}

/**
 * Open the encrypted database. The key is random, kept in Android's
 * Keystore-backed secure storage, and set before any other statement.
 * If this build has no SQLCipher, `PRAGMA key` is silently ignored by SQLite —
 * so we check `PRAGMA cipher_version` and report encryption honestly.
 */
export async function openStorage(kind: StorageKind): Promise<OpenedStorage> {
  const { key } = await getOrCreateKey(kind);
  const db = await SQLite.openDatabaseAsync(DB_NAMES[kind]);
  try {
    await db.execAsync(`PRAGMA key = "x'${key}'";`);
    // Fails with "file is not a database" if the key is wrong.
    await db.getFirstAsync('SELECT COUNT(*) AS n FROM sqlite_master');
  } catch {
    await db.closeAsync().catch(() => undefined);
    throw new LockedError(
      "Your saved data can't be unlocked on this phone. This can happen if the app's secure key was cleared.",
    );
  }
  const cipher = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version').catch(() => null);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const encryption: EncryptionInfo = {
    on: Boolean(cipher?.cipher_version),
    cipherVersion: cipher?.cipher_version ?? null,
  };
  return { kind, repo: new Repository(expoDriver(db)), encryption };
}

/** Permanently delete a database file and its key. */
export async function destroyStorage(kind: StorageKind, opened?: OpenedStorage | null): Promise<void> {
  if (opened) {
    await opened.repo.wipeRows().catch(() => undefined);
    await opened.repo.close().catch(() => undefined);
  }
  await SQLite.deleteDatabaseAsync(DB_NAMES[kind]).catch(() => undefined);
  await SecureStore.deleteItemAsync(KEY_NAMES[kind]).catch(() => undefined);
}

export function newId(): string {
  return Crypto.randomUUID();
}
