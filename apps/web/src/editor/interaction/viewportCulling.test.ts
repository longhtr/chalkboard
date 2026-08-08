/** Checks world viewport conversion and conservative culling across zoom, rotation, paths, and padding. */
import { DEFAULT_ELEMENT_STYLE, type BoardElement } from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import {
  elementIntersectsViewport,
  worldViewportBounds,
} from './viewportCulling';

const rectangle = (x: number, y: number): BoardElement => ({
  ...DEFAULT_ELEMENT_STYLE,
  createdBy: 'test',
  height: 50,
  id: `${x}:${y}`,
  rotation: 0,
  type: 'rectangle',
  width: 100,
  x,
  y,
});

describe('viewport culling', () => {
  it('converts the screen viewport and margin to world-space bounds', () => {
    expect(
      worldViewportBounds(
        { x: 100, y: 50, zoom: 2 },
        { height: 600, width: 800 },
        20,
      ),
    ).toEqual({ height: 320, width: 420, x: -60, y: -35 });
  });

  it('keeps intersecting and near-margin elements while rejecting distant work', () => {
    const camera = { x: 400, y: 300, zoom: 1 };
    const viewport = { height: 600, width: 800 };

    expect(
      elementIntersectsViewport(rectangle(-50, -25), camera, viewport),
    ).toBe(true);
    expect(
      elementIntersectsViewport(rectangle(410, -25), camera, viewport),
    ).toBe(false);
    expect(
      elementIntersectsViewport(rectangle(410, -25), camera, viewport, 20),
    ).toBe(true);
    expect(
      elementIntersectsViewport(
        rectangle(10_000, 10_000),
        camera,
        viewport,
        200,
      ),
    ).toBe(false);
  });

  it('uses full Bézier geometry rather than only line endpoints', () => {
    const line: BoardElement = {
      ...DEFAULT_ELEMENT_STYLE,
      arrowheads: 'none',
      createdBy: 'test',
      height: 0,
      id: 'curve',
      pathKind: 'bezier',
      rotation: 0,
      segments: [
        {
          control1: { x: 700, y: 100 },
          control2: { x: 700, y: 100 },
          end: { x: 100, y: 0 },
        },
      ],
      type: 'line',
      width: 100,
      x: -700,
      y: 0,
    };

    expect(
      elementIntersectsViewport(
        line,
        { x: 400, y: 300, zoom: 1 },
        { height: 600, width: 800 },
      ),
    ).toBe(true);
  });
});
