/** Global creation/deletion chronology, ordering, grouping, actors, and branching. */
import type { BoardElement } from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import { BoardStructureHistory } from './boardStructureHistory';

function shape(id: string, x = 0): BoardElement {
  return {
    backgroundColor: 'transparent',
    cornerRadius: 0,
    createdBy: 'local',
    fillStyle: 'solid',
    height: 20,
    id,
    opacity: 1,
    rotation: 0,
    shapeKind: 'rectangle',
    strokeColor: '#111111',
    strokeStyle: 'solid',
    strokeWidth: 2,
    type: 'shape',
    width: 30,
    x,
    y: 0,
  };
}

describe('board structure history', () => {
  it('undoes and redoes creation while preserving subsequent object state', () => {
    const history = new BoardStructureHistory();
    const created = shape('shape');
    const edited = { ...created, x: 40 };
    history.record([], [created]);

    const undone = history.undo([edited]);
    expect(undone).toEqual({ elements: [], ids: ['shape'] });
    expect(history.canRedoSelection(['shape'])).toBe(true);
    expect(history.redo([])).toEqual({
      elements: [edited],
      ids: ['shape'],
    });
  });

  it('keeps immediate creation and deletion as distinct chronological steps', () => {
    const history = new BoardStructureHistory();
    const created = shape('shape');
    history.record([], [created]);
    history.record([created], []);

    const restored = history.undo([]);
    expect(restored).toEqual({ elements: [created], ids: ['shape'] });
    expect(history.redo(restored?.elements ?? [])).toEqual({
      elements: [],
      ids: ['shape'],
    });

    const restoredAgain = history.undo([]);
    const creationUndone = history.undo(restoredAgain?.elements ?? []);
    expect(creationUndone).toEqual({ elements: [], ids: ['shape'] });
    expect(history.redo([])?.elements).toEqual([created]);
    expect(history.redo([created])?.elements).toEqual([]);
  });

  it('restores and re-deletes one ordered object group', () => {
    const history = new BoardStructureHistory();
    const first = shape('first');
    const middle = shape('middle');
    const last = shape('last');
    history.record([first, middle, last], [middle]);

    const undone = history.undo([middle]);
    expect(undone).toEqual({
      elements: [first, middle, last],
      ids: ['first', 'last'],
    });
    expect(history.canRedoSelection(['last', 'first'])).toBe(true);
    expect(history.redo(undone?.elements ?? [])).toEqual({
      elements: [middle],
      ids: ['first', 'last'],
    });
  });

  it('crosses disjoint peer work without undoing it', () => {
    const history = new BoardStructureHistory();
    const aliceShape = shape('alice');
    const bobShape = shape('bob', 40);
    history.record([], [aliceShape], 'alice');
    history.record([aliceShape], [aliceShape, bobShape], 'bob');

    expect(history.canUndo('alice')).toBe(true);
    expect(history.undo([aliceShape, bobShape], 'alice')).toEqual({
      elements: [bobShape],
      ids: ['alice'],
    });
    expect(history.canRedo('alice')).toBe(true);
    expect(history.redo([bobShape], 'alice')).toEqual({
      elements: [aliceShape, bobShape],
      ids: ['alice'],
    });
  });

  it('stops at a peer edit involving the same object', () => {
    const history = new BoardStructureHistory();
    const element = shape('shape');
    history.record([], [element], 'alice');
    history.recordBarrier('bob', ['shape']);

    expect(history.canUndo('alice')).toBe(false);
    expect(history.undo([element], 'alice')).toBeNull();
  });

  it('preserves redo through disjoint peer work but blocks conflicting work', () => {
    const history = new BoardStructureHistory();
    const aliceShape = shape('alice');
    const bobShape = shape('bob', 40);
    history.record([], [aliceShape], 'alice');
    expect(history.undo([aliceShape], 'alice')?.elements).toEqual([]);

    history.record([], [bobShape], 'bob');
    expect(history.canRedo('alice')).toBe(true);
    expect(history.redo([bobShape], 'alice')?.elements).toEqual([
      aliceShape,
      bobShape,
    ]);

    expect(history.undo([aliceShape, bobShape], 'alice')?.elements).toEqual([
      bobShape,
    ]);
    history.recordBarrier('bob', ['alice']);
    expect(history.canRedo('alice')).toBe(false);
  });

  it('keeps object edits out and permits explicit redo invalidation', () => {
    const history = new BoardStructureHistory();
    const element = shape('shape');
    const moved = { ...element, x: 20 };
    expect(history.record([element], [moved])).toBe(false);
    expect(history.undo([moved])).toBeNull();

    history.record([element], []);
    expect(history.undo([])?.elements).toEqual([element]);
    history.clearRedo();
    expect(history.redo([element])).toBeNull();
  });
});
