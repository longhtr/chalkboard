import { describe, expect, it } from 'vitest';

import { adjustedLineSpacing, adjustedTextSize } from './textAdjustments';

describe('text adjustment bounds', () => {
  it('permits and clamps the expanded upper limits', () => {
    expect(adjustedTextSize(199, 1)).toBe(200);
    expect(adjustedTextSize(200, 1)).toBe(200);
    expect(adjustedLineSpacing(4.9, 1)).toBe(5);
    expect(adjustedLineSpacing(5, 1)).toBe(5);
  });
});
