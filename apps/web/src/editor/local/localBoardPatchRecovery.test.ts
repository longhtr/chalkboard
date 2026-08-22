/** Proves patch recovery applies once to its base and rejects stale, malformed, conflicting, or oversized edits. */
import { afterEach, describe, expect, it } from 'vitest';

import type { BoardElement } from '@chalkboard/shared';

import { requiredTestValue } from '../../test/assertions';
import {
  applyPendingLocalBoardPatch,
  cachePendingLocalBoardPatch,
  clearCommittedPendingLocalBoardPatch,
  loadPendingLocalBoardPatch,
  localPendingBoardPatchKey,
} from './localBoardPatchRecovery';

const rectangle = (id: string, x: number): BoardElement => ({
  backgroundColor: 'transparent',
  createdBy: 'test',
  height: 20,
  id,
  cornerRadius: 0,
  opacity: 1,
  rotation: 0,
  shapeKind: 'rectangle',
  strokeColor: '#000000',
  strokeStyle: 'solid',
  strokeWidth: 1,
  type: 'shape',
  width: 20,
  x,
  y: 10,
});

describe('local board patch recovery', () => {
  afterEach(() => localStorage.clear());

  it('stages and applies only changed stable-order elements', () => {
    const base = [rectangle('first', 10), rectangle('second', 20)];
    const next = [
      requiredTestValue(base[0], 'first base element'),
      { ...requiredTestValue(base[1], 'second base element'), x: 80 },
    ];

    expect(cachePendingLocalBoardPatch(base, next, 'board')).toBe(true);
    const storedPatch = requiredTestValue(
      loadPendingLocalBoardPatch('board'),
      'stored board patch',
    );
    expect(
      requiredTestValue(storedPatch.changes[0], 'stored element change')
        .acceptedBases[0],
    ).toEqual(base[1]);
    expect(applyPendingLocalBoardPatch(base, 'board')).toEqual(next);
    expect(storedPatch.changes).toHaveLength(1);
  });

  it('merges queued revisions while accepting durable intermediate states', () => {
    const original = [rectangle('element', 10)];
    const moved = [
      { ...requiredTestValue(original[0], 'original element'), x: 20 },
    ];
    const resized = [
      { ...requiredTestValue(moved[0], 'moved element'), width: 50 },
    ];

    expect(cachePendingLocalBoardPatch(original, moved, 'chain')).toBe(true);
    expect(cachePendingLocalBoardPatch(moved, resized, 'chain')).toBe(true);

    expect(applyPendingLocalBoardPatch(original, 'chain')).toEqual(resized);
    expect(applyPendingLocalBoardPatch(moved, 'chain')).toEqual(resized);
    const chainedPatch = requiredTestValue(
      loadPendingLocalBoardPatch('chain'),
      'chained board patch',
    );
    expect(
      requiredTestValue(chainedPatch.changes[0], 'chained element change')
        .acceptedBases,
    ).toHaveLength(2);
  });

  it('rejects stale, reordered, added, and oversized patches', () => {
    const base = [rectangle('first', 10), rectangle('second', 20)];
    const first = requiredTestValue(base[0], 'first base element');
    const second = requiredTestValue(base[1], 'second base element');
    const next = [{ ...first, x: 30 }, second];
    expect(cachePendingLocalBoardPatch(base, next, 'stale')).toBe(true);
    const unrelated = [rectangle('first', 999), second];
    expect(applyPendingLocalBoardPatch(unrelated, 'stale')).toBe(unrelated);

    expect(
      cachePendingLocalBoardPatch(base, [second, first], 'reordered'),
    ).toBe(false);
    expect(
      cachePendingLocalBoardPatch(
        base,
        [...base, rectangle('third', 30)],
        'added',
      ),
    ).toBe(false);
    const many = Array.from({ length: 33 }, (_, index) =>
      rectangle(`element-${index}`, index),
    );
    expect(
      cachePendingLocalBoardPatch(
        many,
        many.map((element) => ({ ...element, x: element.x + 1 })),
        'many',
      ),
    ).toBe(false);
  });

  it('clears only after the final patch state is durable', () => {
    const original = [rectangle('element', 10)];
    const moved = [
      { ...requiredTestValue(original[0], 'original element'), x: 20 },
    ];
    const final = [
      { ...requiredTestValue(moved[0], 'moved element'), width: 50 },
    ];
    cachePendingLocalBoardPatch(original, moved, 'clear');
    cachePendingLocalBoardPatch(moved, final, 'clear');

    clearCommittedPendingLocalBoardPatch(moved, 'clear');
    expect(
      localStorage.getItem(localPendingBoardPatchKey('clear')),
    ).not.toBeNull();
    clearCommittedPendingLocalBoardPatch(final, 'clear');
    expect(localStorage.getItem(localPendingBoardPatchKey('clear'))).toBeNull();
  });

  it('removes malformed patches before recovery', () => {
    localStorage.setItem(
      localPendingBoardPatchKey('malformed'),
      JSON.stringify({ changes: [], elementCount: 1, version: 1 }),
    );

    expect(loadPendingLocalBoardPatch('malformed')).toBeNull();
    expect(
      localStorage.getItem(localPendingBoardPatchKey('malformed')),
    ).toBeNull();
  });
});
