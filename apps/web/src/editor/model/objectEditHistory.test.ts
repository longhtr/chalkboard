/** Object-local edit, transaction, ordering, branching, and bounds history. */
import type { BoardElement } from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import {
  OBJECT_EDIT_HISTORY_LIMIT,
  ObjectEditHistory,
} from './objectEditHistory';

function shape(id: string, x: number): BoardElement {
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

describe('object edit history', () => {
  it('uses creation as the base rather than an object-local edit', () => {
    const history = new ObjectEditHistory();
    const first = shape('first', 0);
    const second = shape('second', 100);
    history.record([], [first, second]);

    expect(history.canStep(['first'], -1, [first, second])).toBe(false);
    expect(history.step(['first'], -1, [first, second])).toBeNull();
  });

  it('does not treat a pre-existing selected object as locally created', () => {
    const history = new ObjectEditHistory();
    const existing = shape('existing', 0);

    expect(history.canStep(['existing'], -1, [existing])).toBe(false);
    expect(history.step(['existing'], -1, [existing])).toBeNull();
  });

  it('edits only the targeted object after creation', () => {
    const history = new ObjectEditHistory();
    const first = shape('first', 0);
    const second = shape('second', 100);
    history.record([], [first, second]);
    const movedFirst = { ...first, x: 20 };
    history.record([first, second], [movedFirst, second]);

    expect(history.step(['first'], -1, [movedFirst, second])).toEqual([
      first,
      second,
    ]);
    expect(history.step(['first'], 1, [first, second])).toEqual([
      movedFirst,
      second,
    ]);
  });

  it('undoes only the latest transaction represented in a mixed selection', () => {
    const history = new ObjectEditHistory();
    const first = shape('first', 0);
    const second = shape('second', 100);
    history.record([], [first, second]);
    const movedFirst = { ...first, x: 10 };
    const movedSecond = { ...second, x: 110 };
    const bothMoved: BoardElement[] = [movedFirst, movedSecond];
    history.record([first, second], bothMoved);
    const firstMovedAgain: BoardElement[] = [
      { ...movedFirst, x: 20 },
      movedSecond,
    ];
    history.record(bothMoved, firstMovedAgain);

    expect(history.step(['first', 'second'], -1, firstMovedAgain)).toEqual(
      bothMoved,
    );
    expect(history.step(['first', 'second'], -1, bothMoved)).toEqual([
      first,
      second,
    ]);
  });

  it('does not let one actor undo another actor’s object edit', () => {
    const history = new ObjectEditHistory();
    const initial = shape('shape', 0);
    const edited = { ...initial, x: 20 };
    history.record([], [initial], 'alice');
    history.record([initial], [edited], 'alice');

    expect(history.canStep(['shape'], -1, [edited], 'bob')).toBe(false);
    expect(history.step(['shape'], -1, [edited], 'alice')).toEqual([initial]);
  });

  it('discards stale object redo when deletion creates a new branch', () => {
    const history = new ObjectEditHistory();
    const initial = shape('shape', 0);
    const edited = { ...initial, x: 20 };
    history.record([], [initial]);
    history.record([initial], [edited]);
    expect(history.step(['shape'], -1, [edited])).toEqual([initial]);

    history.record([initial], []);

    expect(history.canStep(['shape'], 1, [])).toBe(false);
    expect(history.canStep(['shape'], 1, [initial])).toBe(false);
  });

  it('stops when the next transaction belongs to another actor', () => {
    const history = new ObjectEditHistory();
    const initial = shape('shape', 0);
    const aliceEdit = { ...initial, x: 10 };
    const bobEdit = { ...aliceEdit, x: 20 };
    history.record([], [initial], 'alice');
    history.record([initial], [aliceEdit], 'alice');
    history.record([aliceEdit], [bobEdit], 'bob');

    expect(history.canStep(['shape'], -1, [bobEdit], 'alice')).toBe(false);
    expect(history.step(['shape'], -1, [bobEdit], 'bob')).toEqual([aliceEdit]);
    expect(history.canStep(['shape'], -1, [aliceEdit], 'bob')).toBe(false);
    expect(history.canStep(['shape'], -1, [aliceEdit], 'alice')).toBe(true);
  });

  it('keeps mixed-block history through presentation-only measurement', () => {
    const history = new ObjectEditHistory();
    const initial: BoardElement = {
      backgroundColor: 'transparent',
      createdBy: 'local',
      fontSize: 25,
      height: 30,
      id: 'text',
      opacity: 1,
      rotation: 0,
      source: 'Text',
      strokeColor: '#111111',
      strokeWidth: 2,
      type: 'equation',
      width: 50,
      x: 0,
      y: 0,
    };
    const resized = { ...initial, fontSize: 40 };
    history.record([], [initial]);
    history.record([initial], [resized]);
    const measured = { ...resized, height: 48, width: 82 };

    expect(history.canStep(['text'], -1, [measured])).toBe(true);
    expect(history.step(['text'], -1, [measured])?.[0]).toMatchObject({
      fontSize: 25,
    });
  });

  it('restores layer order as an object edit', () => {
    const history = new ObjectEditHistory();
    const first = shape('first', 0);
    const second = shape('second', 100);
    history.record([], [first, second]);
    history.record([first, second], [second, first]);

    expect(history.step(['first'], -1, [second, first])).toEqual([
      first,
      second,
    ]);
    expect(history.step(['first'], 1, [first, second])).toEqual([
      second,
      first,
    ]);
  });

  it('bounds each object to one hundred undoable edits', () => {
    const history = new ObjectEditHistory();
    let current = shape('shape', 0);
    history.record([], [current]);
    for (let index = 1; index <= 150; index += 1) {
      const next = { ...current, x: index };
      history.record([current], [next]);
      current = next;
    }
    let elements: BoardElement[] = [current];
    for (let index = 0; index < OBJECT_EDIT_HISTORY_LIMIT; index += 1) {
      elements = history.step(['shape'], -1, elements) ?? elements;
    }
    expect(elements[0]?.x).toBe(50);
    expect(history.step(['shape'], -1, elements)).toBeNull();
  });
});
