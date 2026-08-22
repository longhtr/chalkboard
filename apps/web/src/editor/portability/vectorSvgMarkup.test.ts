/**
 * Proves exported vector markup carries the same endpoint decoration the canvas
 * draws. An arrowhead that appears on screen but not in an export, or that
 * points the other way, is a silent divergence between the two renderers.
 */
import {
  DEFAULT_ELEMENT_STYLE,
  polylineCubicSegments,
  type FreehandElement,
  type LineElement,
  type ShapeElement,
} from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import { vectorElementSvgMarkup } from './vectorSvgMarkup';

const stroke: FreehandElement = {
  ...DEFAULT_ELEMENT_STYLE,
  createdBy: 'test',
  height: 0,
  id: 'stroke',
  opacity: 1,
  points: [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 60, y: 0 },
  ],
  rotation: 0,
  type: 'freehand',
  width: 60,
  x: 100,
  y: 50,
};

/** Counts the decoration paths that follow the stroke's own polyline. */
function arrowheadCount(markup: string): number {
  return markup.match(/<path /gu)?.length ?? 0;
}

describe('freehand vector markup', () => {
  it('emits no decoration without arrowheads', () => {
    expect(arrowheadCount(vectorElementSvgMarkup(stroke))).toBe(0);
    expect(vectorElementSvgMarkup(stroke)).toContain('<polyline');
  });

  it('decorates only the finishing end for an end arrow', () => {
    const markup = vectorElementSvgMarkup({ ...stroke, arrowheads: 'end' });

    expect(arrowheadCount(markup)).toBe(1);
    // The tip sits at the stroke's final world point, not its origin.
    expect(markup).toContain('L 160,50 L');
  });

  it('decorates both ends for a double arrow', () => {
    const markup = vectorElementSvgMarkup({ ...stroke, arrowheads: 'both' });

    expect(arrowheadCount(markup)).toBe(2);
    expect(markup).toContain('L 100,50 L');
    expect(markup).toContain('L 160,50 L');
  });

  it('omits decoration when the stroke has no usable tangent', () => {
    const markup = vectorElementSvgMarkup({
      ...stroke,
      arrowheads: 'both',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
    });

    expect(arrowheadCount(markup)).toBe(0);
  });
});

const filledSquare: ShapeElement = {
  ...DEFAULT_ELEMENT_STYLE,
  backgroundColor: '#a5d8ff',
  cornerRadius: 0,
  createdBy: 'test',
  height: 80,
  id: 'square',
  opacity: 1,
  rotation: 0,
  shapeKind: 'rectangle',
  type: 'shape',
  width: 80,
  x: 0,
  y: 0,
};

describe('shape fill markup', () => {
  it('keeps a solid fill on the shape itself', () => {
    const markup = vectorElementSvgMarkup(filledSquare);

    expect(markup).toContain('fill:#a5d8ff');
    expect(markup).not.toContain('<path');
  });

  it('replaces the solid interior with hatch lines', () => {
    const markup = vectorElementSvgMarkup({
      ...filledSquare,
      fillStyle: 'hachure',
    });

    // The outline must stop painting the interior, or the hatch would be
    // invisible on top of a solid block of the same colour.
    expect(markup).toContain('fill:none');
    expect(markup).not.toContain('fill:#a5d8ff');
    expect(markup).toContain('stroke:#a5d8ff');
    expect(markup).toContain('<path d="M ');
  });

  it('draws strictly more lines for cross-hatch than hachure', () => {
    const runs = (fillStyle: 'cross-hatch' | 'hachure') =>
      vectorElementSvgMarkup({ ...filledSquare, fillStyle }).match(/M /gu)
        ?.length ?? 0;

    // Not an exact doubling: each pass's scanline grid lands differently
    // against the rotated bounds, so the counts differ by a line or two.
    expect(runs('hachure')).toBeGreaterThan(0);
    expect(runs('cross-hatch')).toBeGreaterThan(runs('hachure'));
  });

  it('keeps exported hatching inside a rounded outline', () => {
    // A radius of half the side makes the outline a circle, so any hatch point
    // beyond the radius is markup that paints outside the shape it fills.
    const markup = vectorElementSvgMarkup({
      ...filledSquare,
      cornerRadius: 40,
      fillStyle: 'cross-hatch',
    });
    const hatch = /<path d="([^"]+)" style="fill:none;stroke:/u.exec(markup);
    const coordinates = [
      ...(hatch?.[1] ?? '').matchAll(/(-?[\d.]+),(-?[\d.]+)/gu),
    ];

    expect(coordinates.length).toBeGreaterThan(0);
    for (const [, rawX, rawY] of coordinates) {
      const distance = Math.hypot(Number(rawX) - 40, Number(rawY) - 40);
      expect(distance).toBeLessThanOrEqual(40 + 1e-6);
    }
  });

  it('emits no hatch for a transparent shape', () => {
    const markup = vectorElementSvgMarkup({
      ...filledSquare,
      backgroundColor: 'transparent',
      fillStyle: 'cross-hatch',
    });

    expect(markup).not.toContain('<path');
  });
});

describe('orthogonal line vector markup', () => {
  const vertices = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
  ];
  const orthogonal: LineElement = {
    ...DEFAULT_ELEMENT_STYLE,
    createdBy: 'test',
    height: 80,
    id: 'orthogonal',
    opacity: 1,
    pathKind: 'orthogonal',
    rotation: 0,
    segments: polylineCubicSegments(vertices, { x: 0, y: 0 }),
    type: 'line',
    width: 100,
    x: 0,
    y: 0,
  };

  it('emits sharp cubic runs when no radius is set', () => {
    const markup = vectorElementSvgMarkup(orthogonal);
    expect(markup).toContain(' C ');
    expect(markup).not.toContain(' Q ');
  });

  it('emits one quadratic arc per interior turn when rounded', () => {
    const markup = vectorElementSvgMarkup({ ...orthogonal, cornerRadius: 20 });
    // One turn, so exactly one arc, and no cubic run survives.
    expect(markup.match(/ Q /gu)).toHaveLength(1);
    expect(markup).not.toContain(' C ');
    // The export must inset the turn exactly as the canvas does.
    expect(markup).toContain('80,0');
    expect(markup).toContain('100,20');
  });

  it('ignores a radius on a path kind that does not round', () => {
    const markup = vectorElementSvgMarkup({
      ...orthogonal,
      cornerRadius: 20,
      pathKind: 'bezier',
    });
    expect(markup).not.toContain(' Q ');
  });
});
