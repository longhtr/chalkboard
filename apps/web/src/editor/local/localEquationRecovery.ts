/** Validates and stores one compact active-equation recovery record outside committed board history. */
import {
  isEquationElement,
  type BoardElement,
  type EquationElement,
} from '@chalkboard/shared';

import { parseStoredElements } from '../model/boardSerialization';

const LOCAL_PENDING_EQUATION_EDIT_KEY =
  'chalkboard:pending-local-equation-edit';

/** Builds the critical-recovery key for one active equation draft. */
export function localPendingEquationEditKey(boardId: string): string {
  return `${LOCAL_PENDING_EQUATION_EDIT_KEY}:${boardId}`;
}

interface PendingLocalEquationEdit {
  baseSource: string;
  deleted: boolean;
  element: EquationElement;
  isNew: boolean;
  version: 1;
}

function loadPendingLocalEquationEdit(
  boardId: string,
): PendingLocalEquationEdit | null {
  try {
    const serialized = localStorage.getItem(
      localPendingEquationEditKey(boardId),
    );
    if (serialized === null) return null;
    const value: unknown = JSON.parse(serialized);
    if (
      typeof value !== 'object' ||
      value === null ||
      (value as { version?: unknown }).version !== 1 ||
      typeof (value as { baseSource?: unknown }).baseSource !== 'string' ||
      typeof (value as { deleted?: unknown }).deleted !== 'boolean' ||
      typeof (value as { isNew?: unknown }).isNew !== 'boolean'
    ) {
      removePendingLocalEquationEdit(boardId);
      return null;
    }
    const [element] = parseStoredElements(
      JSON.stringify([(value as { element?: unknown }).element]),
    );
    if (element === undefined || !isEquationElement(element)) {
      removePendingLocalEquationEdit(boardId);
      return null;
    }
    return {
      baseSource: (value as { baseSource: string }).baseSource,
      deleted: (value as { deleted: boolean }).deleted,
      element,
      isNew: (value as { isNew: boolean }).isNew,
      version: 1,
    };
  } catch {
    removePendingLocalEquationEdit(boardId);
    return null;
  }
}

/** Stores one complete equation draft before its board commit. */
export function cachePendingLocalEquationEdit(
  edit: Omit<PendingLocalEquationEdit, 'version'>,
  boardId: string,
): boolean {
  try {
    localStorage.setItem(
      localPendingEquationEditKey(boardId),
      JSON.stringify({ ...edit, version: 1 }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Best-effort removes an equation draft superseded by durable state. */
export function removePendingLocalEquationEdit(boardId: string): void {
  try {
    localStorage.removeItem(localPendingEquationEditKey(boardId));
  } catch {
    // IndexedDB and the complete pending snapshot remain available.
  }
}

/** Reconstructs a staged new/edit equation onto durable board elements. */
export function applyPendingLocalEquationEdit(
  elements: BoardElement[],
  boardId: string,
): BoardElement[] {
  const edit = loadPendingLocalEquationEdit(boardId);
  if (edit === null) return elements;
  const index = elements.findIndex(({ id }) => id === edit.element.id);
  const current = elements[index];
  if (edit.deleted) {
    return index >= 0 &&
      current !== undefined &&
      isEquationElement(current) &&
      (current.source === edit.baseSource ||
        current.source === edit.element.source)
      ? elements.filter(({ id }) => id !== edit.element.id)
      : elements;
  }
  if (edit.isNew) {
    if (index >= 0 || edit.element.source.trim() === '') return elements;
    return [...elements, edit.element];
  }
  if (
    index < 0 ||
    current === undefined ||
    !isEquationElement(current) ||
    (current.source !== edit.baseSource &&
      current.source !== edit.element.source)
  ) {
    return elements;
  }
  if (
    current.source === edit.element.source &&
    current.width === edit.element.width &&
    current.height === edit.element.height
  ) {
    return elements;
  }
  const recovered = [...elements];
  recovered[index] = edit.element;
  return recovered;
}

/** Clears a draft only after durable elements contain its exact result. */
export function clearCommittedPendingLocalEquationEdit(
  elements: BoardElement[],
  boardId: string,
): void {
  const edit = loadPendingLocalEquationEdit(boardId);
  if (edit === null) return;
  const committed = elements.find(({ id }) => id === edit.element.id);
  if (edit.deleted && committed === undefined) {
    removePendingLocalEquationEdit(boardId);
    return;
  }
  if (
    committed !== undefined &&
    isEquationElement(committed) &&
    committed.source === edit.element.source &&
    committed.width === edit.element.width &&
    committed.height === edit.element.height
  ) {
    removePendingLocalEquationEdit(boardId);
  }
}
