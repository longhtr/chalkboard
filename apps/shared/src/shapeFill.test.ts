/**
 * Covers the scanline that produces shape fill patterns. The failure modes are
 * geometric rather than typical: a shared vertex counted twice inverts inside
 * and outside, and a concave shape must not be hatched across its notch.
 */
import { describe, expect, it } from 'vitest';

import {
  hatchSegments,
  MAX_SHAPE_FILL_SPACING,
  MIN_SHAPE_FILL_SPACING,
  roundedPolygonCorners,
  SHAPE_HATCH_SPACING,
  shapeFillPolygon,
  shapeFillSegments,
  shapeHatchSpacing,
  shapeHatchStrokeWidth,
} from './shapeGeometry.js';

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('shape fill geometry', () => {
  it('spans a square with evenly spaced horizontal lines', () => {
    const segments = hatchSegments(square, 0, 20);

    expect(segments.length).toBeGreaterThan(3);
    for (const [start, end] of segments) {
      expect(start.x).toBeCloseTo(0);
      expect(end.x).toBeCloseTo(100);
      expect(start.y).toBeCloseTo(end.y);
    }
    const spacings = segments
      .slice(1)
      .map(([start], index) => start.y - (segments[index]?.[0].y ?? 0));
    for (const spacing of spacings) expect(spacing).toBeCloseTo(20);
  });

  it('leaves the notch of a concave shape unhatched', () => {
    // A C-shape: a scanline through the opening must produce two runs, not one
    // spanning the gap.
    const cShape = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 80 },
      { x: 100, y: 80 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const throughNotch = hatchSegments(cShape, 0, 10).filter(
      ([start]) => start.y > 20 && start.y < 80,
    );

    expect(throughNotch.length).toBeGreaterThan(0);
    for (const [start, end] of throughNotch) {
      expect(start.x).toBeCloseTo(0);
      expect(end.x).toBeCloseTo(40);
    }
  });

  it('keeps every hatch line inside the polygon', () => {
    const triangle = [
      { x: 50, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];

    for (const [start, end] of hatchSegments(triangle, Math.PI / 4, 6)) {
      for (const point of [start, end]) {
        expect(point.y).toBeGreaterThanOrEqual(-1e-6);
        expect(point.y).toBeLessThanOrEqual(100 + 1e-6);
        // Triangle half-width grows with depth; allow the boundary itself.
        const halfWidth = (point.y / 100) * 50;
        expect(Math.abs(point.x - 50)).toBeLessThanOrEqual(halfWidth + 1e-6);
      }
    }
  });

  it('gives cross-hatch both passes and solid none', () => {
    const hachure = shapeFillSegments(square, 'hachure');
    const crossHatch = shapeFillSegments(square, 'cross-hatch');

    expect(shapeFillSegments(square, 'solid')).toEqual([]);
    expect(hachure.length).toBeGreaterThan(0);
    // Cross-hatch is the hachure pass plus a perpendicular one. The two passes
    // need not have equal counts: each scanline grid lands differently against
    // the rotated bounds, so asserting an exact doubling would be a size-
    // dependent coincidence rather than the contract.
    expect(crossHatch.slice(0, hachure.length)).toEqual(hachure);
    expect(crossHatch.length).toBeGreaterThan(hachure.length);
  });

  it('packs more lines in as the gap narrows', () => {
    const counts = [64, 16, MIN_SHAPE_FILL_SPACING].map(
      (spacing) => shapeFillSegments(square, 'hachure', spacing).length,
    );

    expect(counts[0]).toBeLessThan(counts[1] ?? 0);
    expect(counts[1]).toBeLessThan(counts[2] ?? 0);
  });

  it('spaces lines by the requested world-space gap', () => {
    // The control reports a real distance, not an index: adjacent lines must
    // sit exactly that far apart.
    const segments = hatchSegments(square, 0, 12);
    const gaps = segments
      .slice(1)
      .map(([start], index) => start.y - (segments[index]?.[0].y ?? 0));

    for (const gap of gaps) expect(gap).toBeCloseTo(12);
  });

  it('clamps the gap instead of emitting an unusable one', () => {
    expect(shapeHatchSpacing(1_000)).toBe(MAX_SHAPE_FILL_SPACING);
    expect(shapeHatchSpacing(-5)).toBe(MIN_SHAPE_FILL_SPACING);
    expect(shapeHatchSpacing(0)).toBe(MIN_SHAPE_FILL_SPACING);
    expect(shapeHatchSpacing(Number.NaN)).toBe(SHAPE_HATCH_SPACING);
    expect(shapeHatchSpacing(undefined)).toBe(SHAPE_HATCH_SPACING);
  });

  it('caps density so the tightest fill is never solid ink', () => {
    // A hatch line as wide as the gap between lines leaves no background
    // showing, which is why the gap has a floor.
    expect(MIN_SHAPE_FILL_SPACING).toBeGreaterThan(shapeHatchStrokeWidth(2));
  });

  it('matches hatch weight to the outline weight', () => {
    expect(shapeHatchStrokeWidth(1)).toBe(1);
    expect(shapeHatchStrokeWidth(2)).toBe(2);
    expect(shapeHatchStrokeWidth(8)).toBe(2);
  });

  it('rejects degenerate polygons and spacing instead of looping', () => {
    expect(hatchSegments(square, 0, 0)).toEqual([]);
    expect(hatchSegments(square, 0, -5)).toEqual([]);
    expect(hatchSegments([{ x: 0, y: 0 }], 0, 10)).toEqual([]);
  });

  it('bounds the work for a huge shape at the default spacing', () => {
    const enormous = [
      { x: 0, y: 0 },
      { x: 1e6, y: 0 },
      { x: 1e6, y: 1e6 },
      { x: 0, y: 1e6 },
    ];

    expect(
      hatchSegments(enormous, 0, SHAPE_HATCH_SPACING).length,
    ).toBeLessThanOrEqual(2_048);
  });

  it('keeps hatching inside a rounded rectangle', () => {
    // A radius of half the side collapses the outline to a circle, which makes
    // any overflow unambiguous: every hatch endpoint must be within the radius.
    const bounds = { height: 200, width: 200, x: 0, y: 0 };
    const segments = shapeFillSegments(
      shapeFillPolygon('rectangle', bounds, { cornerRadius: 100 }),
      'cross-hatch',
    );

    expect(segments.length).toBeGreaterThan(0);
    for (const [start, end] of segments) {
      for (const point of [start, end]) {
        expect(Math.hypot(point.x - 100, point.y - 100)).toBeLessThanOrEqual(
          100 + 1e-6,
        );
      }
    }
  });

  it('rounds polygon corners inward when filling', () => {
    const bounds = { height: 100, width: 100, x: 0, y: 0 };
    const sharp = shapeFillPolygon('triangle', bounds);
    const rounded = shapeFillPolygon('triangle', bounds, { cornerRadius: 20 });

    expect(rounded.length).toBeGreaterThan(sharp.length);
    // Rounding only removes area, so no sampled vertex may sit outside the
    // sharp triangle's edges.
    for (const point of rounded) {
      expect(point.y).toBeLessThanOrEqual(100 + 1e-6);
      const halfWidth = (point.y / 100) * 50;
      expect(Math.abs(point.x - 50)).toBeLessThanOrEqual(halfWidth + 1e-6);
    }
  });

  it('caps corner rounding at half of the shortest adjacent edge', () => {
    // The radius exceeds the edge length, so neighbouring corners would overrun
    // each other were the inset not clamped.
    const [corner] = roundedPolygonCorners(square, 500);

    expect(corner?.entry).toEqual({ x: 0, y: 50 });
    expect(corner?.exit).toEqual({ x: 50, y: 0 });
    expect(corner?.vertex).toEqual({ x: 0, y: 0 });
  });

  it('encloses a rectangle and an ellipse for filling', () => {
    const bounds = { height: 40, width: 80, x: 10, y: 20 };

    expect(shapeFillPolygon('rectangle', bounds)).toEqual([
      { x: 10, y: 20 },
      { x: 90, y: 20 },
      { x: 90, y: 60 },
      { x: 10, y: 60 },
    ]);
    expect(shapeFillPolygon('ellipse', bounds).length).toBeGreaterThan(16);
  });
});
