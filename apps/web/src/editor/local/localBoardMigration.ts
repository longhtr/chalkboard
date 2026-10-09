/**
 * Idempotently imports legacy localStorage and earlier IndexedDB board records.
 * Source data is retained until the replacement transaction commits successfully.
 */
import type { BoardElement } from '@chalkboard/shared';

import { bestEffortLocalStorage } from '../../bestEffortStorage';
import { randomUuid } from '../../randomUuid';
import {
  BOARD_STORE,
  commitReadwriteTransaction,
  IMAGE_STORE,
  METADATA_STORE,
  openTransaction,
  requestResult,
} from './boardDatabase';
import { parseStoredElements } from '../model/boardSerialization';
import {
  cacheLocalElements,
  cacheLocalTitle,
  LEGACY_LOCAL_BOARD_ID,
  LOCAL_DOCUMENT_CACHE_KEY,
  localDocumentCacheKey,
  localPendingDocumentKey,
  localPendingTitleKey,
  LOCAL_TITLE_CACHE_KEY,
  localTitleCacheKey,
} from './localBoardCache';
import {
  prepareBoardForStorage,
  storedLocalImageId,
  type StoredImageRecord,
} from './localBoardImageStorage';
import { localPendingBoardPatchKey } from './localBoardPatchRecovery';
import {
  LOCAL_BOARD_PREFIX,
  LOCAL_BOARD_SCHEMA_VERSION,
  storedLocalBoardId,
  type CloudBoardCacheRecord,
  type LocalBoardSummary,
  type StoredBoardRecord,
} from './localBoardRecords';
import { enqueueLocalBoardWrite } from './localBoardWriteQueue';
import { localPendingEquationEditKey } from './localEquationRecovery';
import { structuredContentForElements } from '../portability/structuredBoardContent';

const LEGACY_MIGRATION_KEY = 'legacy-local-board-v1';

interface LocalStorageMigrationRecord {
  boardId: string | null;
  completedAt: number;
  id: typeof LEGACY_MIGRATION_KEY;
  version: 1;
}

interface LocalBoardRecordInitialization {
  migratedBoardId: string | null;
  migrationPerformed: boolean;
  preferredBoardFound: boolean;
  selectedBoardId: string;
}

function legacyCachedBoard(): {
  elements: BoardElement[];
  title: string;
} | null {
  const serialized =
    bestEffortLocalStorage.getItem(
      localDocumentCacheKey(LEGACY_LOCAL_BOARD_ID),
    ) ?? bestEffortLocalStorage.getItem(LOCAL_DOCUMENT_CACHE_KEY);
  if (serialized === null) return null;
  return {
    elements: parseStoredElements(serialized),
    title:
      bestEffortLocalStorage.getItem(
        localTitleCacheKey(LEGACY_LOCAL_BOARD_ID),
      ) ??
      bestEffortLocalStorage.getItem(LOCAL_TITLE_CACHE_KEY) ??
      'Untitled board',
  };
}

function migrateLegacyLocalStorage(
  boardId: string,
  options: { includeDocumentCache: boolean },
): void {
  const documentPairs = [
    [LOCAL_DOCUMENT_CACHE_KEY, localDocumentCacheKey(boardId)],
    [
      localDocumentCacheKey(LEGACY_LOCAL_BOARD_ID),
      localDocumentCacheKey(boardId),
    ],
  ] as const;
  const pairs = [
    ...(options.includeDocumentCache ? documentPairs : []),
    [
      localPendingDocumentKey(LEGACY_LOCAL_BOARD_ID),
      localPendingDocumentKey(boardId),
    ],
    [
      localPendingTitleKey(LEGACY_LOCAL_BOARD_ID),
      localPendingTitleKey(boardId),
    ],
    [
      localPendingEquationEditKey(LEGACY_LOCAL_BOARD_ID),
      localPendingEquationEditKey(boardId),
    ],
    [
      localPendingBoardPatchKey(LEGACY_LOCAL_BOARD_ID),
      localPendingBoardPatchKey(boardId),
    ],
    [LOCAL_TITLE_CACHE_KEY, localTitleCacheKey(boardId)],
    [localTitleCacheKey(LEGACY_LOCAL_BOARD_ID), localTitleCacheKey(boardId)],
    ['chalkboard:caret-positions', `chalkboard:caret-positions:${boardId}`],
    [
      `chalkboard:caret-positions:${LEGACY_LOCAL_BOARD_ID}`,
      `chalkboard:caret-positions:${boardId}`,
    ],
  ] as const;
  const retainedLegacyKeys = new Set<string>();
  for (const [legacyKey, currentKey] of pairs) {
    const value = bestEffortLocalStorage.getItem(legacyKey);
    if (
      value !== null &&
      bestEffortLocalStorage.getItem(currentKey) === null &&
      !bestEffortLocalStorage.setItem(currentKey, value)
    ) {
      retainedLegacyKeys.add(legacyKey);
    }
  }
  bestEffortLocalStorage.setItem('chalkboard:last-local-board', boardId);
  for (const [legacyKey, currentKey] of [...documentPairs, ...pairs]) {
    if (legacyKey !== currentKey && !retainedLegacyKeys.has(legacyKey)) {
      bestEffortLocalStorage.removeItem(legacyKey);
    }
  }
}

/** Migrates legacy state, repairs stores, purges expired trash, and selects a board. */
export async function initializeLocalBoardRecords(
  preferredBoardId = LEGACY_LOCAL_BOARD_ID,
): Promise<LocalBoardRecordInitialization> {
  const cached = legacyCachedBoard();
  const initialized = enqueueLocalBoardWrite(async () => {
    const transaction = await openTransaction(
      [BOARD_STORE, IMAGE_STORE, METADATA_STORE],
      'readwrite',
    );
    return commitReadwriteTransaction(transaction, async () => {
      const boardsStore = transaction.objectStore(BOARD_STORE);
      const imagesStore = transaction.objectStore(IMAGE_STORE);
      const metadataStore = transaction.objectStore(METADATA_STORE);
      const markerRequest = metadataStore.get(
        LEGACY_MIGRATION_KEY,
      ) as IDBRequest<LocalStorageMigrationRecord | undefined>;
      const imageRecords = new Promise<StoredImageRecord[]>(
        (resolve, reject) => {
          markerRequest.addEventListener('success', () => {
            if (markerRequest.result !== undefined) {
              resolve([]);
              return;
            }
            const request = imagesStore.getAll() as IDBRequest<
              StoredImageRecord[]
            >;
            request.addEventListener('success', () => resolve(request.result));
            request.addEventListener('error', () =>
              reject(request.error ?? new Error('IndexedDB image scan failed')),
            );
          });
          markerRequest.addEventListener('error', () =>
            reject(
              markerRequest.error ?? new Error('IndexedDB marker read failed'),
            ),
          );
        },
      );
      const [marker, records, legacyImageRecords] = await Promise.all([
        requestResult(markerRequest),
        requestResult(
          boardsStore.getAll() as IDBRequest<
            (StoredBoardRecord | CloudBoardCacheRecord)[]
          >,
        ),
        imageRecords,
      ]);

      let migratedBoardId = marker?.boardId ?? null;
      let migrationPerformed = false;
      let migrationUsedIndexedDb = false;
      if (marker === undefined) {
        const legacyRecord = records.find(
          (record): record is StoredBoardRecord =>
            (record.id === LEGACY_LOCAL_BOARD_ID ||
              record.id === storedLocalBoardId(LEGACY_LOCAL_BOARD_ID)) &&
            (record.schemaVersion === 1 ||
              record.schemaVersion === LOCAL_BOARD_SCHEMA_VERSION),
        );
        const timestamp = Date.now();
        if (legacyRecord !== undefined || cached !== null) {
          migrationPerformed = true;
          migrationUsedIndexedDb = legacyRecord !== undefined;
          migratedBoardId = randomUuid();
          const prepared =
            legacyRecord === undefined
              ? prepareBoardForStorage(cached?.elements ?? [], migratedBoardId)
              : null;
          boardsStore.put({
            ...(legacyRecord ?? {
              createdAt: timestamp,
              elements: prepared?.elements ?? [],
              mixedContentByElementId: structuredContentForElements(
                cached?.elements ?? [],
              ),
              schemaVersion: LOCAL_BOARD_SCHEMA_VERSION,
              title: cached?.title ?? 'Untitled board',
              updatedAt: timestamp,
            }),
            id: storedLocalBoardId(migratedBoardId),
          } satisfies StoredBoardRecord);
          if (legacyRecord !== undefined) boardsStore.delete(legacyRecord.id);

          if (prepared !== null) {
            for (const image of prepared.images) imagesStore.put(image);
          } else {
            for (const image of legacyImageRecords) {
              const belongsToLegacy =
                image.boardId === undefined ||
                image.boardId === LEGACY_LOCAL_BOARD_ID;
              if (!belongsToLegacy) continue;
              const elementId = image.elementId ?? image.id;
              imagesStore.delete(image.id);
              imagesStore.put({
                ...image,
                boardId: migratedBoardId,
                elementId,
                id: storedLocalImageId(migratedBoardId, elementId),
              } satisfies StoredImageRecord);
            }
          }
        }
        metadataStore.put({
          boardId: migratedBoardId,
          completedAt: timestamp,
          id: LEGACY_MIGRATION_KEY,
          version: 1,
        } satisfies LocalStorageMigrationRecord);
      }

      const replacedLegacyIds = new Set([
        LEGACY_LOCAL_BOARD_ID,
        storedLocalBoardId(LEGACY_LOCAL_BOARD_ID),
      ]);
      const activeIds = new Set(
        records.flatMap((record) => {
          if (
            !record.id.startsWith(LOCAL_BOARD_PREFIX) ||
            replacedLegacyIds.has(record.id) ||
            ('trashedAt' in record && typeof record.trashedAt === 'number')
          ) {
            return [];
          }
          const id = record.id.slice(LOCAL_BOARD_PREFIX.length);
          return id === '' ? [] : [id];
        }),
      );
      if (marker === undefined && migratedBoardId !== null) {
        const migrated = records.find(
          (record) =>
            record.id === LEGACY_LOCAL_BOARD_ID ||
            record.id === storedLocalBoardId(LEGACY_LOCAL_BOARD_ID),
        );
        if (
          migrated === undefined ||
          !('trashedAt' in migrated) ||
          typeof migrated.trashedAt !== 'number'
        ) {
          activeIds.add(migratedBoardId);
        }
      }

      let createdBoard: LocalBoardSummary | null = null;
      if (activeIds.size === 0) {
        const id = randomUuid();
        const timestamp = Date.now();
        boardsStore.put({
          createdAt: timestamp,
          elements: [],
          id: storedLocalBoardId(id),
          mixedContentByElementId: {},
          schemaVersion: LOCAL_BOARD_SCHEMA_VERSION,
          title: 'Untitled board',
          updatedAt: timestamp,
        } satisfies StoredBoardRecord);
        activeIds.add(id);
        createdBoard = {
          createdAt: timestamp,
          id,
          title: 'Untitled board',
          updatedAt: timestamp,
        };
      }

      const preferredBoardFound =
        preferredBoardId === LEGACY_LOCAL_BOARD_ID
          ? migratedBoardId !== null && activeIds.has(migratedBoardId)
          : activeIds.has(preferredBoardId);
      const selectedBoardId =
        preferredBoardId !== LEGACY_LOCAL_BOARD_ID && preferredBoardFound
          ? preferredBoardId
          : migratedBoardId !== null && activeIds.has(migratedBoardId)
            ? migratedBoardId
            : ([...activeIds][0] ?? LEGACY_LOCAL_BOARD_ID);
      return {
        createdBoard,
        migratedBoardId,
        migrationPerformed,
        migrationUsedIndexedDb,
        preferredBoardFound,
        selectedBoardId,
      };
    });
  });
  const result = await initialized;
  if (result.migratedBoardId !== null) {
    migrateLegacyLocalStorage(result.migratedBoardId, {
      includeDocumentCache: !result.migrationUsedIndexedDb,
    });
  }
  if (result.createdBoard !== null) {
    cacheLocalElements([], result.createdBoard.id);
    cacheLocalTitle(result.createdBoard.title, result.createdBoard.id);
  }
  return {
    migratedBoardId: result.migratedBoardId,
    migrationPerformed: result.migrationPerformed,
    preferredBoardFound: result.preferredBoardFound,
    selectedBoardId: result.selectedBoardId,
  };
}
