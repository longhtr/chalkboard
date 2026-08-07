/** Implements local trash retention, restore, and permanent board-owned asset deletion. */
import { bestEffortLocalStorage } from '../../bestEffortStorage';
import {
  BOARD_STORE,
  commitReadwriteTransaction,
  IMAGE_STORE,
  openTransaction,
  requestResult,
  transactionComplete,
} from './boardDatabase';
import {
  LEGACY_LOCAL_BOARD_ID,
  LOCAL_DOCUMENT_CACHE_KEY,
  localDocumentCacheKey,
  localPendingDocumentKey,
  localPendingTitleKey,
  LOCAL_TITLE_CACHE_KEY,
  localTitleCacheKey,
  publishLocalBoardUpdate,
} from './localBoardCache';
import {
  storedImagesForBoard,
  type StoredImageRecord,
} from './localBoardImageStorage';
import { localPendingBoardPatchKey } from './localBoardPatchRecovery';
import {
  LOCAL_BOARD_PREFIX,
  LOCAL_BOARD_TRASH_RETENTION_MS,
  storedLocalBoardId,
  type CloudBoardCacheRecord,
  type LocalBoardSummary,
  type StoredBoardRecord,
  type TrashedLocalBoardSummary,
} from './localBoardRecords';
import {
  enqueueLocalBoardWrite,
  waitForLocalBoardWrites,
} from './localBoardWriteQueue';
import { localPendingEquationEditKey } from './localEquationRecovery';

function removeLocalBoardCaches(boardId: string): void {
  bestEffortLocalStorage.removeItem(localDocumentCacheKey(boardId));
  bestEffortLocalStorage.removeItem(localPendingDocumentKey(boardId));
  bestEffortLocalStorage.removeItem(localPendingEquationEditKey(boardId));
  bestEffortLocalStorage.removeItem(localPendingBoardPatchKey(boardId));
  bestEffortLocalStorage.removeItem(localPendingTitleKey(boardId));
  bestEffortLocalStorage.removeItem(localTitleCacheKey(boardId));
  if (boardId === LEGACY_LOCAL_BOARD_ID) {
    bestEffortLocalStorage.removeItem(LOCAL_DOCUMENT_CACHE_KEY);
    bestEffortLocalStorage.removeItem(LOCAL_TITLE_CACHE_KEY);
  }
}

/** Lists reversibly deleted local boards newest deletion first. */
export async function listTrashedLocalBoards(): Promise<
  TrashedLocalBoardSummary[]
> {
  await purgeExpiredLocalBoards();
  await waitForLocalBoardWrites();
  const transaction = await openTransaction(BOARD_STORE, 'readonly');
  const records = await requestResult(
    transaction.objectStore(BOARD_STORE).getAll() as IDBRequest<
      (StoredBoardRecord | CloudBoardCacheRecord)[]
    >,
  );
  await transactionComplete(transaction);

  return records
    .flatMap((record): TrashedLocalBoardSummary[] => {
      if (
        !record.id.startsWith(LOCAL_BOARD_PREFIX) ||
        !('trashedAt' in record) ||
        typeof record.trashedAt !== 'number' ||
        !Number.isFinite(record.trashedAt)
      ) {
        return [];
      }
      const id = record.id.slice(LOCAL_BOARD_PREFIX.length);
      if (id === '') return [];
      const updatedAt =
        typeof record.updatedAt === 'number' &&
        Number.isFinite(record.updatedAt)
          ? record.updatedAt
          : record.trashedAt;
      return [
        {
          createdAt:
            'createdAt' in record &&
            typeof record.createdAt === 'number' &&
            Number.isFinite(record.createdAt)
              ? record.createdAt
              : updatedAt,
          id,
          title:
            typeof record.title === 'string' && record.title.trim() !== ''
              ? record.title
              : 'Untitled board',
          trashedAt: record.trashedAt,
          updatedAt,
        },
      ];
    })
    .sort((left, right) => right.trashedAt - left.trashedAt);
}

/** Marks one live local board deleted without removing its content or images. */
export async function trashLocalBoard(
  boardId: string,
): Promise<TrashedLocalBoardSummary | null> {
  const trashed = await enqueueLocalBoardWrite(async () => {
    const transaction = await openTransaction(BOARD_STORE, 'readwrite');
    return commitReadwriteTransaction(transaction, async () => {
      const boards = transaction.objectStore(BOARD_STORE);
      const [current, legacy] = await Promise.all([
        requestResult(
          boards.get(storedLocalBoardId(boardId)) as IDBRequest<
            StoredBoardRecord | undefined
          >,
        ),
        boardId === LEGACY_LOCAL_BOARD_ID
          ? requestResult(
              boards.get(LEGACY_LOCAL_BOARD_ID) as IDBRequest<
                StoredBoardRecord | undefined
              >,
            )
          : Promise.resolve(undefined),
      ]);
      const stored = current ?? legacy;
      if (stored === undefined) return null;
      const trashedAt = Date.now();
      const updatedAt = Math.max(trashedAt, stored.updatedAt + 1);
      boards.put({
        ...stored,
        id: storedLocalBoardId(boardId),
        trashedAt,
        updatedAt,
      } satisfies StoredBoardRecord);
      if (boardId === LEGACY_LOCAL_BOARD_ID) {
        boards.delete(LEGACY_LOCAL_BOARD_ID);
      }
      return {
        createdAt: stored.createdAt ?? stored.updatedAt,
        id: boardId,
        title: stored.title,
        trashedAt,
        updatedAt,
      };
    });
  });
  if (trashed !== null) {
    removeLocalBoardCaches(boardId);
    publishLocalBoardUpdate(boardId, trashed.updatedAt);
  }
  return trashed;
}

/** Restores one trashed board and resolves title collisions deterministically. */
export async function restoreLocalBoard(
  boardId: string,
): Promise<LocalBoardSummary | null> {
  const restored = await enqueueLocalBoardWrite(async () => {
    const transaction = await openTransaction(BOARD_STORE, 'readwrite');
    return commitReadwriteTransaction(transaction, async () => {
      const boards = transaction.objectStore(BOARD_STORE);
      const stored = await requestResult(
        boards.get(storedLocalBoardId(boardId)) as IDBRequest<
          StoredBoardRecord | undefined
        >,
      );
      if (stored === undefined || typeof stored.trashedAt !== 'number') {
        return null;
      }
      const updatedAt = Math.max(Date.now(), stored.updatedAt + 1);
      const { trashedAt: _trashedAt, ...active } = stored;
      void _trashedAt;
      boards.put({ ...active, updatedAt } satisfies StoredBoardRecord);
      return {
        createdAt: stored.createdAt ?? stored.updatedAt,
        id: boardId,
        title: stored.title,
        updatedAt,
      };
    });
  });
  if (restored !== null) publishLocalBoardUpdate(boardId, restored.updatedAt);
  return restored;
}

/** Restores every trashed board atomically and returns the restored count. */
export async function restoreAllLocalBoards(): Promise<number> {
  const restored = await enqueueLocalBoardWrite(async () => {
    const transaction = await openTransaction(BOARD_STORE, 'readwrite');
    return commitReadwriteTransaction(transaction, async () => {
      const boards = transaction.objectStore(BOARD_STORE);
      const records = await requestResult(
        boards.getAll() as IDBRequest<
          (StoredBoardRecord | CloudBoardCacheRecord)[]
        >,
      );
      const restoredRecords: { boardId: string; updatedAt: number }[] = [];
      for (const record of records) {
        if (
          !record.id.startsWith(LOCAL_BOARD_PREFIX) ||
          !('trashedAt' in record) ||
          typeof record.trashedAt !== 'number'
        ) {
          continue;
        }
        const boardId = record.id.slice(LOCAL_BOARD_PREFIX.length);
        if (boardId === '') continue;
        const updatedAt = Math.max(Date.now(), record.updatedAt + 1);
        const { trashedAt: _trashedAt, ...active } = record;
        void _trashedAt;
        boards.put({ ...active, updatedAt } satisfies StoredBoardRecord);
        restoredRecords.push({ boardId, updatedAt });
      }
      return restoredRecords;
    });
  });
  for (const { boardId, updatedAt } of restored) {
    publishLocalBoardUpdate(boardId, updatedAt);
  }
  return restored.length;
}

/** Permanently deletes boards whose trash retention deadline has elapsed. */
export async function purgeExpiredLocalBoards(
  now = Date.now(),
): Promise<number> {
  const expiredIds = await enqueueLocalBoardWrite(async () => {
    const transaction = await openTransaction(
      [BOARD_STORE, IMAGE_STORE],
      'readwrite',
    );
    return commitReadwriteTransaction(transaction, async () => {
      const boards = transaction.objectStore(BOARD_STORE);
      const images = transaction.objectStore(IMAGE_STORE);
      const [records, imageRecords] = await Promise.all([
        requestResult(
          boards.getAll() as IDBRequest<
            (StoredBoardRecord | CloudBoardCacheRecord)[]
          >,
        ),
        requestResult(images.getAll() as IDBRequest<StoredImageRecord[]>),
      ]);
      const expired = new Set<string>();
      for (const record of records) {
        if (
          record.id.startsWith(LOCAL_BOARD_PREFIX) &&
          'trashedAt' in record &&
          typeof record.trashedAt === 'number' &&
          record.trashedAt + LOCAL_BOARD_TRASH_RETENTION_MS <= now
        ) {
          boards.delete(record.id);
          expired.add(record.id.slice(LOCAL_BOARD_PREFIX.length));
        }
      }
      for (const image of imageRecords) {
        if (
          (image.boardId !== undefined && expired.has(image.boardId)) ||
          (image.boardId === undefined && expired.has(LEGACY_LOCAL_BOARD_ID))
        ) {
          images.delete(image.id);
        }
      }
      return expired;
    });
  });
  const updatedAt = Date.now();
  for (const boardId of expiredIds) {
    removeLocalBoardCaches(boardId);
    publishLocalBoardUpdate(boardId, updatedAt);
  }
  return expiredIds.size;
}

/** Atomically removes every trashed board, image, and recovery cache. */
export async function permanentlyDeleteAllTrashedLocalBoards(): Promise<number> {
  const deletedIds = await enqueueLocalBoardWrite(async () => {
    const transaction = await openTransaction(
      [BOARD_STORE, IMAGE_STORE],
      'readwrite',
    );
    return commitReadwriteTransaction(transaction, async () => {
      const boards = transaction.objectStore(BOARD_STORE);
      const images = transaction.objectStore(IMAGE_STORE);
      const [records, imageRecords] = await Promise.all([
        requestResult(
          boards.getAll() as IDBRequest<
            (StoredBoardRecord | CloudBoardCacheRecord)[]
          >,
        ),
        requestResult(images.getAll() as IDBRequest<StoredImageRecord[]>),
      ]);
      const deleted = new Set<string>();
      for (const record of records) {
        if (
          record.id.startsWith(LOCAL_BOARD_PREFIX) &&
          'trashedAt' in record &&
          typeof record.trashedAt === 'number'
        ) {
          boards.delete(record.id);
          deleted.add(record.id.slice(LOCAL_BOARD_PREFIX.length));
        }
      }
      for (const image of imageRecords) {
        if (
          (image.boardId !== undefined && deleted.has(image.boardId)) ||
          (image.boardId === undefined && deleted.has(LEGACY_LOCAL_BOARD_ID))
        ) {
          images.delete(image.id);
        }
      }
      return deleted;
    });
  });
  const updatedAt = Date.now();
  for (const boardId of deletedIds) {
    removeLocalBoardCaches(boardId);
    publishLocalBoardUpdate(boardId, updatedAt);
  }
  return deletedIds.size;
}

/** Permanently removes one trashed board, its images, and recovery caches. */
export async function permanentlyDeleteLocalBoard(
  boardId: string,
): Promise<void> {
  await enqueueLocalBoardWrite(async () => {
    const transaction = await openTransaction(
      [BOARD_STORE, IMAGE_STORE],
      'readwrite',
    );
    return commitReadwriteTransaction(transaction, async () => {
      const boards = transaction.objectStore(BOARD_STORE);
      const images = transaction.objectStore(IMAGE_STORE);
      boards.delete(storedLocalBoardId(boardId));
      if (boardId === LEGACY_LOCAL_BOARD_ID)
        boards.delete(LEGACY_LOCAL_BOARD_ID);
      const imageRecords = await storedImagesForBoard(images, boardId);
      for (const image of imageRecords) {
        if (
          image.boardId === boardId ||
          (boardId === LEGACY_LOCAL_BOARD_ID && image.boardId === undefined)
        ) {
          images.delete(image.id);
        }
      }
    });
  });
  removeLocalBoardCaches(boardId);
  publishLocalBoardUpdate(boardId, Date.now());
}
