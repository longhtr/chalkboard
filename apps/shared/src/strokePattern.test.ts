import { describe, expect, it } from 'vitest';

import { strokeDashGap, strokeDashPattern } from './strokePattern.js';

const base = {
  strokeStyle: 'solid' as const,
  strokeWidth: 2,
};

describe('stroke dash patterns', () => {
  it('preserves the legacy defaults when no custom gap is stored', () => {
    expect(strokeDashPattern({ ...base, strokeStyle: 'dashed' })).toEqual([
      8, 6,
    ]);
    expect(strokeDashPattern({ ...base, strokeStyle: 'dotted' })).toEqual([
      1, 5,
    ]);
  });

  it('shares an explicit bounded gap across dotted and dashed styles', () => {
    expect(
      strokeDashPattern({
        ...base,
        strokeDashGap: 17,
        strokeStyle: 'dashed',
      }),
    ).toEqual([8, 17]);
    expect(
      strokeDashPattern({
        ...base,
        strokeDashGap: 17,
        strokeStyle: 'dotted',
      }),
    ).toEqual([1, 17]);
    expect(strokeDashGap({ ...base, strokeDashGap: -4 })).toBe(1);
    expect(strokeDashGap({ ...base, strokeDashGap: 4_000 })).toBe(100);
  });

  it('uses no pattern for solid strokes even if a dormant gap is retained', () => {
    expect(strokeDashPattern({ ...base, strokeDashGap: 17 })).toEqual([]);
  });
});
