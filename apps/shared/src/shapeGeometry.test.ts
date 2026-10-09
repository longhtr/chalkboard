/** Proves every polygonal shape receives one canonical world-space outline. */
import { describe, expect, it } from 'vitest';

import {
  ellipseArcPoints,
  ellipseArcSweep,
  normalizedEllipseArc,
  shapePolygonPoints,
} from './shapeGeometry.js';

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

describe('ellipse arcs', () => {
  it('samples only the clockwise half-ellipse circumference', () => {
    const points = ellipseArcPoints(bounds, normalizedEllipseArc(0, 180));

    expect(points[0]).toEqual({ x: 210, y: 70 });
    expect(points.at(-1)?.x).toBeCloseTo(10);
    expect(points.at(-1)?.y).toBeCloseTo(70);
    expect(points.every(({ y }) => y >= 70 - 1e-9)).toBe(true);
  });

  it('keeps endpoints bounded while allowing clockwise wrap-around', () => {
    expect(normalizedEllipseArc(-20, 900)).toEqual({
      endAngle: 360,
      startAngle: 0,
    });
    expect(normalizedEllipseArc(300, 200)).toEqual({
      endAngle: 200,
      startAngle: 300,
    });
    expect(ellipseArcSweep(normalizedEllipseArc(300, 60))).toBe(120);
    expect(ellipseArcSweep(normalizedEllipseArc(60, 300))).toBe(240);
    expect(normalizedEllipseArc(300, 300)).toEqual({
      endAngle: 301,
      startAngle: 300,
    });
  });
});
