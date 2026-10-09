/** Small provisional startup snapshot cache; IndexedDB always wins when it has an equal or newer revision. */
import type { BoardElement } from '@chalkboard/shared';

import { bestEffortLocalStorage } from '../../bestEffortStorage';

/** Legacy compatibility-cache key for the original single local board. */
export const LOCAL_DOCUMENT_CACHE_KEY = 'chalkboard:local-document';
/** Legacy critical-recovery key for a complete unsaved document. */
export const LOCAL_PENDING_DOCUMENT_KEY = 'chalkboard:pending-local-document';
/** Legacy critical-recovery key for an unsaved title. */
export const LOCAL_PENDING_TITLE_KEY = 'chalkboard:pending-local-title';
/** Legacy compatibility-cache key for the original board title. */
export const LOCAL_TITLE_CACHE_KEY = 'chalkboard:local-title';
/** Stable identifier assigned when migrating the original single local board. */
export const LEGACY_LOCAL_BOARD_ID = 'local';
/** BroadcastChannel name used to announce authoritative local-board commits. */
export const BOARD_SYNC_CHANNEL = 'chalkboard:board-sync';

/** Builds a board-scoped compatibility document cache key. */
export function localDocumentCacheKey(boardId: string): string {
  return `${LOCAL_DOCUMENT_CACHE_KEY}:${boardId}`;
}

/** Builds a board-scoped complete pending-document recovery key. */
export function localPendingDocumentKey(boardId: string): string {
  return `${LOCAL_PENDING_DOCUMENT_KEY}:${boardId}`;
}

/** Builds a board-scoped pending-title recovery key. */
export function localPendingTitleKey(boardId: string): string {
  return `${LOCAL_PENDING_TITLE_KEY}:${boardId}`;
}

/** Builds a board-scoped compatibility title cache key. */
export function localTitleCacheKey(boardId: string): string {
  return `${LOCAL_TITLE_CACHE_KEY}:${boardId}`;
}

/** Best-effort caches a serialized committed document for fast startup. */
export function cacheLocalElements(
  elements: BoardElement[],
  boardId = LEGACY_LOCAL_BOARD_ID,
  serializedElements?: string,
): boolean {
  let serialized: string;
  try {
    serialized = serializedElements ?? JSON.stringify(elements);
  } catch {
    return false;
  }
  const boardCachePersisted = bestEffortLocalStorage.setItem(
    localDocumentCacheKey(boardId),
    serialized,
  );
  const legacyCachePersisted =
    boardId !== LEGACY_LOCAL_BOARD_ID ||
    bestEffortLocalStorage.setItem(LOCAL_DOCUMENT_CACHE_KEY, serialized);
  if (boardCachePersisted && legacyCachePersisted) return true;
  bestEffortLocalStorage.removeItem(localDocumentCacheKey(boardId));
  if (boardId === LEGACY_LOCAL_BOARD_ID) {
    bestEffortLocalStorage.removeItem(LOCAL_DOCUMENT_CACHE_KEY);
  }
  return false;
}

function evictCompatibilityDocumentCaches(): void {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (
      key === LOCAL_DOCUMENT_CACHE_KEY ||
      key?.startsWith(`${LOCAL_DOCUMENT_CACHE_KEY}:`) === true
    ) {
      localStorage.removeItem(key);
    }
  }
}

/** Writes critical recovery directly to storage and reports persistence success. */
export function cacheCriticalLocalValue(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    if (
      !(error instanceof DOMException) ||
      error.name !== 'QuotaExceededError'
    ) {
      return false;
    }
  }
  try {
    // IndexedDB is authoritative. Prefer crash recovery over every replaceable
    // synchronous compatibility cache when quota is tight.
    evictCompatibilityDocumentCaches();
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Stores a complete critical recovery snapshot and optional title. */
export function cachePendingLocalElements(
  elements: BoardElement[],
  boardId = LEGACY_LOCAL_BOARD_ID,
  title?: string,
): string | undefined {
  let serialized: string;
  try {
    serialized = JSON.stringify(elements);
  } catch {
    return undefined;
  }
  if (!cacheCriticalLocalValue(localPendingDocumentKey(boardId), serialized)) {
    return serialized;
  }
  if (title !== undefined) {
    try {
      localStorage.setItem(localPendingTitleKey(boardId), title);
    } catch {
      // The document snapshot remains recoverable without its title update.
    }
  }
  return serialized;
}

/** Clears complete recovery only when durable content matches it exactly. */
export function clearPendingLocalElements(
  elements: BoardElement[],
  title: string,
  boardId: string,
  serializedElements?: string,
): void {
  try {
    const key = localPendingDocumentKey(boardId);
    if (
      localStorage.getItem(key) ===
      (serializedElements ?? JSON.stringify(elements))
    ) {
      localStorage.removeItem(key);
      if (localStorage.getItem(localPendingTitleKey(boardId)) === title) {
        localStorage.removeItem(localPendingTitleKey(boardId));
      }
    }
  } catch {
    // The durable board is already authoritative.
  }
}

/** Best-effort caches a normalized committed title for fast startup. */
export function cacheLocalTitle(
  title: string,
  boardId = LEGACY_LOCAL_BOARD_ID,
): void {
  bestEffortLocalStorage.setItem(localTitleCacheKey(boardId), title);
  if (boardId === LEGACY_LOCAL_BOARD_ID) {
    bestEffortLocalStorage.setItem(LOCAL_TITLE_CACHE_KEY, title);
  }
}

/** Best-effort notifies other tabs after the authoritative commit succeeds. */
export function publishLocalBoardUpdate(
  boardId: string,
  updatedAt: number,
): void {
  if (typeof BroadcastChannel === 'undefined') return;
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(BOARD_SYNC_CHANNEL);
    channel.postMessage({ boardId, updatedAt });
  } catch {
    // Notification is best-effort and follows the authoritative commit.
  } finally {
    try {
      channel?.close();
    } catch {
      // A broken notification channel cannot invalidate durable success.
    }
  }
}
