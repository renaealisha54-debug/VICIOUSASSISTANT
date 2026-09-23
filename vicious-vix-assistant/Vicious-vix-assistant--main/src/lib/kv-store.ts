import { CapgoCapacitorDataStorageSqlite } from '@capgo/capacitor-data-storage-sqlite';

const DATABASE = 'vicious_store';
const TABLE = 'kv';

let readyPromise: Promise<void> | null = null;

async function migrateFromLocalStorage(): Promise<void> {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    await CapgoCapacitorDataStorageSqlite.get({ key: '__migrated__' });
    return; // already migrated, get() succeeded
  } catch {
    // not migrated yet, fall through
  }
  const keys = Object.keys(window.localStorage);
  for (const k of keys) {
    const v = window.localStorage.getItem(k);
    if (v !== null) {
      try {
        await CapgoCapacitorDataStorageSqlite.set({ key: k, value: v });
      } catch (e) {
        console.warn('kv-store: migration failed for key', k, e);
      }
    }
  }
  try {
    await CapgoCapacitorDataStorageSqlite.set({ key: '__migrated__', value: 'true' });
  } catch (e) {
    console.warn('kv-store: failed to mark migration complete', e);
  }
}

function ensureStore(): Promise<void> {
  if (!readyPromise) {
    readyPromise = CapgoCapacitorDataStorageSqlite.openStore({ database: DATABASE, table: TABLE })
      .then(() => CapgoCapacitorDataStorageSqlite.setTable({ table: TABLE }))
      .then(() => migrateFromLocalStorage());
  }
  return readyPromise;
}

export async function kvGet(key: string): Promise<string | null> {
  await ensureStore();
  try {
    const res = await CapgoCapacitorDataStorageSqlite.get({ key });
    return res.value ?? null;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  await ensureStore();
  await CapgoCapacitorDataStorageSqlite.set({ key, value });
}

export async function kvRemove(key: string): Promise<void> {
  await ensureStore();
  try {
    await CapgoCapacitorDataStorageSqlite.remove({ key });
  } catch {
    // key didn't exist, fine
  }
}

export async function testSqliteStore(): Promise<string> {
  try {
    await kvSet('__sqlite_test__', 'ok');
    const result = await kvGet('__sqlite_test__');
    return result === 'ok' ? 'SQLite store working correctly.' : `SQLite store returned unexpected value: ${result}`;
  } catch (e: any) {
    return `SQLite store test FAILED: ${e?.message || e}`;
  }
}
