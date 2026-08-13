/** Proves fitted orthogonal paths remain axis-aligned, bounded, stable, and free of zero-length segments. */
import { describe, expect, it } from 'vitest';
import { fitOrthogonalSegments } from './geometry.js';
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
