/** Proves title normalization supplies the default, trims space, and truncates by Unicode scalar. */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BOARD_TITLE,
  MAX_BOARD_TITLE_LENGTH,
  copiedBoardTitle,
  normalizedBoardTitle,
} from './boardTitle';

describe('board titles', () => {
  it('normalizes empty, padded, and over-limit titles', () => {
    expect(normalizedBoardTitle('   ')).toBe(DEFAULT_BOARD_TITLE);
    expect(normalizedBoardTitle('  Analysis  ')).toBe('Analysis');
    expect(normalizedBoardTitle('x'.repeat(MAX_BOARD_TITLE_LENGTH + 1))).toBe(
      'x'.repeat(MAX_BOARD_TITLE_LENGTH),
    );
    expect(normalizedBoardTitle('😀'.repeat(MAX_BOARD_TITLE_LENGTH + 1))).toBe(
      '😀'.repeat(MAX_BOARD_TITLE_LENGTH),
    );
  });

  it('reserves suffix capacity when naming a duplicate', () => {
    const copied = copiedBoardTitle('x'.repeat(MAX_BOARD_TITLE_LENGTH));

    expect(copied).toHaveLength(MAX_BOARD_TITLE_LENGTH);
    expect(copied).toBe(
      `Copy of ${'x'.repeat(MAX_BOARD_TITLE_LENGTH - 'Copy of '.length)}`,
    );
    expect(copiedBoardTitle('  ')).toBe(`${DEFAULT_BOARD_TITLE} copy`);
  });
});
