/** Checks board cardinality admission at the exact accepted and rejected boundaries. */
import { describe, expect, it } from 'vitest';

import {
  MAX_BOARD_ELEMENTS,
  boardElementAdditionFits,
  boardElementChangeFits,
} from './limits';

describe('board element limits', () => {
  it('accepts the declared boundary and rejects an atomic overflow', () => {
    expect(boardElementAdditionFits(MAX_BOARD_ELEMENTS - 100, 100)).toBe(true);
    expect(boardElementAdditionFits(MAX_BOARD_ELEMENTS - 100, 101)).toBe(false);
    expect(
      boardElementChangeFits(MAX_BOARD_ELEMENTS, MAX_BOARD_ELEMENTS + 1),
    ).toBe(false);
  });

  it('allows historical over-limit data only to move toward the boundary', () => {
    expect(
      boardElementChangeFits(MAX_BOARD_ELEMENTS + 2, MAX_BOARD_ELEMENTS + 1),
    ).toBe(true);
    expect(
      boardElementChangeFits(MAX_BOARD_ELEMENTS + 1, MAX_BOARD_ELEMENTS + 1),
    ).toBe(false);
    expect(
      boardElementChangeFits(MAX_BOARD_ELEMENTS + 1, MAX_BOARD_ELEMENTS),
    ).toBe(true);
  });

  it('rejects invalid operation counts', () => {
    expect(boardElementAdditionFits(-1, 1)).toBe(false);
    expect(boardElementAdditionFits(0, -1)).toBe(false);
    expect(boardElementAdditionFits(0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(boardElementChangeFits(-1, 0)).toBe(false);
    expect(boardElementChangeFits(0, Number.NaN)).toBe(false);
  });
});
