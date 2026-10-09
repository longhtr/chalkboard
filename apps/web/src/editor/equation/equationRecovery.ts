/**
 * Persists and restores the smallest crash-recovery record for one active
 * equation session, scoped to an exact board and durable base revision.
 */
import type { BoardElement, EquationElement } from '@chalkboard/shared';

import { isEmptyMixedSource } from '../../math/mixedMath';
import { hoistWholeTextColor } from '../model/boardSerialization';
import {
  cachePendingLocalEquationEdit,
  removePendingLocalEquationEdit,
} from '../local/localEquationRecovery';

interface PendingEquationDraft {
  draft: EquationElement;
  initialSource: string;
  isNew: boolean;
}

/** Caches a complete measured equation draft before its semantic commit. */
export function stagePendingEquationDraft(
  boardId: string | null,
  editing: PendingEquationDraft,
  result: { height: number; source: string; width: number },
): void {
  if (boardId === null) return;
  const { height, source, width } = result;
  if (editing.isNew && isEmptyMixedSource(source)) {
    removePendingLocalEquationEdit(boardId);
    return;
  }
  const deleted = !editing.isNew && isEmptyMixedSource(source);
  cachePendingLocalEquationEdit(
    {
      baseSource: editing.initialSource,
      deleted,
      element: deleted
        ? { ...editing.draft, height, width }
        : hoistWholeTextColor({ ...editing.draft, height, width }, source),
      isNew: editing.isNew,
    },
    boardId,
  );
}

/** Persists committed elements, then clears only the matching staged draft. */
export function finishPendingEquationDraft(
  boardId: string | null,
  committedElements: BoardElement[] | null,
  persistBoard: (elements: BoardElement[]) => void,
): void {
  if (boardId === null) return;
  if (committedElements === null) {
    removePendingLocalEquationEdit(boardId);
  } else {
    persistBoard(committedElements);
  }
}
