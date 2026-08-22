import type { BoardElement } from '@chalkboard/shared';

const HISTORY_LIMIT = 100;

interface LocatedElement {
  element: BoardElement;
  order: number;
}

interface StructureTransaction {
  actorId: string;
  added: LocatedElement[];
  /** `null` is an unknown barrier; an array identifies object-edit barriers. */
  barrierIds: string[] | null;
  removed: LocatedElement[];
  sequence: number;
  undoneAfterSequence?: number;
}

export interface StructureHistoryResult {
  elements: BoardElement[];
  ids: string[];
}

function isStructural(transaction: StructureTransaction): boolean {
  return transaction.added.length > 0 || transaction.removed.length > 0;
}

function affectedIds(transaction: StructureTransaction): string[] {
  if (isStructural(transaction)) {
    return [...transaction.added, ...transaction.removed].map(
      ({ element }) => element.id,
    );
  }
  return transaction.barrierIds ?? [];
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const uniqueLeft = new Set(left);
  const uniqueRight = new Set(right);
  if (uniqueLeft.size !== uniqueRight.size) return false;
  return [...uniqueLeft].every((id) => uniqueRight.has(id));
}

function conflictsWith(
  transaction: StructureTransaction,
  candidateIds: ReadonlySet<string>,
): boolean {
  if (!isStructural(transaction) && transaction.barrierIds === null) {
    return true;
  }
  return affectedIds(transaction).some((id) => candidateIds.has(id));
}

function restoreLocatedElements(
  elements: BoardElement[],
  snapshots: readonly LocatedElement[],
): void {
  [...snapshots]
    .sort((left, right) => left.order - right.order)
    .forEach(({ element, order }) => {
      elements.splice(
        Math.min(Math.max(0, order), elements.length),
        0,
        element,
      );
    });
}

/**
 * Global, actor-scoped history for changes to board membership.
 *
 * Object edits deliberately live elsewhere. Creation and deletion share one
 * chronology, while disjoint collaborator transactions may be crossed without
 * reverting them. A peer change to the same object remains a hard boundary.
 */
export class BoardStructureHistory {
  #past: StructureTransaction[] = [];
  #future: StructureTransaction[] = [];
  #sequence = 0;

  clear(): void {
    this.#past = [];
    this.#future = [];
    this.#sequence = 0;
  }

  clearRedo(): void {
    this.#future = [];
  }

  record(
    before: readonly BoardElement[],
    after: readonly BoardElement[],
    actorId = 'local',
  ): boolean {
    const beforeById = new Map(
      before.map((element, order) => [element.id, { element, order }]),
    );
    const afterById = new Map(
      after.map((element, order) => [element.id, { element, order }]),
    );
    const added = [...afterById]
      .filter(([id]) => !beforeById.has(id))
      .map(([, snapshot]) => snapshot);
    const removed = [...beforeById]
      .filter(([id]) => !afterById.has(id))
      .map(([, snapshot]) => snapshot);

    if (added.length === 0 && removed.length === 0) return false;
    this.#push({ actorId, added, barrierIds: [], removed });
    return true;
  }

  /** Records an external object edit that a structural step must not erase. */
  recordBarrier(actorId: string, ids?: readonly string[]): void {
    const barrierIds = ids === undefined ? null : [...new Set(ids)];
    if (barrierIds?.length === 0) return;
    const latest = this.#past.at(-1);
    if (
      latest?.actorId === actorId &&
      !isStructural(latest) &&
      ((latest.barrierIds === null && barrierIds === null) ||
        (latest.barrierIds !== null &&
          barrierIds !== null &&
          sameIds(latest.barrierIds, barrierIds)))
    ) {
      return;
    }
    this.#push({ actorId, added: [], barrierIds, removed: [] });
  }

  canUndo(actorId = 'local'): boolean {
    return this.#undoIndex(actorId) >= 0;
  }

  canRedo(actorId = 'local'): boolean {
    return this.#redoIndex(actorId) >= 0;
  }

  canUndoSelection(ids: readonly string[], actorId = 'local'): boolean {
    const index = this.#undoIndex(actorId);
    return index >= 0 && sameIds(ids, affectedIds(this.#past[index]!));
  }

  canRedoSelection(ids: readonly string[], actorId = 'local'): boolean {
    const index = this.#redoIndex(actorId);
    return index >= 0 && sameIds(ids, affectedIds(this.#future[index]!));
  }

  undo(
    current: readonly BoardElement[],
    actorId = 'local',
  ): StructureHistoryResult | null {
    const index = this.#undoIndex(actorId);
    if (index < 0) return null;
    const [transaction] = this.#past.splice(index, 1);
    if (transaction === undefined) return null;
    const elements = this.#apply(
      current,
      transaction.added,
      transaction.removed,
    );
    transaction.undoneAfterSequence = this.#sequence;
    this.#future.push(transaction);
    return { elements, ids: affectedIds(transaction) };
  }

  redo(
    current: readonly BoardElement[],
    actorId = 'local',
  ): StructureHistoryResult | null {
    const index = this.#redoIndex(actorId);
    if (index < 0) return null;
    const [transaction] = this.#future.splice(index, 1);
    if (transaction === undefined) return null;
    const elements = this.#apply(
      current,
      transaction.removed,
      transaction.added,
    );
    transaction.sequence = ++this.#sequence;
    delete transaction.undoneAfterSequence;
    this.#past.push(transaction);
    this.#boundPast();
    return { elements, ids: affectedIds(transaction) };
  }

  #push(transaction: Omit<StructureTransaction, 'sequence'>): void {
    this.#past.push({ ...transaction, sequence: ++this.#sequence });
    this.#boundPast();
    // A new branch invalidates only that actor's undone work. A collaborator's
    // disjoint operation must not erase this user's redo stack.
    this.#future = this.#future.filter(
      ({ actorId }) => actorId !== transaction.actorId,
    );
  }

  #boundPast(): void {
    if (this.#past.length > HISTORY_LIMIT) this.#past.shift();
  }

  #latestStructuralIndex(
    transactions: readonly StructureTransaction[],
    actorId: string,
  ): number {
    for (let index = transactions.length - 1; index >= 0; index -= 1) {
      const transaction = transactions[index];
      if (transaction?.actorId === actorId && isStructural(transaction)) {
        return index;
      }
    }
    return -1;
  }

  #undoIndex(actorId: string): number {
    const index = this.#latestStructuralIndex(this.#past, actorId);
    if (index < 0) return -1;
    const candidate = this.#past[index]!;
    const candidateIds = new Set(affectedIds(candidate));
    const blocked = this.#past
      .slice(index + 1)
      .some(
        (transaction) =>
          transaction.actorId !== actorId &&
          conflictsWith(transaction, candidateIds),
      );
    return blocked ? -1 : index;
  }

  #redoIndex(actorId: string): number {
    const index = this.#latestStructuralIndex(this.#future, actorId);
    if (index < 0) return -1;
    const candidate = this.#future[index]!;
    const boundary = candidate.undoneAfterSequence;
    if (boundary === undefined) return -1;
    const candidateIds = new Set(affectedIds(candidate));
    const blocked = this.#past.some(
      (transaction) =>
        transaction.sequence > boundary &&
        transaction.actorId !== actorId &&
        conflictsWith(transaction, candidateIds),
    );
    return blocked ? -1 : index;
  }

  #apply(
    current: readonly BoardElement[],
    remove: LocatedElement[],
    restore: readonly LocatedElement[],
  ): BoardElement[] {
    const elements = [...current];
    const removeIds = new Set(remove.map(({ element }) => element.id));

    // Capture the latest semantic state before removing an object. A creation
    // may have been edited since it was first recorded, and redo must restore
    // exactly what the user saw when they invoked undo.
    remove.forEach((snapshot) => {
      const order = elements.findIndex(({ id }) => id === snapshot.element.id);
      if (order >= 0) {
        snapshot.element = elements[order] as BoardElement;
        snapshot.order = order;
      }
    });

    const retained = elements.filter(({ id }) => !removeIds.has(id));
    restoreLocatedElements(retained, restore);
    return retained;
  }
}
