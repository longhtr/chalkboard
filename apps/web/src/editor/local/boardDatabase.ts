/**
 * Owns the IndexedDB connection lifetime, schema upgrade, stale-handle reopen,
 * blocked/version-change handling, and promise wrappers for requests/transactions.
 */
import { CHALKBOARD_SCHEMA_VERSIONS } from '@chalkboard/shared';

/** IndexedDB store containing local and cloud-cache board records. */
export const BOARD_STORE = 'boards';
/** IndexedDB store containing board-scoped immutable image blobs. */
export const IMAGE_STORE = 'images';
/** Image-store index used for complete board cleanup and archive resolution. */
export const IMAGE_BOARD_INDEX = 'boardId';
/** IndexedDB store containing migration and initialization markers. */
export const METADATA_STORE = 'metadata';
const DATABASE_NAME = 'chalkboard-local';
const DATABASE_VERSION = CHALKBOARD_SCHEMA_VERSIONS.indexedDb;

let databaseInstance: IDBDatabase | null = null;
let databasePromise: Promise<IDBDatabase> | null = null;

/** Converts one IndexedDB request's success/error events into a promise. */
export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () =>
      reject(request.error ?? new Error('IndexedDB request failed')),
    );
  });
}

/** Resolves only after transaction commit and rejects abort/error outcomes. */
export function transactionComplete(
  transaction: IDBTransaction,
): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted')),
    );
    transaction.addEventListener('error', () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed')),
    );
  });
}

/** Runs an operation and explicitly commits, aborting cleanly after failure. */
export async function commitReadwriteTransaction<T>(
  transaction: IDBTransaction,
  operation: () => T | Promise<T>,
): Promise<T> {
  const completion = transactionComplete(transaction);
  try {
    const result = await operation();
    await completion;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction already failed or committed.
    }
    await completion.catch(() => {
      // Preserve the operation failure that triggered this abort.
    });
    throw error;
  }
}

function invalidateDatabase(database: IDBDatabase): void {
  database.close();
  if (databaseInstance === database) {
    databaseInstance = null;
    databasePromise = null;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise !== null) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BOARD_STORE)) {
        database.createObjectStore(BOARD_STORE, { keyPath: 'id' });
      }
      let images: IDBObjectStore;
      if (database.objectStoreNames.contains(IMAGE_STORE)) {
        const upgradeTransaction = request.transaction;
        if (upgradeTransaction === null) {
          settled = true;
          reject(new Error('IndexedDB upgrade transaction is unavailable'));
          return;
        }
        images = upgradeTransaction.objectStore(IMAGE_STORE);
      } else {
        images = database.createObjectStore(IMAGE_STORE, { keyPath: 'id' });
      }
      if (!images.indexNames.contains(IMAGE_BOARD_INDEX)) {
        images.createIndex(IMAGE_BOARD_INDEX, 'boardId');
      }
      if (!database.objectStoreNames.contains(METADATA_STORE)) {
        database.createObjectStore(METADATA_STORE, { keyPath: 'id' });
      }
    });
    request.addEventListener('success', () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      databaseInstance = database;
      database.addEventListener('versionchange', () =>
        invalidateDatabase(database),
      );
      resolve(database);
    });
    request.addEventListener('blocked', () => {
      if (settled) return;
      settled = true;
      databasePromise = null;
      reject(new Error('IndexedDB upgrade was blocked'));
    });
    request.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      databasePromise = null;
      reject(request.error ?? new Error('Could not open IndexedDB'));
    });
  });
  return databasePromise;
}

/** Opens the versioned database and returns a transaction over requested stores. */
export async function openTransaction(
  storeNames: string | string[],
  mode: IDBTransactionMode,
): Promise<IDBTransaction> {
  let database = await openDatabase();
  try {
    return database.transaction(storeNames, mode);
  } catch (error) {
    if (
      !(error instanceof DOMException) ||
      error.name !== 'InvalidStateError'
    ) {
      throw error;
    }
    invalidateDatabase(database);
    database = await openDatabase();
    return database.transaction(storeNames, mode);
  }
}
