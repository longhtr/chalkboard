/**
 * Versioned best-effort browser records for startup snapshots, semantic patches,
 * equation drafts, and UI hints. Readers validate every field and reject stale
 * or oversized recovery rather than treating localStorage as authoritative.
 */
import type { BoardElement } from '@chalkboard/shared';

import { bestEffortLocalStorage } from '../../bestEffortStorage';
import {
  MAX_BOARD_ELEMENTS,
  MAX_OBJECT_CLIPBOARD_CHARACTERS,
} from '../model/limits';
import {
  decodeBoardSnapshot,
  isStoredBoardElement,
  parseStoredElements,
} from '../model/boardSerialization';
import {
  cacheLocalElements,
  cacheLocalTitle,
  LEGACY_LOCAL_BOARD_ID,
  LOCAL_DOCUMENT_CACHE_KEY,
  LOCAL_TITLE_CACHE_KEY,
  localDocumentCacheKey,
  localPendingDocumentKey,
  localPendingTitleKey,
  localTitleCacheKey,
} from './boardStorage';
import {
  applyPendingLocalBoardPatch,
  localPendingBoardPatchKey,
} from './localBoardPatchRecovery';
import {
  applyPendingLocalEquationEdit,
  localPendingEquationEditKey,
} from './localEquationRecovery';

// Small synchronous browser state aids startup and crash recovery but never
// overrides IndexedDB, the local durability authority.
export const LOCAL_CARET_POSITIONS_KEY = 'chalkboard:caret-positions';

/** Builds the disposable caret-position cache key for one board identity. */
export function caretPositionsKey(boardKey: string): string {
  return `${LOCAL_CARET_POSITIONS_KEY}:${boardKey}`;
}
/** Disposable local-storage key for Chalkboard's internal object clipboard. */
export const LOCAL_OBJECT_CLIPBOARD_KEY = 'chalkboard:object-clipboard';
/** Format discriminator prepended to serialized object clipboard payloads. */
export const OBJECT_CLIPBOARD_PREFIX = 'chalkboard-elements:';
/** URL-fragment key containing an editable compatibility board snapshot. */
const SHARED_BOARD_HASH_KEY = 'board';
/** URL-fragment key containing the compatibility snapshot title. */
const SHARED_TITLE_HASH_KEY = 'title';

/** Converts storage exceptions into stable actionable user-facing guidance. */
export function storageFailureMessage(error: unknown): string {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String(error.name)
      : '';
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return 'Browser storage is full. This board remains open, but new changes may not survive reload. Free browser storage before closing this tab.';
  }
  return 'Browser storage is unavailable. This board remains open, but new changes may not survive reload.';
}

function loadLocalElements(boardId: string): BoardElement[] {
  const stored =
    bestEffortLocalStorage.getItem(localPendingDocumentKey(boardId)) ??
    bestEffortLocalStorage.getItem(localDocumentCacheKey(boardId)) ??
    (boardId === LEGACY_LOCAL_BOARD_ID
      ? bestEffortLocalStorage.getItem(LOCAL_DOCUMENT_CACHE_KEY)
      : null);
  const elements = parseStoredElements(stored);
  if (stored !== null && stored !== JSON.stringify(elements)) {
    cacheLocalElements(elements, boardId);
  }
  return applyPendingLocalEquationEdit(
    applyPendingLocalBoardPatch(elements, boardId),
    boardId,
  );
}

/** Reports whether startup URL state carries an editable board snapshot. */
export function hasSharedBoardSnapshot(): boolean {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  return parameters.get(SHARED_BOARD_HASH_KEY) !== null;
}

/** Reports whether any complete, patch, or equation recovery exists for a board. */
export function hasPendingLocalBoardRecovery(
  boardId = LEGACY_LOCAL_BOARD_ID,
): boolean {
  return (
    bestEffortLocalStorage.getItem(localPendingDocumentKey(boardId)) !== null ||
    bestEffortLocalStorage.getItem(localPendingEquationEditKey(boardId)) !==
      null ||
    bestEffortLocalStorage.getItem(localPendingBoardPatchKey(boardId)) !== null
  );
}

/** Chooses authoritative IndexedDB hydration when no newer compatibility state wins. */
export function shouldHydrateFromIndexedDb(
  boardId = LEGACY_LOCAL_BOARD_ID,
): boolean {
  return (
    !hasSharedBoardSnapshot() &&
    bestEffortLocalStorage.getItem(localPendingDocumentKey(boardId)) === null
  );
}

/** Loads the URL/cache startup title without treating it as durable authority. */
export function loadInitialTitle(boardId = LEGACY_LOCAL_BOARD_ID): string {
  return (
    bestEffortLocalStorage.getItem(localPendingTitleKey(boardId)) ??
    bestEffortLocalStorage.getItem(localTitleCacheKey(boardId)) ??
    (boardId === LEGACY_LOCAL_BOARD_ID
      ? bestEffortLocalStorage.getItem(LOCAL_TITLE_CACHE_KEY)
      : null) ??
    'Untitled board'
  );
}

/** Loads bounded startup elements from URL or compatibility cache. */
export function loadInitialElements(
  boardId = LEGACY_LOCAL_BOARD_ID,
): BoardElement[] {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  const sharedValue = parameters.get(SHARED_BOARD_HASH_KEY);
  if (sharedValue === null) return loadLocalElements(boardId);
  const sharedElements = decodeBoardSnapshot(sharedValue);
  if (sharedElements === null) return loadLocalElements(boardId);
  cacheLocalElements(sharedElements, boardId);
  const sharedTitle = parameters.get(SHARED_TITLE_HASH_KEY);
  if (sharedTitle !== null) cacheLocalTitle(sharedTitle, boardId);
  parameters.delete(SHARED_BOARD_HASH_KEY);
  parameters.delete(SHARED_TITLE_HASH_KEY);
  const hash = parameters.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ''}`,
  );
  return sharedElements;
}

/** Reconstructs finite caret offsets from disposable per-board storage. */
export function loadCaretPositions(
  boardKey = LEGACY_LOCAL_BOARD_ID,
): Map<string, number> {
  try {
    const stored =
      bestEffortLocalStorage.getItem(caretPositionsKey(boardKey)) ??
      (boardKey === LEGACY_LOCAL_BOARD_ID
        ? bestEffortLocalStorage.getItem(LOCAL_CARET_POSITIONS_KEY)
        : null);
    const parsed: unknown = JSON.parse(stored ?? '{}');
    if (typeof parsed !== 'object' || parsed === null) return new Map();
    return new Map(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          Number.isInteger(entry[1]) && entry[1] >= 0,
      ),
    );
  } catch {
    return new Map();
  }
}

/** Encodes selected elements only when the internal clipboard bound permits. */
export function serializeObjectClipboard(
  elements: readonly BoardElement[],
): string | null {
  if (elements.length > MAX_BOARD_ELEMENTS) return null;
  const serialized = JSON.stringify(elements);
  return serialized.length <= MAX_OBJECT_CLIPBOARD_CHARACTERS
    ? `${OBJECT_CLIPBOARD_PREFIX}${serialized}`
    : null;
}

/** Validates and reconstructs a Chalkboard object clipboard payload. */
export function parseObjectClipboard(
  text: string | null,
): BoardElement[] | null {
  if (text === null || !text.startsWith(OBJECT_CLIPBOARD_PREFIX)) return null;
  const serialized = text.slice(OBJECT_CLIPBOARD_PREFIX.length);
  if (serialized.length > MAX_OBJECT_CLIPBOARD_CHARACTERS) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (
      !Array.isArray(parsed) ||
      parsed.length > MAX_BOARD_ELEMENTS ||
      !parsed.every(isStoredBoardElement)
    ) {
      return null;
    }
    return parseStoredElements(serialized);
  } catch {
    return null;
  }
}
