/** Bounded edit histories for individual board objects, independent of deletion history. */
import { isEquationElement, type BoardElement } from '@chalkboard/shared';

export const OBJECT_EDIT_HISTORY_LIMIT = 100;

interface EditTransaction {
  actorId: string;
  id: number;
}

interface ObjectSnapshot {
  element: BoardElement;
  order: number;
  /** The semantic commit that moved from the previous entry to this one. */
  transaction: EditTransaction | null;
}

interface ObjectHistoryState {
  entries: ObjectSnapshot[];
  index: number;
}

function valuesEqual(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (Array.isArray(first) || Array.isArray(second)) {
    return (
      Array.isArray(first) &&
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((value, index) => valuesEqual(value, second[index]))
    );
  }
  if (
    typeof first !== 'object' ||
    first === null ||
    typeof second !== 'object' ||
    second === null
  ) {
    return false;
  }
  const firstRecord = first as Record<string, unknown>;
  const secondRecord = second as Record<string, unknown>;
  const firstKeys = Object.keys(firstRecord);
  return (
    firstKeys.length === Object.keys(secondRecord).length &&
    firstKeys.every(
      (key) =>
        Object.hasOwn(secondRecord, key) &&
        valuesEqual(firstRecord[key], secondRecord[key]),
    )
  );
}

function elementsEqual(first: BoardElement, second: BoardElement): boolean {
  return valuesEqual(first, second);
}

/** Equation bounds are asynchronous measurement, not a writer-owned edit. */
function elementsAlign(first: BoardElement, second: BoardElement): boolean {
  if (!isEquationElement(first) || !isEquationElement(second)) {
    return elementsEqual(first, second);
  }
  return valuesEqual(
    { ...first, height: 0, width: 0 },
    { ...second, height: 0, width: 0 },
  );
}

function snapshotsById(elements: readonly BoardElement[]) {
  return new Map(
    elements.map((element, order) => [
      element.id,
      { element, order, transaction: null } satisfies ObjectSnapshot,
    ]),
  );
}

/** Object-local undo/redo stacks with creation as their structural base. */
export class ObjectEditHistory {
  readonly #histories = new Map<string, ObjectHistoryState>();
  #nextTransaction = 1;

  #bound(state: ObjectHistoryState): void {
    const excess = state.entries.length - (OBJECT_EDIT_HISTORY_LIMIT + 1);
    if (excess <= 0) return;
    state.entries.splice(0, excess);
    state.index = Math.max(0, state.index - excess);
  }

  #align(
    id: string,
    elements: readonly BoardElement[],
  ): ObjectHistoryState | undefined {
    const state = this.#histories.get(id);
    if (state === undefined) return undefined;
    const order = elements.findIndex((element) => element.id === id);
    const current = order < 0 ? undefined : elements[order];
    if (current === undefined) return state;
    const active = state.entries[state.index];
    if (active !== undefined && elementsAlign(active.element, current)) {
      active.element = current;
      active.order = order;
      return state;
    }
    for (let index = state.entries.length - 1; index >= 0; index -= 1) {
      const entry = state.entries[index];
      if (entry !== undefined && elementsAlign(entry.element, current)) {
        entry.element = current;
        entry.order = order;
        state.index = index;
        return state;
      }
    }
    // Geometry has no safe merge equivalent to text reconciliation. An
    // authoritative external value becomes the new local base for this object.
    state.entries = [{ element: current, order, transaction: null }];
    state.index = 0;
    return state;
  }

  /** Records one semantic transaction across every existing object it changed. */
  record(
    before: readonly BoardElement[],
    after: readonly BoardElement[],
    actorId = 'local',
  ): string[] {
    const beforeById = snapshotsById(before);
    const afterById = snapshotsById(after);
    // Deletion is a new semantic branch. Keep the object's past for a later
    // deletion undo, but discard any object-edit redo that preceded Delete.
    for (const id of beforeById.keys()) {
      if (afterById.has(id)) continue;
      const state = this.#align(id, before);
      if (state !== undefined && state.index < state.entries.length - 1) {
        state.entries = state.entries.slice(0, state.index + 1);
      }
    }
    const sameMembership =
      beforeById.size === afterById.size &&
      [...beforeById.keys()].every((id) => afterById.has(id));
    const changes: {
      after: ObjectSnapshot;
      before: ObjectSnapshot;
      id: string;
    }[] = [];

    for (const [id, afterSnapshot] of afterById) {
      const beforeSnapshot = beforeById.get(id);
      if (beforeSnapshot === undefined) {
        if (!this.#histories.has(id)) {
          this.#histories.set(id, {
            entries: [afterSnapshot],
            index: 0,
          });
        }
        continue;
      }
      if (
        elementsEqual(beforeSnapshot.element, afterSnapshot.element) &&
        (!sameMembership || beforeSnapshot.order === afterSnapshot.order)
      ) {
        continue;
      }
      changes.push({ after: afterSnapshot, before: beforeSnapshot, id });
    }
    if (changes.length === 0) return [];
    const transaction = { actorId, id: this.#nextTransaction };
    this.#nextTransaction += 1;

    for (const change of changes) {
      let state = this.#histories.get(change.id);
      if (state === undefined) {
        state = { entries: [change.before], index: 0 };
        this.#histories.set(change.id, state);
      } else {
        const active = state.entries[state.index];
        if (
          active === undefined ||
          !elementsEqual(active.element, change.before.element)
        ) {
          const knownIndex = state.entries.findIndex((entry) =>
            elementsEqual(entry.element, change.before.element),
          );
          if (knownIndex >= 0) state.index = knownIndex;
          else {
            state.entries.splice(state.index + 1);
            state.entries.push({ ...change.before, transaction: null });
            state.index = state.entries.length - 1;
          }
        }
      }
      state.entries.splice(state.index + 1);
      state.entries.push({ ...change.after, transaction });
      state.index = state.entries.length - 1;
      this.#bound(state);
    }
    return changes.map(({ id }) => id);
  }

  /** Updates the current transaction endpoint during a slider/typing gesture. */
  replaceCurrent(
    before: readonly BoardElement[],
    after: readonly BoardElement[],
  ): void {
    const beforeById = snapshotsById(before);
    const afterById = snapshotsById(after);
    for (const [id, afterSnapshot] of afterById) {
      const beforeSnapshot = beforeById.get(id);
      if (
        beforeSnapshot === undefined ||
        (elementsEqual(beforeSnapshot.element, afterSnapshot.element) &&
          beforeSnapshot.order === afterSnapshot.order)
      ) {
        continue;
      }
      const state = this.#histories.get(id);
      const active = state?.entries[state.index];
      if (state === undefined || active === undefined) {
        this.#histories.set(id, { entries: [afterSnapshot], index: 0 });
      } else {
        state.entries[state.index] = {
          ...afterSnapshot,
          transaction: active.transaction,
        };
      }
    }
  }

  canStep(
    ids: readonly string[],
    direction: -1 | 1,
    elements: readonly BoardElement[],
    actorId = 'local',
  ): boolean {
    return [...new Set(ids)].some((id) => {
      const state = this.#align(id, elements);
      if (state === undefined) return false;
      const nextIndex = state.index + direction;
      if (nextIndex < 0 || nextIndex >= state.entries.length) return false;
      const entry =
        direction < 0 ? state.entries[state.index] : state.entries[nextIndex];
      return entry?.transaction?.actorId === actorId;
    });
  }

  step(
    ids: readonly string[],
    direction: -1 | 1,
    elements: readonly BoardElement[],
    actorId = 'local',
  ): BoardElement[] | null {
    const candidates: {
      id: string;
      nextIndex: number;
      state: ObjectHistoryState;
      transaction: EditTransaction;
    }[] = [];
    for (const id of new Set(ids)) {
      const state = this.#align(id, elements);
      if (state === undefined) continue;
      const nextIndex = state.index + direction;
      if (nextIndex < 0 || nextIndex >= state.entries.length) continue;
      const transaction =
        direction < 0
          ? state.entries[state.index]?.transaction
          : state.entries[nextIndex]?.transaction;
      if (transaction === null || transaction?.actorId !== actorId) continue;
      candidates.push({ id, nextIndex, state, transaction });
    }
    if (candidates.length === 0) return null;
    const targetTransaction =
      direction < 0
        ? Math.max(...candidates.map(({ transaction }) => transaction.id))
        : Math.min(...candidates.map(({ transaction }) => transaction.id));
    const restorations = candidates.filter(
      ({ transaction }) => transaction.id === targetTransaction,
    );
    if (restorations.length === 0) return null;

    const restored = [...elements];
    const snapshots: ObjectSnapshot[] = [];
    for (const restoration of restorations) {
      restoration.state.index = restoration.nextIndex;
      const snapshot = restoration.state.entries[restoration.nextIndex];
      if (snapshot === undefined) continue;
      const currentIndex = restored.findIndex(
        (element) => element.id === restoration.id,
      );
      if (currentIndex >= 0) restored.splice(currentIndex, 1);
      snapshots.push(snapshot);
    }
    snapshots
      .sort((left, right) => left.order - right.order)
      .forEach((snapshot) => {
        restored.splice(
          Math.min(Math.max(0, snapshot.order), restored.length),
          0,
          snapshot.element,
        );
      });
    return restored;
  }
}
