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
/** How many boards per account are kept as fallbacks when one stops opening. */
const REMEMBERED_BOARDS_PER_ACCOUNT = 5;
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

function readSelection(value: unknown): CloudBoardSelection | null {
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
  return null;
}

/** A board an account had open, either on this device or in the cloud. */
export type RememberedBoard =
  | { kind: 'cloud'; selection: CloudBoardSelection }
  | { kind: 'local'; id: string };

function readRemembered(value: unknown): RememberedBoard | null {
  if (typeof value !== 'object' || value === null) return null;
  if ('kind' in value && value.kind === 'local') {
    return 'id' in value && typeof value.id === 'string'
      ? { id: value.id, kind: 'local' }
      : null;
  }
  const selection = readSelection(
    'selection' in value ? value.selection : value,
  );
  return selection === null ? null : { kind: 'cloud', selection };
}

/** The board id, whichever kind it is. */
export function rememberedBoardId(board: RememberedBoard): string {
  return board.kind === 'local' ? board.id : board.selection.id;
}

/**
 * Which boards each account had open, most recent first.
 *
 * This is per account on purpose. One shared entry meant signing in as somebody
 * else reopened the previous account's board, which that account cannot read -
 * so a normal account switch presented itself as a board that had been deleted
 * or revoked.
 */
interface AccountBoardMemory {
  boards: Record<string, RememberedBoard[]>;
  lastAccountId: string | null;
}

function readMemory(): AccountBoardMemory {
  const empty: AccountBoardMemory = { boards: {}, lastAccountId: null };
  try {
    const value: unknown = JSON.parse(
      bestEffortLocalStorage.getItem(LAST_CLOUD_BOARD_KEY) ?? 'null',
    );
    if (typeof value !== 'object' || value === null) return empty;
    // A single selection is the shape written before this was per account. It
    // belongs to whoever signs in next, so it is kept only until then.
    const legacy = readSelection(value);
    if (legacy !== null) return { boards: {}, lastAccountId: null };
    const boards: Record<string, RememberedBoard[]> = {};
    const stored = 'boards' in value ? value.boards : null;
    if (typeof stored === 'object' && stored !== null) {
      for (const [accountId, entries] of Object.entries(stored)) {
        if (!Array.isArray(entries)) continue;
        const remembered = entries
          .map((entry) => readRemembered(entry))
          .filter((entry): entry is RememberedBoard => entry !== null);
        if (remembered.length > 0) boards[accountId] = remembered;
      }
    }
    const lastAccountId =
      'lastAccountId' in value && typeof value.lastAccountId === 'string'
        ? value.lastAccountId
        : null;
    return { boards, lastAccountId };
  } catch {
    // Cached navigation is disposable; malformed data falls back safely.
    return empty;
  }
}

function writeMemory(memory: AccountBoardMemory): void {
  bestEffortLocalStorage.setItem(LAST_CLOUD_BOARD_KEY, JSON.stringify(memory));
}

/**
 * Reads an account's most recent cloud selection as provisional state only.
 *
 * Startup happens before the session is known, so a null account id answers for
 * whoever was signed in last. Once the session resolves, ask again with its
 * account id: a different account must not inherit this answer.
 */
export function loadLastBoard(
  accountId: string | null = null,
): RememberedBoard | null {
  const memory = readMemory();
  const owner = accountId ?? memory.lastAccountId;
  if (owner === null) return null;
  return memory.boards[owner]?.[0] ?? null;
}

/** The account's most recent cloud board, ignoring any local ones above it. */
export function loadLastCloudBoard(
  accountId: string | null = null,
): CloudBoardSelection | null {
  const memory = readMemory();
  const owner = accountId ?? memory.lastAccountId;
  if (owner === null) return null;
  const cloud = (memory.boards[owner] ?? []).find(
    (entry) => entry.kind === 'cloud',
  );
  return cloud?.kind === 'cloud' ? cloud.selection : null;
}

/** Drops a board an account can no longer open, and answers with its fallback. */
export function forgetBoard(
  accountId: string,
  boardId: string,
): RememberedBoard | null {
  const memory = readMemory();
  const remaining = (memory.boards[accountId] ?? []).filter(
    (entry) => rememberedBoardId(entry) !== boardId,
  );
  writeMemory({
    ...memory,
    boards: { ...memory.boards, [accountId]: remaining },
  });
  return remaining[0] ?? null;
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

/** Best-effort persistence of the board an account most recently opened. */
export function rememberBoard(accountId: string, board: RememberedBoard): void {
  const memory = readMemory();
  const existing = memory.boards[accountId] ?? [];
  const id = rememberedBoardId(board);
  const next = [
    board,
    ...existing.filter((entry) => rememberedBoardId(entry) !== id),
  ].slice(0, REMEMBERED_BOARDS_PER_ACCOUNT);
  writeMemory({
    boards: { ...memory.boards, [accountId]: next },
    lastAccountId: accountId,
  });
}

/** Records a cloud board as the account's most recent. */
export function rememberCloudBoard(
  accountId: string,
  selection: CloudBoardSelection,
): void {
  rememberBoard(accountId, { kind: 'cloud', selection });
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
  // No board named in the URL, so reopen whichever board this device last had
  // open for the account that was signed in - on this device or in the cloud.
  const remembered = loadLastBoard();
  if (remembered === null) {
    return {
      localBoardId,
      requestedBoardId: null,
      selectedBoard: null,
      status: 'idle',
    };
  }
  if (remembered.kind === 'local') {
    return {
      localBoardId: remembered.id,
      requestedBoardId: null,
      selectedBoard: null,
      status: 'idle',
    };
  }
  return {
    localBoardId,
    requestedBoardId: remembered.selection.id,
    selectedBoard: remembered.selection,
    status: 'resolving',
  };
}
