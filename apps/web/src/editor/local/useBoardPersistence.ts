/**
 * React bridge from committed local document revisions to the save coordinator.
 * It hydrates once, rejects stale cross-tab state, and surfaces storage failure
 * without blocking immediate editor interaction.
 */
import type { BoardElement } from '@chalkboard/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  BOARD_SYNC_CHANNEL,
  cacheLocalElements,
  cacheLocalTitle,
  cachePendingLocalElements,
  LEGACY_LOCAL_BOARD_ID,
  localDocumentCacheKey,
  type LocalBoardRecord,
} from './boardStorage';
import { localBoardRepository } from './localBoardRepository';
import {
  applyPendingLocalBoardPatch,
  cachePendingLocalBoardPatch,
  clearCommittedPendingLocalBoardPatch,
  removePendingLocalBoardPatch,
} from './localBoardPatchRecovery';
import {
  applyPendingLocalEquationEdit,
  clearCommittedPendingLocalEquationEdit,
  removePendingLocalEquationEdit,
} from './localEquationRecovery';

interface BoardPersistenceOptions {
  elements: BoardElement[];
  enabled?: boolean;
  forceInitialSave: boolean;
  hydrateFromIndexedDb: boolean;
  localBoardId?: string;
  onExternalBoard(record: LocalBoardRecord): void;
  onExternalBoardUnavailable?: (() => void) | undefined;
  onStorageError(error: unknown): void;
  onStorageRecovered(): void;
  title: string;
}

/** Hydrates, saves, recovers, and cross-tab-reconciles one authoritative local board. */
export function useBoardPersistence({
  elements,
  enabled = true,
  forceInitialSave,
  hydrateFromIndexedDb,
  localBoardId = LEGACY_LOCAL_BOARD_ID,
  onExternalBoard,
  onExternalBoardUnavailable,
  onStorageError,
  onStorageRecovered,
  title,
}: BoardPersistenceOptions): {
  persistBoard(elements: BoardElement[]): void;
  storageReady: boolean;
} {
  const externalUpdateRef = useRef(false);
  const initialPersistenceRef = useRef(true);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastUpdateRef = useRef(0);
  const hydratedBoardMissingRef = useRef(false);
  const elementsRef = useRef(elements);
  const lastQueuedElementsRef = useRef(elements);
  const lastQueuedTitleRef = useRef(title);
  const explicitlyPersistedRef = useRef<{
    elements: BoardElement[];
    title: string;
  } | null>(null);
  const titleRef = useRef(title);
  const onExternalBoardRef = useRef(onExternalBoard);
  const onExternalBoardUnavailableRef = useRef(onExternalBoardUnavailable);
  const onStorageErrorRef = useRef(onStorageError);
  const onStorageRecoveredRef = useRef(onStorageRecovered);
  const [storageReady, setStorageReady] = useState(!hydrateFromIndexedDb);

  useEffect(() => {
    elementsRef.current = elements;
    titleRef.current = title;
    onExternalBoardRef.current = onExternalBoard;
    onExternalBoardUnavailableRef.current = onExternalBoardUnavailable;
    onStorageErrorRef.current = onStorageError;
    onStorageRecoveredRef.current = onStorageRecovered;
  }, [
    elements,
    onExternalBoard,
    onExternalBoardUnavailable,
    onStorageError,
    onStorageRecovered,
    title,
  ]);

  const nextUpdatedAt = useCallback(() => {
    const updatedAt = Math.max(Date.now(), lastUpdateRef.current + 1);
    lastUpdateRef.current = updatedAt;
    return updatedAt;
  }, []);

  const queueBoardWrite = useCallback(
    (nextElements: BoardElement[], nextTitle: string) => {
      const updatedAt = nextUpdatedAt();
      const usesCompactPatch =
        lastQueuedTitleRef.current === nextTitle &&
        cachePendingLocalBoardPatch(
          lastQueuedElementsRef.current,
          nextElements,
          localBoardId,
        );
      const serializedElementsForCaches = usesCompactPatch
        ? undefined
        : cachePendingLocalElements(nextElements, localBoardId, nextTitle);
      if (!usesCompactPatch) removePendingLocalBoardPatch(localBoardId);
      lastQueuedElementsRef.current = nextElements;
      lastQueuedTitleRef.current = nextTitle;
      void localBoardRepository
        .write(localBoardId, {
          elements: nextElements,
          ...(serializedElementsForCaches === undefined
            ? {}
            : { serializedElementsForCaches }),
          title: nextTitle,
          updatedAt,
        })
        .then((result) => {
          if (result.committed) {
            onStorageRecoveredRef.current();
            return;
          }
          const { current } = result;
          const recoveredElements = applyPendingLocalEquationEdit(
            applyPendingLocalBoardPatch(current.elements, localBoardId),
            localBoardId,
          );
          if (recoveredElements === current.elements) {
            removePendingLocalBoardPatch(localBoardId);
            removePendingLocalEquationEdit(localBoardId);
          }
          externalUpdateRef.current = recoveredElements === current.elements;
          lastUpdateRef.current = Math.max(
            lastUpdateRef.current,
            current.updatedAt,
          );
          lastQueuedElementsRef.current = current.elements;
          lastQueuedTitleRef.current = current.title;
          onExternalBoardRef.current({
            ...current,
            elements: recoveredElements,
          });
          cacheLocalElements(current.elements, localBoardId);
          cacheLocalTitle(current.title, localBoardId);
          onStorageRecoveredRef.current();
        })
        .catch((error: unknown) => onStorageErrorRef.current(error));
    },
    [localBoardId, nextUpdatedAt],
  );

  const persistBoard = useCallback(
    (nextElements: BoardElement[]) => {
      if (!enabled) return;
      const nextTitle = titleRef.current;
      explicitlyPersistedRef.current = {
        elements: nextElements,
        title: nextTitle,
      };
      queueBoardWrite(nextElements, nextTitle);
    },
    [enabled, queueBoardWrite],
  );

  useEffect(() => {
    if (!enabled || !hydrateFromIndexedDb) return;
    let disposed = false;
    void localBoardRepository
      .read(localBoardId)
      .then((stored) => {
        if (disposed) return;
        onStorageRecoveredRef.current();
        if (stored !== null) {
          clearCommittedPendingLocalEquationEdit(stored.elements, localBoardId);
          clearCommittedPendingLocalBoardPatch(stored.elements, localBoardId);
          const recoveredElements = applyPendingLocalEquationEdit(
            applyPendingLocalBoardPatch(stored.elements, localBoardId),
            localBoardId,
          );
          externalUpdateRef.current = recoveredElements === stored.elements;
          lastUpdateRef.current = stored.updatedAt;
          onExternalBoardRef.current({
            ...stored,
            elements: recoveredElements,
          });
          cacheLocalElements(stored.elements, localBoardId);
          cacheLocalTitle(stored.title, localBoardId);
        } else {
          hydratedBoardMissingRef.current = true;
        }
        setStorageReady(true);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        onStorageErrorRef.current(error);
        setStorageReady(true);
      });
    return () => {
      disposed = true;
    };
  }, [enabled, hydrateFromIndexedDb, localBoardId]);

  useEffect(() => {
    if (!enabled || !storageReady) return;
    if (externalUpdateRef.current) {
      externalUpdateRef.current = false;
      initialPersistenceRef.current = false;
      lastQueuedElementsRef.current = elements;
      lastQueuedTitleRef.current = title;
      return;
    }
    if (initialPersistenceRef.current) {
      initialPersistenceRef.current = false;
      if (!forceInitialSave && !hydratedBoardMissingRef.current) {
        lastQueuedElementsRef.current = elements;
        lastQueuedTitleRef.current = title;
        if (!hydrateFromIndexedDb) {
          cacheLocalElements(elements, localBoardId);
          cacheLocalTitle(title, localBoardId);
        }
        return;
      }
    }
    const explicitlyPersisted = explicitlyPersistedRef.current;
    if (
      explicitlyPersisted?.elements === elements &&
      explicitlyPersisted.title === title
    ) {
      explicitlyPersistedRef.current = null;
      return;
    }
    explicitlyPersistedRef.current = null;
    queueBoardWrite(elements, title);
  }, [
    elements,
    enabled,
    forceInitialSave,
    hydrateFromIndexedDb,
    localBoardId,
    queueBoardWrite,
    storageReady,
    title,
  ]);

  useEffect(() => {
    if (!enabled || hydrateFromIndexedDb || forceInitialSave) return;
    let disposed = false;
    void localBoardRepository
      .read(localBoardId)
      .then((stored) => {
        if (disposed) return;
        onStorageRecoveredRef.current();
        if (stored !== null) return;
        queueBoardWrite(elementsRef.current, titleRef.current);
      })
      .catch((error: unknown) => {
        if (!disposed) onStorageErrorRef.current(error);
      });
    return () => {
      disposed = true;
    };
  }, [
    enabled,
    forceInitialSave,
    hydrateFromIndexedDb,
    localBoardId,
    queueBoardWrite,
  ]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const synchronizeDurableBoard = (
      options: {
        announcedUpdatedAt?: number;
        repairCompatibilityCache?: boolean;
      } = {},
    ) => {
      const { announcedUpdatedAt, repairCompatibilityCache = false } = options;
      if (
        announcedUpdatedAt !== undefined &&
        announcedUpdatedAt <= lastUpdateRef.current
      ) {
        return;
      }
      void localBoardRepository
        .read(localBoardId)
        .then((stored) => {
          if (disposed) return;
          onStorageRecoveredRef.current();
          if (stored === null) {
            if (announcedUpdatedAt !== undefined) {
              lastUpdateRef.current = announcedUpdatedAt;
            }
            onExternalBoardUnavailableRef.current?.();
            return;
          }
          if (
            repairCompatibilityCache &&
            stored.updatedAt >= lastUpdateRef.current
          ) {
            cacheLocalElements(stored.elements, localBoardId);
            cacheLocalTitle(stored.title, localBoardId);
          }
          if (
            (announcedUpdatedAt !== undefined &&
              stored.updatedAt < announcedUpdatedAt) ||
            stored.updatedAt <= lastUpdateRef.current
          ) {
            return;
          }
          externalUpdateRef.current = true;
          lastUpdateRef.current = stored.updatedAt;
          onExternalBoardRef.current(stored);
        })
        .catch((error: unknown) => {
          if (!disposed) onStorageErrorRef.current(error);
        });
    };
    const synchronizeDocument = (event: StorageEvent) => {
      if (
        event.key === localDocumentCacheKey(localBoardId) &&
        event.newValue !== null
      ) {
        synchronizeDurableBoard({ repairCompatibilityCache: true });
      }
    };
    window.addEventListener('storage', synchronizeDocument);

    const channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(BOARD_SYNC_CHANNEL);
    channelRef.current = channel;
    const synchronizeIndexedDb = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (
        typeof data !== 'object' ||
        data === null ||
        typeof (data as { boardId?: unknown }).boardId !== 'string' ||
        (data as { boardId: string }).boardId !== localBoardId ||
        typeof (data as { updatedAt?: unknown }).updatedAt !== 'number'
      ) {
        return;
      }
      synchronizeDurableBoard({
        announcedUpdatedAt: (data as { updatedAt: number }).updatedAt,
      });
    };
    channel?.addEventListener('message', synchronizeIndexedDb);
    return () => {
      disposed = true;
      window.removeEventListener('storage', synchronizeDocument);
      channel?.removeEventListener('message', synchronizeIndexedDb);
      channel?.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [enabled, localBoardId]);

  return { persistBoard, storageReady };
}
