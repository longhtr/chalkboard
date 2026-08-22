/**
 * Element content must compare independently of property order. A locally built
 * element and the same element read back from Yjs carry their keys in different
 * orders; treating that as a difference turns the publication effect — which
 * re-runs on every acknowledgement — into an unbounded publish/acknowledge loop.
 */
import type { BoardElement } from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import { boardContentEqual } from './boardContentEqual';

function equation(source: string): BoardElement {
  return {
    backgroundColor: 'transparent',
    createdBy: 'test',
    fontSize: 25,
    height: 40,
    id: 'e1',
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
  } as BoardElement;
}

/** Same content, keys inserted in the reverse order a Yjs read would produce. */
function reordered(element: BoardElement): BoardElement {
  const entries = Object.entries(element).reverse();
  return Object.fromEntries(entries) as BoardElement;
}

describe('boardContentEqual', () => {
  it('treats identical content as equal regardless of key order', () => {
    const local = equation('abc');
    expect(
      boardContentEqual(
        { elements: [local], title: 'Board' },
        [reordered(local)],
        'Board',
      ),
    ).toBe(true);
  });

  it('still detects a genuine content change', () => {
    expect(
      boardContentEqual(
        { elements: [equation('abc')], title: 'Board' },
        [equation('abcd')],
        'Board',
      ),
    ).toBe(false);
  });

  it('detects a title change', () => {
    const local = equation('abc');
    expect(
      boardContentEqual(
        { elements: [local], title: 'Board' },
        [local],
        'Other',
      ),
    ).toBe(false);
  });

  it('detects added and removed elements', () => {
    const local = equation('abc');
    expect(boardContentEqual({ elements: [local], title: 'B' }, [], 'B')).toBe(
      false,
    );
  });
});
