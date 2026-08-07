/**
 * Pure startup/navigation helpers plus disposable last-board hints. Cached cloud
 * identity is provisional only and never substitutes for server authorization.
 */
import type { CloudBoardSelection } from '../cloudBoardSelection';
import { LEGACY_LOCAL_BOARD_ID } from '../editor/local/localBoardCache';
import { bestEffortLocalStorage } from '../bestEffortStorage';
import type { Board } from './api';
import { readBoardRoute } from './boardRouting';

const LAST_CLOUD_BOARD_KEY = 'chalkboard:last-cloud-board';
const LAST_LOCAL_BOARD_KEY = 'chalkboard:last-local-board';
const BOARD_INVITE_HASH_KEY = 'invite';

/** UI state while URL board intent is authorized and resolved. */
export type RouteStatus =
  'idle' | 'resolving' | 'sign-in-required' | 'unavailable' | 'inaccessible';

/** Complete local/cloud board selection derived from URL and provisional hints. */
export interface NavigationState {
  localBoardId: string;
  requestedBoardId: string | null;
  selectedBoard: CloudBoardSelection | null;
  status: RouteStatus;
}

/** Narrows an API board to the identity needed by the workspace route. */
export function cloudSelection(board: Board): CloudBoardSelection {
  return { id: board.id, role: board.role, title: board.title };
}

/** Reads a fragment-delivered invite without accepting malformed token shapes. */
export function readBoardInviteToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get(
    BOARD_INVITE_HASH_KEY,
  );
  return token !== null && /^[A-Za-z0-9_-]{43}$/u.test(token) ? token : null;
}

/** Reads the last known cloud selection as provisional navigation state only. */
export function loadLastCloudBoard(): CloudBoardSelection | null {
  try {
    const value: unknown = JSON.parse(
      bestEffortLocalStorage.getItem(LAST_CLOUD_BOARD_KEY) ?? 'null',
    );
    if (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      typeof value.id === 'string' &&
      'title' in value &&
      typeof value.title === 'string' &&
      'role' in value &&
      (value.role === 'owner' ||
        value.role === 'editor' ||
        value.role === 'viewer')
    ) {
      return { id: value.id, role: value.role, title: value.title };
    }
  } catch {
    // Cached navigation is disposable; malformed data falls back safely.
  }
  return null;
}

/** Reads the disposable last-local-board hint, falling back to the legacy board. */
export function loadLastLocalBoardId(): string {
  return (
    bestEffortLocalStorage.getItem(LAST_LOCAL_BOARD_KEY) ??
    LEGACY_LOCAL_BOARD_ID
  );
}

/** Best-effort persistence of the latest local board navigation choice. */
export function rememberLocalBoard(boardId: string): void {
  bestEffortLocalStorage.setItem(LAST_LOCAL_BOARD_KEY, boardId);
}

/** Best-effort persistence of provisional cloud navigation metadata. */
export function rememberCloudBoard(board: CloudBoardSelection): void {
  bestEffortLocalStorage.setItem(LAST_CLOUD_BOARD_KEY, JSON.stringify(board));
}

/** Resolves URL intent before asynchronous storage or session checks begin. */
export function initialNavigation(): NavigationState {
  const route = readBoardRoute(window.location.pathname);
  const cached = loadLastCloudBoard();
  const localBoardId = loadLastLocalBoardId();

  if (route.kind === 'local') {
    return {
      localBoardId: route.boardId ?? localBoardId,
      requestedBoardId: null,
      selectedBoard: null,
      status: 'idle',
    };
  }
  if (route.kind === 'cloud') {
    return {
      localBoardId,
      requestedBoardId: route.boardId,
      selectedBoard: cached?.id === route.boardId ? cached : null,
      status: 'resolving',
    };
  }
  return cached === null
    ? {
        localBoardId,
        requestedBoardId: null,
        selectedBoard: null,
        status: 'idle',
      }
    : {
        localBoardId,
        requestedBoardId: cached.id,
        selectedBoard: cached,
        status: 'resolving',
      };
}
