/** Derives board-list summaries and deterministic default/copy titles directly from durable records. */
import {
  BOARD_STORE,
  openTransaction,
  requestResult,
  transactionComplete,
} from './boardDatabase';
import { prepareLocalBoardDuplicate } from './localBoardDuplication';
import { normalizedBoardTitle } from '../model/boardTitle';
import { LEGACY_LOCAL_BOARD_ID } from './localBoardCache';
import {
  LOCAL_BOARD_PREFIX,
  type CloudBoardCacheRecord,
  type LocalBoardRecord,
  type LocalBoardSaveResult,
  type LocalBoardSummary,
  type LocalBoardWrite,
  type StoredBoardRecord,
} from './localBoardRecords';
import { waitForLocalBoardWrites } from './localBoardWriteQueue';

type LoadLocalBoard = (boardId: string) => Promise<LocalBoardRecord | null>;
type SaveLocalBoard = (
  record: LocalBoardWrite,
  boardId: string,
) => Promise<LocalBoardSaveResult>;

/** Lists live local-board metadata after queued writes settle. */
export async function listLocalBoardMetadata(): Promise<LocalBoardSummary[]> {
  await waitForLocalBoardWrites();
  const transaction = await openTransaction(BOARD_STORE, 'readonly');
  const records = await requestResult(
    transaction.objectStore(BOARD_STORE).getAll() as IDBRequest<
      (StoredBoardRecord | CloudBoardCacheRecord)[]
    >,
  );
  await transactionComplete(transaction);

  const summaries = new Map<string, LocalBoardSummary>();
  for (const record of records) {
    let id: string | null = null;
    if (record.id.startsWith(LOCAL_BOARD_PREFIX)) {
      id = record.id.slice(LOCAL_BOARD_PREFIX.length);
    } else if (record.id === LEGACY_LOCAL_BOARD_ID) {
      id = LEGACY_LOCAL_BOARD_ID;
    }
    if (
      id === null ||
      id === '' ||
      ('trashedAt' in record && typeof record.trashedAt === 'number')
    ) {
      continue;
    }
    const updatedAt =
      typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : 0;
    const candidate: LocalBoardSummary = {
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
      updatedAt,
    };
    const existing = summaries.get(id);
    if (existing === undefined || candidate.updatedAt >= existing.updatedAt) {
      summaries.set(id, candidate);
    }
  }
  return [...summaries.values()].sort(
    (left, right) =>
      right.updatedAt - left.updatedAt || left.title.localeCompare(right.title),
  );
}

/** Creates an empty normalized board record with a collision-free identifier. */
export async function createLocalBoardMetadata(
  requestedTitle: string,
  saveLocalBoard: SaveLocalBoard,
): Promise<LocalBoardSummary> {
  const id = crypto.randomUUID();
  const timestamp = Date.now();
  const title = normalizedBoardTitle(requestedTitle);
  await saveLocalBoard(
    { createdAt: timestamp, elements: [], title, updatedAt: timestamp },
    id,
  );
  return { createdAt: timestamp, id, title, updatedAt: timestamp };
}

/** Renames one live board through optimistic-concurrency persistence. */
export async function renameLocalBoardMetadata(
  boardId: string,
  title: string,
  loadLocalBoard: LoadLocalBoard,
  saveLocalBoard: SaveLocalBoard,
): Promise<LocalBoardSummary | null> {
  const record = await loadLocalBoard(boardId);
  if (record === null) return null;
  const updatedAt = Math.max(Date.now(), record.updatedAt + 1);
  const normalizedTitle = normalizedBoardTitle(title);
  const result = await saveLocalBoard(
    { ...record, title: normalizedTitle, updatedAt },
    boardId,
  );
  return result.committed
    ? {
        createdAt: record.createdAt,
        id: boardId,
        title: normalizedTitle,
        updatedAt,
      }
    : {
        createdAt: result.current.createdAt,
        id: boardId,
        title: result.current.title,
        updatedAt: result.current.updatedAt,
      };
}

/** Duplicates a fully loaded board through the authoritative save boundary. */
export async function duplicateLocalBoardMetadata(
  boardId: string,
  loadLocalBoard: LoadLocalBoard,
  saveLocalBoard: SaveLocalBoard,
): Promise<LocalBoardSummary | null> {
  const record = await loadLocalBoard(boardId);
  if (record === null) return null;
  const duplicate = prepareLocalBoardDuplicate(record, Date.now(), () =>
    crypto.randomUUID(),
  );
  await saveLocalBoard(duplicate.record, duplicate.id);
  const { createdAt, title, updatedAt } = duplicate.record;
  return { createdAt, id: duplicate.id, title, updatedAt };
}
