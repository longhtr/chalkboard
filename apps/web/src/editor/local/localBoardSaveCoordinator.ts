/**
 * Orders one local save: provisional recovery first, atomic IndexedDB commit,
 * then exact recovery clear, cache publication, and cross-tab notification.
 */
import type {
  LocalBoardRecord,
  LocalBoardSaveResult,
  LocalBoardWrite,
} from './localBoardRecords';
import {
  cacheLocalElements,
  cacheLocalTitle,
  clearPendingLocalElements,
  publishLocalBoardUpdate,
} from './localBoardCache';
import { clearCommittedPendingLocalBoardPatch } from './localBoardPatchRecovery';
import { clearCommittedPendingLocalEquationEdit } from './localEquationRecovery';

/** Detects whether a write lost optimistic concurrency to a newer durable revision. */
export function isStaleLocalBoardRevision(
  currentUpdatedAt: number | undefined,
  incomingUpdatedAt: number,
): boolean {
  return (
    typeof currentUpdatedAt === 'number' &&
    Number.isFinite(currentUpdatedAt) &&
    currentUpdatedAt >= incomingUpdatedAt
  );
}

interface LocalBoardSaveCoordination {
  boardId: string;
  loadCurrent(): Promise<LocalBoardRecord | null>;
  record: LocalBoardWrite;
  saveDurably(): Promise<boolean>;
}

/** Publishes only committed state and reconciles a rejected stale writer. */
export async function coordinateLocalBoardSave({
  boardId,
  loadCurrent,
  record,
  saveDurably,
}: LocalBoardSaveCoordination): Promise<LocalBoardSaveResult> {
  const committed = await saveDurably();
  const serializedElements =
    record.serializedElementsForCaches ?? JSON.stringify(record.elements);
  if (!committed) {
    const current = await loadCurrent();
    if (current === null) {
      throw new Error('The newer local board revision is unavailable');
    }
    clearPendingLocalElements(
      record.elements,
      record.title,
      boardId,
      serializedElements,
    );
    cacheLocalElements(current.elements, boardId);
    cacheLocalTitle(current.title, boardId);
    clearCommittedPendingLocalEquationEdit(current.elements, boardId);
    clearCommittedPendingLocalBoardPatch(current.elements, boardId);
    return { committed: false, current };
  }
  clearPendingLocalElements(
    record.elements,
    record.title,
    boardId,
    serializedElements,
  );
  cacheLocalElements(record.elements, boardId, serializedElements);
  cacheLocalTitle(record.title, boardId);
  clearCommittedPendingLocalEquationEdit(record.elements, boardId);
  clearCommittedPendingLocalBoardPatch(record.elements, boardId);
  publishLocalBoardUpdate(boardId, record.updatedAt);
  return { committed: true };
}
