/**
 * Atomic IndexedDB storage for local boards, owned image blobs, metadata, and
 * cloud recovery cache. Previous durable state remains until one transaction
 * commits; revision checks reject stale writers before mutation.
 */
import type { BoardElement } from '@chalkboard/shared';

import {
  BOARD_STORE,
  commitReadwriteTransaction,
  IMAGE_STORE,
  openTransaction,
  requestResult,
  transactionComplete,
} from './boardDatabase';
import { parseStoredElements } from '../model/boardSerialization';
import {
  cloudRecoveryPendingSince,
  type CloudBoardCacheWrite,
  decodePendingCloudUpdates,
  LatestKeyedWriteQueue,
  MAX_QUEUED_CLOUD_CACHE_BOARDS,
  validatedCloudBoardCacheState,
  validateStoredCloudBoardCacheDocuments,
} from '../cloud/cloudBoardCacheQueue';
import {
  blobFromImageDataUrl,
  imageDataUrlFromBlob,
  prepareBoardForStorage,
  storageElements,
  storedImagesForBoard,
  storedLocalImageId,
  type StoredImageRecord,
} from './localBoardImageStorage';
import {
  BOARD_SYNC_CHANNEL,
  cacheLocalElements,
  cacheLocalTitle,
  cachePendingLocalElements,
  LEGACY_LOCAL_BOARD_ID,
  LOCAL_DOCUMENT_CACHE_KEY,
  LOCAL_PENDING_DOCUMENT_KEY,
  LOCAL_PENDING_TITLE_KEY,
  LOCAL_TITLE_CACHE_KEY,
  localDocumentCacheKey,
  localPendingDocumentKey,
  localPendingTitleKey,
  localTitleCacheKey,
} from './localBoardCache';
import {
  coordinateLocalBoardSave,
  isStaleLocalBoardRevision,
} from './localBoardSaveCoordinator';
import {
  CLOUD_BOARD_PREFIX,
  LOCAL_BOARD_SCHEMA_VERSION,
  LOCAL_BOARD_TRASH_RETENTION_MS,
  storedLocalBoardId,
  type CloudBoardCacheRecord,
  type LocalBoardRecord,
  type LocalBoardSaveResult,
  type LocalBoardStorageInitialization,
  type LocalBoardSummary,
  type LocalBoardWrite,
  type StoredBoardRecord,
  type TrashedLocalBoardSummary,
} from './localBoardRecords';
import { initializeLocalBoardRecords } from './localBoardMigration';
import {
  createLocalBoardMetadata,
  duplicateLocalBoardMetadata,
  listLocalBoardMetadata,
  renameLocalBoardMetadata,
} from './localBoardMetadata';
import {
  enqueueLocalBoardWrite,
  waitForLocalBoardWrites,
} from './localBoardWriteQueue';
import {
  reconcileStructuredBoardContent,
  structuredContentForElements,
} from '../portability/structuredBoardContent';

export {
  BOARD_SYNC_CHANNEL,
  cacheLocalElements,
  cacheLocalTitle,
  cachePendingLocalElements,
  LEGACY_LOCAL_BOARD_ID,
  LOCAL_DOCUMENT_CACHE_KEY,
  LOCAL_PENDING_DOCUMENT_KEY,
  LOCAL_PENDING_TITLE_KEY,
  LOCAL_TITLE_CACHE_KEY,
  localDocumentCacheKey,
  localPendingDocumentKey,
  localPendingTitleKey,
  localTitleCacheKey,
};
export {
  blobFromImageDataUrl,
  imageDataUrlFromBlob,
  LOCAL_BOARD_TRASH_RETENTION_MS,
  prepareBoardForStorage,
  structuredContentForElements,
};
export type {
  LocalBoardRecord,
  LocalBoardSaveResult,
  LocalBoardStorageInitialization,
  LocalBoardSummary,
  LocalBoardWrite,
  TrashedLocalBoardSummary,
};
export {
  listTrashedLocalBoards,
  permanentlyDeleteAllTrashedLocalBoards,
  permanentlyDeleteLocalBoard,
  purgeExpiredLocalBoards,
  restoreAllLocalBoards,
  restoreLocalBoard,
  trashLocalBoard,
} from './localBoardTrash';

async function saveLocalBoardNow(
  record: LocalBoardWrite,
  boardId: string,
): Promise<boolean> {
  const prepared = storageElements(record.elements);
  const transaction = await openTransaction(
    [BOARD_STORE, IMAGE_STORE],
    'readwrite',
  );
  return commitReadwriteTransaction(transaction, async () => {
    const boards = transaction.objectStore(BOARD_STORE);
    const images = transaction.objectStore(IMAGE_STORE);
    const retainedImageIds = new Set(
      prepared.images.map(({ id }) => storedLocalImageId(boardId, id)),
    );
    const existingBoardRequest = requestResult(
      boards.get(storedLocalBoardId(boardId)) as IDBRequest<
        StoredBoardRecord | undefined
      >,
    );
    const legacyBoardRequest =
      boardId === LEGACY_LOCAL_BOARD_ID
        ? requestResult(
            boards.get(LEGACY_LOCAL_BOARD_ID) as IDBRequest<
              StoredBoardRecord | undefined
            >,
          )
        : Promise.resolve(undefined);
    const existingImagesRequest = storedImagesForBoard(images, boardId);
    const [existingBoard, legacyBoard, existingImages] = await Promise.all([
      existingBoardRequest,
      legacyBoardRequest,
      existingImagesRequest,
    ]);
    const previous = existingBoard ?? legacyBoard;
    if (
      typeof previous?.trashedAt === 'number' &&
      Number.isFinite(previous.trashedAt)
    ) {
      throw new Error('Cannot save a board while it is in trash');
    }
    if (isStaleLocalBoardRevision(existingBoard?.updatedAt, record.updatedAt))
      return false;
    for (const image of existingImages) {
      const belongsToBoard =
        image.boardId === boardId ||
        (boardId === LEGACY_LOCAL_BOARD_ID && image.boardId === undefined);
      if (belongsToBoard && !retainedImageIds.has(image.id)) {
        images.delete(image.id);
      }
    }
    const existingImageIds = new Set(existingImages.map(({ id }) => id));
    for (const element of prepared.images) {
      const id = storedLocalImageId(boardId, element.id);
      // Image content is immutable for an element identity. Imports and copies
      // assign a new element ID, so unchanged images never need re-decoding.
      if (existingImageIds.has(id)) continue;
      images.put({
        blob: blobFromImageDataUrl(element.source),
        boardId,
        elementId: element.id,
        id,
      } satisfies StoredImageRecord);
    }
    boards.put({
      createdAt:
        record.createdAt ??
        existingBoard?.createdAt ??
        existingBoard?.updatedAt ??
        legacyBoard?.createdAt ??
        legacyBoard?.updatedAt ??
        record.updatedAt,
      elements: prepared.elements,
      id: storedLocalBoardId(boardId),
      mixedContentByElementId:
        record.mixedContentByElementId ??
        structuredContentForElements(record.elements),
      schemaVersion: LOCAL_BOARD_SCHEMA_VERSION,
      title: record.title,
      updatedAt: record.updatedAt,
    } satisfies StoredBoardRecord);
    if (boardId === LEGACY_LOCAL_BOARD_ID) boards.delete(LEGACY_LOCAL_BOARD_ID);
    return true;
  });
}

/**
 * Queues one local-board replacement. The coordinator preserves write order,
 * rejects stale revisions, and publishes caches only after IndexedDB commits.
 */
export function saveLocalBoard(
  record: LocalBoardWrite,
  boardId = LEGACY_LOCAL_BOARD_ID,
): Promise<LocalBoardSaveResult> {
  const { serializedElementsForCaches, ...recordWithoutSerialized } = record;
  const structured = reconcileStructuredBoardContent(
    record.elements,
    record.mixedContentByElementId,
  );
  const reconciledRecord: LocalBoardWrite = {
    ...recordWithoutSerialized,
    elements: structured.elements,
    mixedContentByElementId: structured.mixedContentByElementId,
    ...(!structured.sourceChanged && serializedElementsForCaches !== undefined
      ? { serializedElementsForCaches }
      : {}),
  };
  return coordinateLocalBoardSave({
    boardId,
    loadCurrent: () => loadLocalBoard(boardId),
    record: reconciledRecord,
    saveDurably: () =>
      enqueueLocalBoardWrite(() =>
        saveLocalBoardNow(reconciledRecord, boardId),
      ),
  });
}

async function saveCloudBoardCacheNow(
  boardId: string,
  record: CloudBoardCacheWrite<BoardElement>,
): Promise<void> {
  const { pending, pendingSince, pendingUpdates } =
    validatedCloudBoardCacheState(record);
  return enqueueLocalBoardWrite(async () => {
    const transaction = await openTransaction(BOARD_STORE, 'readwrite');
    await commitReadwriteTransaction(transaction, () => {
      transaction.objectStore(BOARD_STORE).put({
        ...(record.baselineElements === undefined
          ? {}
          : { baselineElements: record.baselineElements }),
        ...(record.baselineTitle === undefined
          ? {}
          : { baselineTitle: record.baselineTitle }),
        elements: record.elements,
        id: `${CLOUD_BOARD_PREFIX}${boardId}`,
        pending,
        ...(pendingSince === null ? {} : { pendingSince }),
        ...(record.pendingUpdates === undefined ? {} : { pendingUpdates }),
        schemaVersion: LOCAL_BOARD_SCHEMA_VERSION,
        title: record.title,
        updatedAt: record.updatedAt,
      } satisfies CloudBoardCacheRecord);
    });
  });
}

const cloudCacheWrites = /* @__PURE__ */ new LatestKeyedWriteQueue(
  MAX_QUEUED_CLOUD_CACHE_BOARDS,
  saveCloudBoardCacheNow,
);

/** Queues the newest recoverable cloud snapshot for one board. */
export function saveCloudBoardCache(
  boardId: string,
  record: CloudBoardCacheWrite<BoardElement>,
): Promise<void> {
  return cloudCacheWrites.enqueue(boardId, record);
}

/** Reads and validates one device-only cloud recovery snapshot. */
export async function loadCloudBoardCache(boardId: string): Promise<
  | (LocalBoardRecord & {
      baselineElements: BoardElement[];
      baselineTitle: string;
      pending: boolean;
      pendingSince: number | null;
      pendingUpdates: Uint8Array[];
    })
  | null
> {
  await cloudCacheWrites.waitForIdle();
  await waitForLocalBoardWrites();
  const transaction = await openTransaction(BOARD_STORE, 'readonly');
  const stored = await requestResult(
    transaction
      .objectStore(BOARD_STORE)
      .get(`${CLOUD_BOARD_PREFIX}${boardId}`) as IDBRequest<
      CloudBoardCacheRecord | undefined
    >,
  );
  await transactionComplete(transaction);
  if (
    stored === undefined ||
    stored.schemaVersion !== LOCAL_BOARD_SCHEMA_VERSION
  ) {
    return null;
  }
  if (!validateStoredCloudBoardCacheDocuments(stored)) return null;
  const elements = parseStoredElements(JSON.stringify(stored.elements));
  const baselineElements = parseStoredElements(
    JSON.stringify(
      stored.baselineElements ?? (stored.pending === true ? [] : elements),
    ),
  );
  const pendingUpdates = decodePendingCloudUpdates(stored.pendingUpdates);
  const pending = stored.pending === true || pendingUpdates.length > 0;
  return {
    baselineElements,
    baselineTitle: stored.baselineTitle ?? stored.title,
    createdAt: stored.updatedAt,
    elements,
    mixedContentByElementId: structuredContentForElements(elements),
    pending,
    pendingSince: cloudRecoveryPendingSince({
      fallback: stored.updatedAt,
      pending,
      storedValue: stored.pendingSince,
    }),
    pendingUpdates,
    title: stored.title,
    updatedAt: stored.updatedAt,
  };
}

/** Reads the authoritative local record and repairs replaceable caches. */
export async function loadLocalBoard(
  boardId = LEGACY_LOCAL_BOARD_ID,
): Promise<LocalBoardRecord | null> {
  await waitForLocalBoardWrites();
  const transaction = await openTransaction(
    [BOARD_STORE, IMAGE_STORE],
    'readonly',
  );
  const boards = transaction.objectStore(BOARD_STORE);
  const currentRecord = requestResult(
    boards.get(storedLocalBoardId(boardId)) as IDBRequest<
      StoredBoardRecord | undefined
    >,
  );
  const legacyRecord =
    boardId === LEGACY_LOCAL_BOARD_ID
      ? requestResult(
          boards.get(LEGACY_LOCAL_BOARD_ID) as IDBRequest<
            StoredBoardRecord | undefined
          >,
        )
      : Promise.resolve(undefined);
  const [current, legacy] = await Promise.all([currentRecord, legacyRecord]);
  const stored = current ?? legacy;
  if (
    stored === undefined ||
    typeof stored.trashedAt === 'number' ||
    (stored.schemaVersion !== 1 &&
      stored.schemaVersion !== LOCAL_BOARD_SCHEMA_VERSION)
  ) {
    await transactionComplete(transaction);
    return null;
  }
  const images = transaction.objectStore(IMAGE_STORE);
  const imageEntries = await Promise.all(
    stored.elements.flatMap((element) => {
      if (element.type !== 'image') return [];
      const storedImageId =
        stored.id === LEGACY_LOCAL_BOARD_ID
          ? element.imageId
          : storedLocalImageId(boardId, element.imageId);
      return [
        requestResult(
          images.get(storedImageId) as IDBRequest<
            StoredImageRecord | undefined
          >,
        ).then((image) => [element.imageId, image?.blob] as const),
      ];
    }),
  );
  await transactionComplete(transaction);
  const imageById = new Map(
    imageEntries.flatMap(([elementId, blob]) =>
      blob === undefined ? [] : [[elementId, blob] as const],
    ),
  );
  const hydrated = await Promise.all(
    stored.elements.map(async (element): Promise<BoardElement | null> => {
      if (element.type !== 'image') return element;
      const blob = imageById.get(element.imageId);
      if (blob === undefined) return null;
      const { imageId: _imageId, ...image } = element;
      void _imageId;
      return { ...image, source: await imageDataUrlFromBlob(blob) };
    }),
  );
  if (hydrated.some((element) => element === null)) return null;
  const serialized = JSON.stringify(hydrated);
  const elements = parseStoredElements(serialized);
  if (elements.length !== hydrated.length) return null;
  const structured = reconcileStructuredBoardContent(
    elements,
    stored.mixedContentByElementId,
  );
  return {
    createdAt:
      typeof stored.createdAt === 'number' && Number.isFinite(stored.createdAt)
        ? stored.createdAt
        : typeof stored.updatedAt === 'number' &&
            Number.isFinite(stored.updatedAt)
          ? stored.updatedAt
          : 0,
    elements: structured.elements,
    mixedContentByElementId: structured.mixedContentByElementId,
    title: typeof stored.title === 'string' ? stored.title : 'Untitled board',
    updatedAt:
      typeof stored.updatedAt === 'number' && Number.isFinite(stored.updatedAt)
        ? stored.updatedAt
        : 0,
  };
}

/**
 * Opens IndexedDB, completes idempotent migration, and chooses an existing
 * board without silently creating the ID requested by a broken URL.
 */
export async function initializeLocalBoardStorage(
  preferredBoardId = LEGACY_LOCAL_BOARD_ID,
): Promise<LocalBoardStorageInitialization> {
  const result = await initializeLocalBoardRecords(preferredBoardId);
  let boards = await listLocalBoards();
  let selectedBoardId = result.selectedBoardId;
  let preferredBoardFound = result.preferredBoardFound;
  if (
    !result.migrationPerformed &&
    (await loadLocalBoard(selectedBoardId)) === null
  ) {
    preferredBoardFound = false;
    let readableFallback: string | null = null;
    for (const board of boards) {
      if (
        board.id !== selectedBoardId &&
        (await loadLocalBoard(board.id)) !== null
      ) {
        readableFallback = board.id;
        break;
      }
    }
    if (readableFallback === null) {
      readableFallback = (await createLocalBoard()).id;
      boards = await listLocalBoards();
    }
    selectedBoardId = readableFallback;
  }
  return {
    boards,
    migratedBoardId: result.migratedBoardId,
    preferredBoardFound,
    selectedBoardId,
  };
}

/** Lists live local boards after initialization and metadata repair. */
export async function listLocalBoards(): Promise<LocalBoardSummary[]> {
  return listLocalBoardMetadata();
}

/** Creates a titled empty local board through the serialized write queue. */
export async function createLocalBoard(
  requestedTitle = 'Untitled board',
): Promise<LocalBoardSummary> {
  return createLocalBoardMetadata(requestedTitle, saveLocalBoard);
}

/** Renames an existing live local board after pending writes drain. */
export async function renameLocalBoard(
  boardId: string,
  title: string,
): Promise<LocalBoardSummary | null> {
  return renameLocalBoardMetadata(
    boardId,
    title,
    loadLocalBoard,
    saveLocalBoard,
  );
}

/** Creates a deep local copy with new board, element, and image identities. */
export async function duplicateLocalBoard(
  boardId: string,
): Promise<LocalBoardSummary | null> {
  return duplicateLocalBoardMetadata(boardId, loadLocalBoard, saveLocalBoard);
}
