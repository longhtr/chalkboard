/**
 * Proves board presence — not the session's creation flag — decides whether an
 * edit inserts or updates, so streaming a new block cannot duplicate it.
 */
import type { BoardElement, EquationElement } from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import { applyEquationEdit, type EditingEquation } from './equationEditing';

function equation(id: string, source: string): EquationElement {
  return {
    backgroundColor: 'transparent',
    createdBy: 'test',
    fontSize: 25,
    height: 40,
    id,
    lineSpacing: 1.2,
    opacity: 1,
    rotation: 0,
    source,
    strokeColor: '#111827',
    strokeWidth: 2,
    type: 'equation',
    width: 180,
    x: 10,
    y: 20,
  };
}

function session(overrides: Partial<EditingEquation> = {}): EditingEquation {
  return {
    draft: equation('e1', ''),
    height: 40,
    id: 'e1',
    initialSource: '',
    isNew: true,
    sessionId: 's1',
    source: '',
    width: 180,
    ...overrides,
  };
}

/** Mirrors the caller: a block absent from the board is inserted, never re-added. */
const applyByPresence = (
  elements: BoardElement[],
  editing: EditingEquation,
  result: { height: number; source: string; width: number },
): BoardElement[] =>
  applyEquationEdit(
    elements,
    { ...editing, isNew: !elements.some(({ id }) => id === editing.id) },
    result,
  );

describe('applyEquationEdit driven by board presence', () => {
  it('inserts a new block on its first keystroke', () => {
    const next = applyByPresence([], session(), {
      height: 40,
      source: 'a',
      width: 180,
    });

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: 'e1', source: 'a' });
  });

  it('updates in place across a stream of keystrokes without duplicating', () => {
    let elements: BoardElement[] = [];
    for (const source of ['a', 'ab', 'abc', 'abcd']) {
      elements = applyByPresence(elements, session({ source }), {
        height: 40,
        source,
        width: 180,
      });
    }

    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({ id: 'e1', source: 'abcd' });
  });

  it('does not add a second copy when the session finally commits', () => {
    const typed = applyByPresence([], session(), {
      height: 40,
      source: 'abc',
      width: 180,
    });
    // The session still reports isNew; only board presence may decide.
    const committed = applyByPresence(typed, session({ source: 'abc' }), {
      height: 40,
      source: 'abc',
      width: 180,
    });

    expect(committed).toHaveLength(1);
  });

  it('re-inserts a block that was emptied and then retyped', () => {
    const typed = applyByPresence([], session(), {
      height: 40,
      source: 'abc',
      width: 180,
    });
    const emptied = applyByPresence(typed, session({ isNew: false }), {
      height: 40,
      source: '',
      width: 180,
    });
    expect(emptied).toHaveLength(0);

    const retyped = applyByPresence(emptied, session({ isNew: false }), {
      height: 40,
      source: 'z',
      width: 180,
    });
    expect(retyped).toHaveLength(1);
    expect(retyped[0]).toMatchObject({ id: 'e1', source: 'z' });
  });

  it('still discards a block that was never given any content', () => {
    const next = applyByPresence([], session(), {
      height: 40,
      source: '',
      width: 180,
    });

    expect(next).toEqual([]);
  });

  it('leaves other elements untouched', () => {
    const other = equation('other', 'keep');
    const next = applyByPresence([other], session(), {
      height: 40,
      source: 'a',
      width: 180,
    });

    expect(next).toHaveLength(2);
    expect(next.find(({ id }) => id === 'other')).toBe(other);
  });
});
