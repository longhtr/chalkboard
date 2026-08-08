/** Proves deduplication, bounded past/future stacks, branching, and complete snapshot restoration. */
import { describe, expect, it } from 'vitest';

import { requiredTestValue } from '../test/assertions';
import {
  MixedEditorHistory,
  type MixedEditorHistoryState,
} from './editorHistory';
import { mergeEquationSourceEdit } from './mergeEquationSourceEdit';

function requiredHistoryStep(history: MixedEditorHistory, direction: -1 | 1) {
  return requiredTestValue(
    history.step(direction),
    direction === -1 ? 'undo history step' : 'redo history step',
  );
}

const snapshot = (
  source: string,
  position: number,
): MixedEditorHistoryState => ({
  hasExplicitMath: source.includes('$'),
  position,
  retainsMathOnlySource: source.startsWith('$'),
  source,
});

describe('mixed editor history', () => {
  it('restores the pre-edit caret on undo and final caret on redo', () => {
    const history = new MixedEditorHistory(snapshot('abc', 3));
    history.markBeforeEdit(1);
    expect(history.record(snapshot('aXbc', 2))).toBe(true);

    expect(history.step(-1)).toEqual({
      position: 1,
      snapshot: snapshot('abc', 3),
    });
    expect(history.step(1)).toEqual({
      position: 2,
      snapshot: snapshot('aXbc', 2),
    });
  });

  it('does not create entries for presentation-only updates', () => {
    const history = new MixedEditorHistory(snapshot('abc', 3));
    history.markBeforeEdit(1);
    expect(history.record(snapshot('abc', 2))).toBe(false);
    expect(history.step(-1)).toBeNull();

    // A no-op consumes its pending position instead of contaminating the next
    // real edit.
    expect(history.record(snapshot('abcd', 4))).toBe(true);
    expect(requiredHistoryStep(history, -1).position).toBe(3);
  });

  it('rebases undo and redo snapshots over accepted remote input', () => {
    const history = new MixedEditorHistory(snapshot('Shared', 6));
    history.record(snapshot('SharedA', 7));

    history.rebaseSources('SharedA', 'SharedAB', mergeEquationSourceEdit);

    expect(requiredHistoryStep(history, -1).snapshot.source).toBe('SharedB');
    expect(requiredHistoryStep(history, 1).snapshot.source).toBe('SharedAB');
  });

  it('preserves local undo across transient known collaborative snapshots', () => {
    const history = new MixedEditorHistory(snapshot('Shared $x$', 10));

    history.reconcileExternal(
      snapshot('Shared $xq$', 11),
      'Shared $xq$B',
      mergeEquationSourceEdit,
    );
    expect(history.hasSource('Shared $x$B')).toBe(true);
    expect(history.hasSource('Shared $xq$B')).toBe(true);

    // Concurrent model notifications can briefly duplicate a local delta and
    // then return to the known converged value. The return reverses only that
    // transient rebase.
    history.reconcileExternal(
      snapshot('Shared $xq$B', 12),
      'Shared $xqq$B',
      mergeEquationSourceEdit,
    );
    history.reconcileExternal(
      snapshot('Shared $xqq$B', 13),
      'Shared $xq$B',
      mergeEquationSourceEdit,
    );

    // A stale remote-only snapshot can also be presented before convergence is
    // restored. Neither known source may erase the local q edit from history.
    history.reconcileExternal(
      snapshot('Shared $xq$B', 12),
      'Shared $x$B',
      mergeEquationSourceEdit,
    );
    history.reconcileExternal(
      snapshot('Shared $x$B', 11),
      'Shared $xq$B',
      mergeEquationSourceEdit,
    );

    expect(history.hasSource('Shared $xq$C')).toBe(false);
    expect(requiredHistoryStep(history, -1).snapshot.source).toBe(
      'Shared $x$B',
    );
    expect(requiredHistoryStep(history, 1).snapshot.source).toBe(
      'Shared $xq$B',
    );
  });

  it('rebases an existing redo branch over remote input', () => {
    const history = new MixedEditorHistory(snapshot('a', 1));
    history.record(snapshot('ab', 2));
    history.record(snapshot('abc', 3));
    expect(requiredHistoryStep(history, -1).snapshot.source).toBe('ab');

    history.rebaseSources('ab', 'abX', mergeEquationSourceEdit);

    expect(requiredHistoryStep(history, -1).snapshot.source).toBe('aX');
    expect(requiredHistoryStep(history, 1).snapshot.source).toBe('abX');
    expect(requiredHistoryStep(history, 1).snapshot.source).toBe('abcX');
  });

  it('drops the redo branch after editing an undone snapshot', () => {
    const history = new MixedEditorHistory(snapshot('a', 1));
    history.record(snapshot('ab', 2));
    history.record(snapshot('abc', 3));
    expect(requiredHistoryStep(history, -1).snapshot.source).toBe('ab');

    history.record(snapshot('abX', 3));
    expect(history.step(1)).toBeNull();
    expect(requiredHistoryStep(history, -1).snapshot.source).toBe('ab');
  });

  it('collapses an in-progress command group into one undo entry', () => {
    const history = new MixedEditorHistory(snapshot('abcdef', 4));
    history.beginGroup(2);
    history.record(snapshot('abef', 2));
    history.record(snapshot(String.raw`ab\dot{}ef`, 3));
    history.record(snapshot(String.raw`ab\dot{x}ef`, 4));
    history.finishGroup();

    expect(history.step(-1)).toEqual({
      position: 2,
      snapshot: snapshot('abcdef', 4),
    });
    expect(history.step(1)).toEqual({
      position: 4,
      snapshot: snapshot(String.raw`ab\dot{x}ef`, 4),
    });
  });

  it('removes a group entry when cancellation returns to its source', () => {
    const history = new MixedEditorHistory(snapshot('abc', 1));
    history.beginGroup(1);
    history.record(snapshot('ac', 1));
    history.record(snapshot('abc', 1));
    history.finishGroup();
    expect(history.step(-1)).toBeNull();
  });

  it('clears pending positions on explicit cancellation and restoration', () => {
    const history = new MixedEditorHistory(snapshot('a', 1));
    history.markBeforeEdit(0);
    history.clearPendingEdit();
    history.record(snapshot('ab', 2));
    expect(requiredHistoryStep(history, -1).position).toBe(1);

    history.markBeforeEdit(0);
    expect(requiredHistoryStep(history, 1).position).toBe(2);
    history.record(snapshot('abc', 3));
    expect(requiredHistoryStep(history, -1).position).toBe(2);
  });
});
