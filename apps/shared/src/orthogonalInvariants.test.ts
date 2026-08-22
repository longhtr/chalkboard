/** Proves fitted orthogonal paths remain axis-aligned, bounded, stable, and free of zero-length segments. */
import { describe, expect, it } from 'vitest';
import { fitOrthogonalSegments, moveOrthogonalVertex } from './geometry.js';
import { roundedPolylineCorners } from './shapeGeometry.js';
import { requiredTestValue } from './testAssertions.js';

describe('orthogonal fitter invariant review', () => {
  it('preserves invariants across varied sampled strokes', () => {
    let seed = 0x12345678;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let trial = 0; trial < 200; trial += 1) {
      const points = [{ x: 0, y: 0 }];
      for (let index = 1; index < 40; index += 1) {
        const previous = requiredTestValue(
          points[index - 1],
          'previous generated point',
        );
        points.push({
          x: previous.x + (random() - 0.45) * 30,
          y: previous.y + (random() - 0.45) * 30,
        });
      }
      const segments = fitOrthogonalSegments(points, 12);
      expect(segments.length).toBeGreaterThan(0);
      let previous = { x: 0, y: 0 };
      let previousOrientation: 'horizontal' | 'vertical' | null = null;
      const vertices = [previous];
      for (const segment of segments) {
        const horizontal =
          previous.y === segment.control1.y &&
          previous.y === segment.control2.y &&
          previous.y === segment.end.y;
        const vertical =
          previous.x === segment.control1.x &&
          previous.x === segment.control2.x &&
          previous.x === segment.end.x;
        expect(
          horizontal || vertical,
          JSON.stringify({
            points,
            previous,
            segment,
            segments,
            trial,
          }),
        ).toBe(true);
        const orientation = horizontal ? 'horizontal' : 'vertical';
        expect(orientation).not.toBe(previousOrientation);
        previousOrientation = orientation;
        previous = segment.end;
        vertices.push(previous);
      }
      const horizontalExtent = Math.max(
        12,
        Math.max(...vertices.map(({ x }) => x)) -
          Math.min(...vertices.map(({ x }) => x)),
      );
      const verticalExtent = Math.max(
        12,
        Math.max(...vertices.map(({ y }) => y)) -
          Math.min(...vertices.map(({ y }) => y)),
      );
      const normalizedLengths = segments.map((segment, index) => {
        const start = vertices[index] ?? { x: 0, y: 0 };
        return segment.end.y === start.y
          ? Math.abs(segment.end.x - start.x) / horizontalExtent
          : Math.abs(segment.end.y - start.y) / verticalExtent;
      });
      expect(Math.min(...normalizedLengths) + 1e-9).toBeGreaterThanOrEqual(
        Math.max(...normalizedLengths) / 5,
      );
    }
  });
});

describe('orthogonal vertex dragging', () => {
  it('pulls each neighbour along the coordinate its run shares', () => {
    // A right-then-down elbow: the corner owns a horizontal run to its left and
    // a vertical run below it.
    const vertices = [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 70 },
    ];
    expect(moveOrthogonalVertex(vertices, 1, { x: 150, y: 60 })).toEqual([
      { x: 10, y: 60 },
      { x: 150, y: 60 },
      { x: 150, y: 70 },
    ]);
  });

  it('moves only the one reachable neighbour when an endpoint is dragged', () => {
    const vertices = [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 70 },
    ];
    expect(moveOrthogonalVertex(vertices, 0, { x: 0, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 110, y: 0 },
      { x: 110, y: 70 },
    ]);
  });

  it('keeps every run axis-aligned and the vertex count stable', () => {
    let seed = 0x9e3779b9;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const vertices = [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 45 },
      { x: 160, y: 45 },
      { x: 160, y: 120 },
    ];
    for (let trial = 0; trial < 400; trial += 1) {
      const index = Math.floor(random() * vertices.length);
      const moved = moveOrthogonalVertex(vertices, index, {
        x: (random() - 0.5) * 500,
        y: (random() - 0.5) * 500,
      });
      expect(moved).toHaveLength(vertices.length);
      for (let step = 1; step < moved.length; step += 1) {
        const start = requiredTestValue(moved[step - 1], 'run start');
        const end = requiredTestValue(moved[step], 'run end');
        const axisAligned =
          Math.abs(start.x - end.x) <= 1e-6 ||
          Math.abs(start.y - end.y) <= 1e-6;
        expect(axisAligned).toBe(true);
      }
    }
  });
});

describe('open polyline corner rounding', () => {
  const elbow = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
  ];

  it('leaves both endpoints sharp and insets only the interior turn', () => {
    const corners = roundedPolylineCorners(elbow, 20);
    const first = requiredTestValue(corners[0], 'first corner');
    const last = requiredTestValue(corners[2], 'last corner');
    // An endpoint terminates the path, so it has nothing to round against.
    expect(first.entry).toEqual(first.vertex);
    expect(first.exit).toEqual(first.vertex);
    expect(last.entry).toEqual(last.vertex);
    expect(last.exit).toEqual(last.vertex);
    const turn = requiredTestValue(corners[1], 'interior corner');
    expect(turn.entry).toEqual({ x: 80, y: 0 });
    expect(turn.exit).toEqual({ x: 100, y: 20 });
  });

  it('caps the inset at half the shorter run so arcs cannot overlap', () => {
    // The vertical run is 80 long, the horizontal 100. One inset serves both
    // sides and is capped by the shorter run's half, so 40 applies either way
    // and neither arc can reach a neighbouring turn.
    const turn = requiredTestValue(
      roundedPolylineCorners(elbow, 500)[1],
      'interior corner',
    );
    expect(turn.entry).toEqual({ x: 60, y: 0 });
    expect(turn.exit).toEqual({ x: 100, y: 40 });
  });

  it('collapses a turn whose adjoining run has no length', () => {
    const degenerate = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 60, y: 0 },
    ];
    const turn = requiredTestValue(
      roundedPolylineCorners(degenerate, 15)[1],
      'interior corner',
    );
    expect(turn.entry).toEqual(turn.vertex);
    expect(turn.exit).toEqual(turn.vertex);
  });

  it('keeps every inset inside its own run across fitted paths', () => {
    let seed = 0x5bf03635;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let trial = 0; trial < 200; trial += 1) {
      const points = [{ x: 0, y: 0 }];
      for (let index = 1; index < 12; index += 1) {
        const previous = requiredTestValue(points[index - 1], 'previous point');
        points.push(
          index % 2 === 0
            ? { x: previous.x, y: previous.y + (random() - 0.5) * 200 }
            : { x: previous.x + (random() - 0.5) * 200, y: previous.y },
        );
      }
      const corners = roundedPolylineCorners(points, random() * 300);
      for (let index = 1; index < corners.length - 1; index += 1) {
        const corner = requiredTestValue(corners[index], 'corner');
        const previous = requiredTestValue(points[index - 1], 'previous');
        const next = requiredTestValue(points[index + 1], 'next');
        const entryInset = Math.hypot(
          corner.entry.x - corner.vertex.x,
          corner.entry.y - corner.vertex.y,
        );
        const exitInset = Math.hypot(
          corner.exit.x - corner.vertex.x,
          corner.exit.y - corner.vertex.y,
        );
        const previousLength = Math.hypot(
          previous.x - corner.vertex.x,
          previous.y - corner.vertex.y,
        );
        const nextLength = Math.hypot(
          next.x - corner.vertex.x,
          next.y - corner.vertex.y,
        );
        expect(entryInset).toBeLessThanOrEqual(previousLength / 2 + 1e-9);
        expect(exitInset).toBeLessThanOrEqual(nextLength / 2 + 1e-9);
      }
    }
  });
});
