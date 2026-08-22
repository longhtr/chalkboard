/**
 * Bounded active-editor history. Snapshots include canonical source, mode, and
 * logical selection so undo restores one coherent editor transaction.
 */
export interface MixedEditorHistoryState {
  actorId?: string;
  hasExplicitMath: boolean;
  position: number;
  positionDomain?: 'field' | 'source';
  retainsMathOnlySource: boolean;
  source: string;
}

interface MixedEditorHistoryEntry extends MixedEditorHistoryState {
  beforePosition: number;
}

interface MixedEditorHistoryRestoration {
  position: number;
  snapshot: MixedEditorHistoryState;
}

/** Maximum undoable transactions retained by one active mixed-block session. */
export const MIXED_EDITOR_HISTORY_LIMIT = 100;

/** Bounded logical-source undo/redo history with explicit edit grouping. */
export class MixedEditorHistory {
  #entries: MixedEditorHistoryEntry[];
  #index = 0;
  #pendingBeforePosition: number | null = null;
  #groupStartIndex: number | null = null;
  #groupBeforePosition: number | null = null;
  #latestRebase: {
    afterRemote: string;
    beforeRemote: string;
    sources: string[];
  } | null = null;

  constructor(initial: MixedEditorHistoryState) {
    this.#entries = [{ ...initial, beforePosition: initial.position }];
  }

  get canRedo(): boolean {
    return this.canRedoFor();
  }

  get canUndo(): boolean {
    return this.canUndoFor();
  }

  canRedoFor(actorId?: string): boolean {
    const next = this.#entries[this.#index + 1];
    return (
      next !== undefined && (actorId === undefined || next.actorId === actorId)
    );
  }

  canUndoFor(actorId?: string): boolean {
    const current = this.#entries[this.#index];
    return (
      this.#index > 0 &&
      current !== undefined &&
      (actorId === undefined || current.actorId === actorId)
    );
  }

  #boundEntries(): void {
    const excess = this.#entries.length - (MIXED_EDITOR_HISTORY_LIMIT + 1);
    if (excess <= 0) return;
    this.#entries.splice(0, excess);
    this.#index = Math.max(0, this.#index - excess);
    if (this.#groupStartIndex !== null) {
      this.#groupStartIndex = Math.max(0, this.#groupStartIndex - excess);
    }
    this.#latestRebase?.sources.splice(0, excess);
  }

  hasSource(source: string): boolean {
    return this.#entries.some((entry) => entry.source === source);
  }

  /**
   * Re-enters a block at the board's authoritative source without discarding
   * that block's text history. A board undo may resume a known older snapshot;
   * an external edit is rebased across every local snapshot instead.
   */
  resume(
    current: MixedEditorHistoryState,
    merge: (base: string, edited: string, current: string) => string,
  ): void {
    this.finishGroup();
    this.#pendingBeforePosition = null;
    let matchingIndex = -1;
    for (let index = this.#entries.length - 1; index >= 0; index -= 1) {
      if (this.#entries[index]?.source === current.source) {
        matchingIndex = index;
        break;
      }
    }
    if (matchingIndex >= 0) {
      this.#index = matchingIndex;
      this.#latestRebase = null;
      return;
    }

    const active = this.#entries[this.#index];
    if (active === undefined) return;
    this.rebaseSources(active.source, current.source, merge);
    const resumed = this.#entries[this.#index];
    if (resumed !== undefined) {
      resumed.hasExplicitMath = current.hasExplicitMath;
      resumed.position = current.position;
      if (current.positionDomain === undefined) {
        delete resumed.positionDomain;
      } else {
        resumed.positionDomain = current.positionDomain;
      }
      resumed.retainsMathOnlySource = current.retainsMathOnlySource;
    }
    this.#latestRebase = null;
  }

  recordBarrier(snapshot: MixedEditorHistoryState): void {
    this.finishGroup();
    this.#pendingBeforePosition = null;
    this.#entries.splice(this.#index + 1);
    this.#entries.push({
      ...snapshot,
      beforePosition: snapshot.position,
    });
    this.#index = this.#entries.length - 1;
    this.#latestRebase = null;
    this.#boundEntries();
  }

  markBeforeEdit(position: number): void {
    this.#pendingBeforePosition ??= position;
  }

  clearPendingEdit(): void {
    this.#pendingBeforePosition = null;
  }

  beginGroup(beforePosition: number): void {
    if (this.#groupStartIndex !== null) return;
    this.#groupStartIndex = this.#index;
    this.#groupBeforePosition = beforePosition;
    this.markBeforeEdit(beforePosition);
  }

  finishGroup(): void {
    this.#groupStartIndex = null;
    this.#groupBeforePosition = null;
  }

  reconcileExternal(
    current: MixedEditorHistoryState,
    nextSource: string,
    merge: (base: string, edited: string, current: string) => string,
  ): void {
    const currentSourceKnown = this.hasSource(current.source);
    const nextSourceKnown = this.hasSource(nextSource);
    if (!currentSourceKnown) this.record(current);
    if (nextSourceKnown) {
      const latestRebase = this.#latestRebase;
      if (
        latestRebase?.afterRemote === current.source &&
        latestRebase.beforeRemote === nextSource
      ) {
        this.#entries.forEach((entry, index) => {
          entry.source = latestRebase.sources[index] ?? entry.source;
        });
        this.#latestRebase = null;
      }
      return;
    }
    this.rebaseSources(current.source, nextSource, merge);
  }

  rebaseSources(
    beforeRemote: string,
    afterRemote: string,
    merge: (base: string, edited: string, current: string) => string,
  ): void {
    if (beforeRemote === afterRemote) return;
    const original = this.#entries.map(({ source }) => source);
    this.#latestRebase = {
      afterRemote,
      beforeRemote,
      sources: [...original],
    };
    original[this.#index] = beforeRemote;
    const rebased = [...original];
    rebased[this.#index] = afterRemote;
    for (let index = this.#index - 1; index >= 0; index -= 1) {
      rebased[index] = merge(
        original[index + 1] ?? '',
        original[index] ?? '',
        rebased[index + 1] ?? '',
      );
    }
    for (let index = this.#index + 1; index < original.length; index += 1) {
      rebased[index] = merge(
        original[index - 1] ?? '',
        original[index] ?? '',
        rebased[index - 1] ?? '',
      );
    }
    this.#entries.forEach((entry, index) => {
      entry.source = rebased[index] ?? entry.source;
    });
  }

  record(snapshot: MixedEditorHistoryState): boolean {
    const current = this.#entries[this.#index];
    const beforePosition =
      this.#pendingBeforePosition ?? current?.position ?? snapshot.position;
    this.#pendingBeforePosition = null;

    if (this.#groupStartIndex !== null) {
      const groupStart = this.#groupStartIndex;
      const groupBase = this.#entries[groupStart];
      const changed = current?.source !== snapshot.source;
      this.#entries.splice(groupStart + 1);
      if (groupBase?.source === snapshot.source) {
        this.#index = groupStart;
        return changed;
      }
      this.#entries.push({
        ...snapshot,
        beforePosition: this.#groupBeforePosition ?? beforePosition,
      });
      this.#index = groupStart + 1;
      this.#boundEntries();
      return changed;
    }

    if (current?.source === snapshot.source) return false;
    this.#entries.splice(this.#index + 1);
    this.#entries.push({ ...snapshot, beforePosition });
    this.#index = this.#entries.length - 1;
    this.#boundEntries();
    return true;
  }

  step(
    direction: -1 | 1,
    actorId?: string,
  ): MixedEditorHistoryRestoration | null {
    this.finishGroup();
    const nextIndex = this.#index + direction;
    const current = this.#entries[this.#index];
    const snapshot = this.#entries[nextIndex];
    if (snapshot === undefined) return null;
    const transactionActor =
      direction < 0 ? current?.actorId : snapshot.actorId;
    if (actorId !== undefined && transactionActor !== actorId) return null;

    this.#index = nextIndex;
    this.#pendingBeforePosition = null;
    return {
      position:
        direction < 0
          ? (current?.beforePosition ?? snapshot.position)
          : snapshot.position,
      snapshot: {
        ...(snapshot.actorId === undefined
          ? {}
          : { actorId: snapshot.actorId }),
        hasExplicitMath: snapshot.hasExplicitMath,
        position: snapshot.position,
        ...(snapshot.positionDomain === undefined
          ? {}
          : { positionDomain: snapshot.positionDomain }),
        retainsMathOnlySource: snapshot.retainsMathOnlySource,
        source: snapshot.source,
      },
    };
  }
}
