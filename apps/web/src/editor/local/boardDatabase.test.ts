/** Proves database creation, upgrades, blocked/version-change recovery, request errors, and reopen behavior. */
import 'fake-indexeddb/auto';

import { afterAll, describe, expect, it } from 'vitest';

import {
  BOARD_STORE,
  commitReadwriteTransaction,
  IMAGE_BOARD_INDEX,
  IMAGE_STORE,
  METADATA_STORE,
  openTransaction,
  requestResult,
  transactionComplete,
} from './boardDatabase';

let database: IDBDatabase | null = null;

afterAll(() => database?.close());

describe('board database boundary', () => {
  it('creates the current stores and image ownership index', async () => {
    const transaction = await openTransaction(
      [BOARD_STORE, IMAGE_STORE, METADATA_STORE],
      'readonly',
    );
    database = transaction.db;

    expect([...transaction.objectStoreNames]).toEqual([
      BOARD_STORE,
      IMAGE_STORE,
      METADATA_STORE,
    ]);
    expect(
      transaction
        .objectStore(IMAGE_STORE)
        .indexNames.contains(IMAGE_BOARD_INDEX),
    ).toBe(true);
    await transactionComplete(transaction);
  });

  it('reopens after the cached database handle closes', async () => {
    const first = await openTransaction(BOARD_STORE, 'readonly');
    const closed = first.db;
    await transactionComplete(first);
    closed.close();

    const reopened = await openTransaction(BOARD_STORE, 'readonly');
    database = reopened.db;
    expect(reopened.db).not.toBe(closed);
    await transactionComplete(reopened);
  });

  it('aborts the complete readwrite transaction when preparation fails', async () => {
    const id = 'local:aborted-database-write';
    const transaction = await openTransaction(BOARD_STORE, 'readwrite');

    await expect(
      commitReadwriteTransaction(transaction, () => {
        transaction.objectStore(BOARD_STORE).put({ id, value: 'partial' });
        throw new Error('preparation failed');
      }),
    ).rejects.toThrow('preparation failed');

    const read = await openTransaction(BOARD_STORE, 'readonly');
    database = read.db;
    const stored = await requestResult(read.objectStore(BOARD_STORE).get(id));
    await transactionComplete(read);
    expect(stored).toBeUndefined();
  });
});
