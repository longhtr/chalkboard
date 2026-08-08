/**
 * Covers the sampled-stroke tangent that positions freehand arrowheads. Pointer
 * sampling repeats points where a stroke starts and stops, so the interesting
 * cases are degenerate rather than typical.
 */
import { describe, expect, it } from 'vitest';

import { strokeEndDirection } from './curveGeometry.js';

describe('stroke end direction', () => {
  it('points outward from each end of a simple stroke', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];

    expect(strokeEndDirection(points, false)).toEqual({ x: -10, y: 0 });
    expect(strokeEndDirection(points, true)).toEqual({ x: 10, y: 0 });
  });

  it('walks past repeated points at the tip', () => {
    const points = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 25 },
    ];

    expect(strokeEndDirection(points, false)).toEqual({ x: 0, y: -20 });
  });

  it('reports no direction when every point coincides', () => {
    const points = [
      { x: 3, y: 3 },
      { x: 3, y: 3 },
    ];

    expect(strokeEndDirection(points, false)).toBeNull();
    expect(strokeEndDirection(points, true)).toBeNull();
  });

  it('reports no direction for an empty or single-point stroke', () => {
    expect(strokeEndDirection([], false)).toBeNull();
    expect(strokeEndDirection([{ x: 1, y: 1 }], true)).toBeNull();
  });
});
