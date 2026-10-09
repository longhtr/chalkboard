/** Proves board-title limits count Unicode scalars without splitting surrogate pairs. */
import { describe, expect, it } from 'vitest';

import {
  MAX_BOARD_TITLE_LENGTH,
  truncateBoardTitle,
  unicodeScalarLength,
} from './boardContract';

describe('board contract', () => {
  it('counts complete Unicode scalar values for title admission', () => {
    expect(MAX_BOARD_TITLE_LENGTH).toBe(160);
    expect(unicodeScalarLength('A😀')).toBe(2);
    expect(truncateBoardTitle('😀'.repeat(161))).toBe('😀'.repeat(160));
  });
});
