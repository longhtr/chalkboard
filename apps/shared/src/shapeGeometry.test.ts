/** Proves every polygonal shape receives one canonical world-space outline. */
import { describe, expect, it } from 'vitest';

import { shapePolygonPoints } from './shapeGeometry.js';

const bounds = { height: 100, width: 200, x: 10, y: 20 };

describe('canonical shape polygons', () => {
  it('returns exact triangle and hexagon vertices', () => {
    expect(shapePolygonPoints('triangle', bounds)).toEqual([
      { x: 110, y: 20 },
      { x: 210, y: 120 },
      { x: 10, y: 120 },
    ]);
    expect(shapePolygonPoints('hexagon', bounds)).toEqual([
      { x: 60, y: 20 },
      { x: 160, y: 20 },
      { x: 210, y: 70 },
      { x: 160, y: 120 },
      { x: 60, y: 120 },
      { x: 10, y: 70 },
    ]);
  });

  it('uses persisted trapezoid ratios and rejects non-polygonal shapes', () => {
    expect(
      shapePolygonPoints('trapezoid', bounds, {
        trapezoidTopLeft: 0.3,
        trapezoidTopRight: 0.7,
      }),
    ).toEqual([
      { x: 70, y: 20 },
      { x: 150, y: 20 },
      { x: 210, y: 120 },
      { x: 10, y: 120 },
    ]);
    expect(shapePolygonPoints('ellipse', bounds)).toBeNull();
    expect(shapePolygonPoints('rectangle', bounds)).toBeNull();
  });
});
