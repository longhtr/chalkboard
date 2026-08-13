/**
 * Exercises shared world-space geometry from primitive bounds through path
 * fitting, hit testing, transforms, continuity, and bounded fallback behavior.
 */
import { describe, expect, it } from 'vitest';

import type {
  ArrowElement,
  BezierSegment,
  FreehandElement,
  ImageElement,
  LineElement,
  Point,
  RectangleElement,
  ShapeElement,
} from './elementSchema';
import {
  bezierAccuracyTargetError,
  boundsForPoints,
  boundsIntersect,
  distanceToSegment,
  elementBounds,
  enforceBezierContinuity,
  fitBezierSegments,
  fitOrthogonalSegments,
  hitTestElement,
  linePathPoints,
  MAX_BEZIER_FIT_SAMPLES,
  normalizeBounds,
  sampleBezierPoints,
  screenToWorld,
  simplifiedPointIndexes,
  translateElement,
  worldToScreen,
} from './geometry';
import { requiredTestValue } from './testAssertions.js';

function sampledFittedSpline(
  points: readonly Point[],
  segments: readonly BezierSegment[],
  samplesPerSegment = 32,
): Point[] {
  const origin = points[0] ?? { x: 0, y: 0 };
  let start = origin;
  const sampled = [start];
  for (const segment of segments) {
    const control1 = {
      x: origin.x + segment.control1.x,
      y: origin.y + segment.control1.y,
    };
    const control2 = {
      x: origin.x + segment.control2.x,
      y: origin.y + segment.control2.y,
    };
    const end = {
      x: origin.x + segment.end.x,
      y: origin.y + segment.end.y,
    };
    for (let index = 1; index <= samplesPerSegment; index += 1) {
      const parameter = index / samplesPerSegment;
      const inverse = 1 - parameter;
      sampled.push({
        x:
          inverse ** 3 * start.x +
          3 * inverse * inverse * parameter * control1.x +
          3 * inverse * parameter ** 2 * control2.x +
          parameter ** 3 * end.x,
        y:
          inverse ** 3 * start.y +
          3 * inverse * inverse * parameter * control1.y +
          3 * inverse * parameter ** 2 * control2.y +
          parameter ** 3 * end.y,
      });
    }
    start = end;
  }
  return sampled;
}

function maximumDistanceToPolyline(
  points: readonly Point[],
  polyline: readonly Point[],
): number {
  return Math.max(
    ...points.map((point) =>
      Math.min(
        ...polyline
          .slice(1)
          .map((end, index) =>
            distanceToSegment(
              point,
              requiredTestValue(polyline[index], 'polyline segment start'),
              end,
            ),
          ),
      ),
    ),
  );
}

function symmetricSplineError(
  points: readonly Point[],
  segments: readonly BezierSegment[],
): number {
  const fitted = sampledFittedSpline(points, segments);
  return Math.max(
    maximumDistanceToPolyline(points, fitted),
    maximumDistanceToPolyline(fitted, points),
  );
}

const rectangle: RectangleElement = {
  backgroundColor: 'transparent',
  createdBy: 'test',
  height: 50,
  id: 'rectangle',
  opacity: 1,
  rotation: 0,
  strokeColor: '#000',
  strokeWidth: 2,
  type: 'rectangle',
  width: 100,
  x: 10,
  y: 20,
};

describe('coordinate transforms', () => {
  it('round-trips a point through a camera', () => {
    const camera = { x: 200, y: 120, zoom: 1.5 };
    const point = { x: -30, y: 80 };

    expect(screenToWorld(worldToScreen(point, camera), camera)).toEqual(point);
  });
});

describe('bounds', () => {
  it('normalizes negative dimensions', () => {
    expect(normalizeBounds({ x: 20, y: 30, width: -10, height: -20 })).toEqual({
      x: 10,
      y: 10,
      width: 10,
      height: 20,
    });
  });

  it('recognizes intersecting bounds', () => {
    expect(
      boundsIntersect(rectangle, { x: 100, y: 60, width: 30, height: 30 }),
    ).toBe(true);
    expect(
      boundsIntersect(rectangle, { x: 200, y: 200, width: 30, height: 30 }),
    ).toBe(false);
  });
});

describe('element operations', () => {
  it('retains ordered endpoints and significant bends while simplifying', () => {
    expect(simplifiedPointIndexes([], 1)).toEqual([]);
    expect(
      simplifiedPointIndexes(
        [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 10, y: 10 },
          { x: 15, y: 10 },
        ],
        1,
      ),
    ).toEqual([0, 1, 2, 3]);
    expect(
      simplifiedPointIndexes(
        [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 10, y: 0 },
        ],
        1,
      ),
    ).toEqual([0, 2]);
  });

  it('bounds point collections and rejects empty collections', () => {
    expect(
      boundsForPoints([
        { x: -5, y: 20 },
        { x: 15, y: -10 },
      ]),
    ).toEqual({ height: 30, width: 20, x: -5, y: -10 });
    expect(boundsForPoints([])).toBeNull();
  });

  it('hit-tests rectangles and linear elements', () => {
    const arrow: ArrowElement = {
      ...rectangle,
      id: 'arrow',
      type: 'arrow',
      width: 100,
      height: 100,
    };

    const image: ImageElement = {
      ...rectangle,
      id: 'image',
      name: 'diagram.svg',
      source: 'data:image/svg+xml;base64,PHN2Zy8+',
      type: 'image',
    };

    expect(hitTestElement(rectangle, { x: 40, y: 40 })).toBe(true);
    expect(hitTestElement(image, { x: 40, y: 40 })).toBe(true);
    expect(hitTestElement(image, { x: 200, y: 200 })).toBe(false);
    expect(hitTestElement(arrow, { x: 60, y: 70 })).toBe(true);
    expect(
      distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 }),
    ).toBe(5);
  });

  it('bounds, hit-tests, and translates freehand strokes', () => {
    const freehand: FreehandElement = {
      ...rectangle,
      id: 'freehand',
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 20 },
        { x: 100, y: 50 },
      ],
      type: 'freehand',
    };
    expect(elementBounds(freehand)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
    expect(hitTestElement(freehand, { x: 50, y: 40 }, 1)).toBe(true);
    expect(hitTestElement(freehand, { x: 50, y: 80 }, 1)).toBe(false);
    expect(translateElement(freehand, { x: 5, y: -10 })).toMatchObject({
      points: freehand.points,
      x: 15,
      y: 10,
    });
  });

  it('fits one unified family of C0, C1, and C2 cubic splines', () => {
    const points = Array.from({ length: 65 }, (_, index) => ({
      x: index * 2,
      y: 50 * Math.sin(index / 8) + 12 * Math.sin(index / 2),
    }));
    const c0 = fitBezierSegments(points, {
      continuity: 'c0',
      maxSegments: 4,
    });
    const c1 = fitBezierSegments(points, {
      continuity: 'c1',
      maxSegments: 4,
    });
    const c2 = fitBezierSegments(points, {
      continuity: 'c2',
      maxSegments: 4,
    });

    expect(c0.length).toBeGreaterThan(0);
    expect(c0.length).toBeLessThanOrEqual(4);
    expect(c1.length).toBeGreaterThan(0);
    expect(c1.length).toBeLessThanOrEqual(4);
    expect(c2.length).toBeGreaterThan(0);
    expect(c2.length).toBeLessThanOrEqual(4);
    expect(requiredTestValue(c2.at(-1), 'final C2 segment').end).toEqual({
      x: 128,
      y: requiredTestValue(points.at(-1), 'final source point').y,
    });

    const interval = (segments: typeof c0, index: number) => {
      const start =
        index === 0
          ? { x: 0, y: 0 }
          : requiredTestValue(segments[index - 1], 'interval starting segment')
              .end;
      const end = requiredTestValue(
        segments[index],
        'interval ending segment',
      ).end;
      return Math.max(1e-6, Math.hypot(end.x - start.x, end.y - start.y));
    };
    const firstDerivativeMismatch = (segments: typeof c0, index: number) => {
      const left = segments[index];
      const right = segments[index + 1];
      if (left === undefined || right === undefined) return Infinity;
      const leftInterval = interval(segments, index);
      const rightInterval = interval(segments, index + 1);
      return Math.hypot(
        (left.end.x - left.control2.x) / leftInterval -
          (right.control1.x - left.end.x) / rightInterval,
        (left.end.y - left.control2.y) / leftInterval -
          (right.control1.y - left.end.y) / rightInterval,
      );
    };
    const secondDerivativeMismatch = (segments: typeof c0, index: number) => {
      const left = segments[index];
      const right = segments[index + 1];
      if (left === undefined || right === undefined) return Infinity;
      const leftInterval = interval(segments, index);
      const rightInterval = interval(segments, index + 1);
      return Math.hypot(
        (left.end.x - 2 * left.control2.x + left.control1.x) /
          leftInterval ** 2 -
          (right.control2.x - 2 * right.control1.x + left.end.x) /
            rightInterval ** 2,
        (left.end.y - 2 * left.control2.y + left.control1.y) /
          leftInterval ** 2 -
          (right.control2.y - 2 * right.control1.y + left.end.y) /
            rightInterval ** 2,
      );
    };

    expect(
      c0
        .slice(0, -1)
        .some((_, index) =>
          Number.isFinite(firstDerivativeMismatch(c0, index)),
        ),
    ).toBe(true);
    expect(
      c0
        .slice(0, -1)
        .some((_, index) => firstDerivativeMismatch(c0, index) > 1e-3),
    ).toBe(true);
    for (let index = 0; index < c1.length - 1; index += 1) {
      expect(firstDerivativeMismatch(c1, index)).toBeLessThan(1e-7);
    }
    for (let index = 0; index < c2.length - 1; index += 1) {
      expect(firstDerivativeMismatch(c2, index)).toBeLessThan(1e-7);
      expect(secondDerivativeMismatch(c2, index)).toBeLessThan(1e-7);
    }
  });

  it('samples geometry rather than redundant pointer-event density', () => {
    const vertices = [
      { x: 0, y: 0 },
      { x: 70, y: -90 },
      { x: 150, y: 50 },
      { x: 240, y: -70 },
      { x: 330, y: 20 },
    ];
    const dense = vertices.slice(0, -1).flatMap((start, section) => {
      const end = requiredTestValue(
        vertices[section + 1],
        'next sampling vertex',
      );
      return Array.from({ length: 100 }, (_, offset) => {
        const progress = offset / 100;
        return {
          x: start.x + (end.x - start.x) * progress,
          y: start.y + (end.y - start.y) * progress,
        };
      });
    });
    dense.push(requiredTestValue(vertices.at(-1), 'final sampling vertex'));

    expect(sampleBezierPoints(dense, 0.5)).toEqual(vertices);
    for (const continuity of ['c0', 'c1', 'c2'] as const) {
      const segments = fitBezierSegments(dense, {
        continuity,
        maxSegments: 8,
        sampleTolerance: 0.5,
      });
      expect(segments.length).toBeGreaterThan(0);
      expect(segments.length).toBeLessThanOrEqual(vertices.length - 1);
      if (continuity === 'c1') {
        const knots = [{ x: 0, y: 0 }, ...segments.map(({ end }) => end)];
        for (let index = 1; index < knots.length - 1; index += 1) {
          const previous = requiredTestValue(
            knots[index - 1],
            'previous spline knot',
          );
          const knot = requiredTestValue(knots[index], 'current spline knot');
          const next = requiredTestValue(knots[index + 1], 'next spline knot');
          const control = requiredTestValue(
            segments[index]?.control1,
            'next spline control',
          );
          expect(
            (control.x - knot.x) * (next.x - previous.x) +
              (control.y - knot.y) * (next.y - previous.y),
          ).toBeGreaterThan(0);
        }
      }
    }

    const curved = Array.from({ length: 1_001 }, (_, index) => ({
      x: index,
      y: 40 * Math.sin(index / 50),
    }));
    const sampledCurve = sampleBezierPoints(curved, 0.01);
    expect(sampledCurve.length).toBeLessThanOrEqual(MAX_BEZIER_FIT_SAMPLES);
    expect(sampledCurve[0]).toEqual(curved[0]);
    expect(sampledCurve.at(-1)).toEqual(curved.at(-1));
  });

  it('projects stored and edited handles onto their continuity constraints', () => {
    const line: LineElement = {
      ...rectangle,
      id: 'continuous-line',
      pathKind: 'bezier',
      segments: [
        {
          control1: { x: 12, y: 25 },
          control2: { x: 24, y: -10 },
          end: { x: 40, y: 20 },
        },
        {
          control1: { x: 55, y: 45 },
          control2: { x: 68, y: 5 },
          end: { x: 80, y: 30 },
        },
        {
          control1: { x: 90, y: 60 },
          control2: { x: 110, y: 20 },
          end: { x: 120, y: 40 },
        },
      ],
      type: 'line',
    };
    const assertC2 = (candidate: LineElement) => {
      const interval = (index: number) => {
        const start =
          index === 0
            ? { x: 0, y: 0 }
            : requiredTestValue(
                candidate.segments[index - 1],
                'C2 interval starting segment',
              ).end;
        const end = requiredTestValue(
          candidate.segments[index],
          'C2 interval ending segment',
        ).end;
        return Math.max(1e-6, Math.hypot(end.x - start.x, end.y - start.y));
      };
      for (let index = 0; index < candidate.segments.length - 1; index += 1) {
        const left = requiredTestValue(
          candidate.segments[index],
          'left continuity segment',
        );
        const right = requiredTestValue(
          candidate.segments[index + 1],
          'right continuity segment',
        );
        const leftInterval = interval(index);
        const rightInterval = interval(index + 1);
        expect((left.end.x - left.control2.x) / leftInterval).toBeCloseTo(
          (right.control1.x - left.end.x) / rightInterval,
          8,
        );
        expect((left.end.y - left.control2.y) / leftInterval).toBeCloseTo(
          (right.control1.y - left.end.y) / rightInterval,
          8,
        );
        expect(
          (left.end.x - 2 * left.control2.x + left.control1.x) /
            leftInterval ** 2,
        ).toBeCloseTo(
          (right.control2.x - 2 * right.control1.x + left.end.x) /
            rightInterval ** 2,
          8,
        );
        expect(
          (left.end.y - 2 * left.control2.y + left.control1.y) /
            leftInterval ** 2,
        ).toBeCloseTo(
          (right.control2.y - 2 * right.control1.y + left.end.y) /
            rightInterval ** 2,
          8,
        );
      }
    };

    const converted = enforceBezierContinuity(line, 'c2');
    assertC2(converted);
    const convertedFirstSegment = requiredTestValue(
      converted.segments[0],
      'first converted segment',
    );
    const movedControl = {
      x: convertedFirstSegment.control1.x + 20,
      y: convertedFirstSegment.control1.y - 15,
    };
    const moved = enforceBezierContinuity(
      {
        ...converted,
        segments: converted.segments.map((segment, index) =>
          index === 0 ? { ...segment, control1: movedControl } : segment,
        ),
      },
      'c2',
      { control: 'control1', segmentIndex: 0 },
    );
    const firstMovedSegment = requiredTestValue(
      moved.segments[0],
      'first moved segment',
    );
    expect(firstMovedSegment.control1.x).toBeCloseTo(movedControl.x, 10);
    expect(firstMovedSegment.control1.y).toBeCloseTo(movedControl.y, 10);
    assertC2(moved);

    const repaired = enforceBezierContinuity(
      {
        ...line,
        segments: line.segments.map((segment, index) => ({
          ...segment,
          control1: { x: 10_000_000 + index, y: -10_000_000 },
          control2: { x: -10_000_000, y: 10_000_000 + index },
        })),
      },
      'c2',
    );
    expect(
      Math.max(
        ...repaired.segments
          .flatMap(({ control1, control2, end }) => [control1, control2, end])
          .flatMap(({ x, y }) => [Math.abs(x), Math.abs(y)]),
      ),
    ).toBeLessThan(1_000);
    assertC2(repaired);
  });

  it('automatically adds curves on a logarithmic accuracy scale', () => {
    const targets = Array.from({ length: 5 }, (_, index) =>
      bezierAccuracyTargetError(index + 1),
    );
    expect(targets[0]).toBe(5);
    expect(targets.at(-1)).toBeCloseTo(1);
    const stepRatio = 5 ** (1 / 4);
    for (let index = 1; index < targets.length; index += 1) {
      expect((targets[index - 1] ?? 0) / (targets[index] ?? 1)).toBeCloseTo(
        stepRatio,
      );
    }

    const points = Array.from({ length: 129 }, (_, index) => ({
      x: index * 2,
      y: 20 * Math.sin(index / 20) + 5 * Math.sin(index / 5),
    }));
    for (const continuity of ['c0', 'c1', 'c2'] as const) {
      const fits = Array.from({ length: 5 }, (_, index) =>
        fitBezierSegments(points, {
          continuity,
          maxSegments: null,
          targetError: bezierAccuracyTargetError(index + 1),
        }),
      );
      const loosestFit = requiredTestValue(fits[0], 'loosest accuracy fit');
      const strictestFit = requiredTestValue(
        fits.at(-1),
        'strictest accuracy fit',
      );
      expect(loosestFit.length).toBeLessThan(strictestFit.length);
      expect(strictestFit.length).toBeLessThanOrEqual(12);
      let previousError = Number.POSITIVE_INFINITY;
      for (const fitted of fits) {
        const error = symmetricSplineError(points, fitted);
        expect(error).toBeLessThanOrEqual(previousError + 0.25);
        previousError = error;
      }
    }
  });

  it('keeps every continuity stable and scale invariant on adversarial input', () => {
    const screenPoints = Array.from({ length: 31 }, (_, index) => ({
      x: index * 20,
      y: index % 2 === 0 ? 110 : -110,
    }));
    for (const continuity of ['c0', 'c1', 'c2'] as const) {
      let referenceError: number | undefined;
      for (const zoom of [0.1, 0.25, 1, 4]) {
        const points = screenPoints.map(({ x, y }) => ({
          x: x / zoom,
          y: y / zoom,
        }));
        const segments = fitBezierSegments(points, {
          continuity,
          maxSegments: 12,
          sampleTolerance: 1 / zoom,
        });
        expect(segments.length).toBeGreaterThan(0);
        expect(segments.length).toBeLessThanOrEqual(12);
        const screenSegments = segments.map((segment) => ({
          control1: {
            x: segment.control1.x * zoom,
            y: segment.control1.y * zoom,
          },
          control2: {
            x: segment.control2.x * zoom,
            y: segment.control2.y * zoom,
          },
          end: { x: segment.end.x * zoom, y: segment.end.y * zoom },
        }));
        const extent = Math.max(
          ...screenSegments
            .flatMap(({ control1, control2, end }) => [control1, control2, end])
            .flatMap(({ x, y }) => [Math.abs(x), Math.abs(y)]),
        );
        expect(extent).toBeLessThan(1_000);
        const error = symmetricSplineError(screenPoints, screenSegments);
        expect(error).toBeLessThan(200);
        if (referenceError !== undefined) {
          expect(error).toBeCloseTo(referenceError, 6);
        }
        referenceError = error;
      }
    }
  });

  it('never worsens geometric error when users permit more curves', () => {
    const points = Array.from({ length: 401 }, (_, index) => ({
      x: index * 1.5,
      y:
        70 * Math.sin((index / 400) * Math.PI * 4) +
        18 * Math.sin((index / 400) * Math.PI * 14),
    }));
    for (const continuity of ['c0', 'c1', 'c2'] as const) {
      let previousError = Number.POSITIVE_INFINITY;
      for (const maximum of [1, 2, 4, 8, 12]) {
        const segments = fitBezierSegments(points, {
          continuity,
          maxSegments: maximum,
          sampleTolerance: 1,
        });
        const error = symmetricSplineError(points, segments);
        expect(error).toBeLessThanOrEqual(previousError + 0.25);
        previousError = error;
      }
    }
  });

  it('rejects a transient pointer slip instead of fitting a spike', () => {
    const clean = Array.from({ length: 501 }, (_, index) => {
      const progress = index / 500;
      return {
        x: progress * 650,
        y: -120 * Math.sin(Math.PI * progress),
      };
    });
    const slipped = clean.map((point, index) =>
      index === 260 ? { ...point, y: point.y + 35 } : point,
    );
    for (const continuity of ['c0', 'c1', 'c2'] as const) {
      const segments = fitBezierSegments(slipped, {
        continuity,
        maxSegments: 8,
        sampleTolerance: 1,
      });
      expect(symmetricSplineError(clean, segments)).toBeLessThan(1.5);
    }
  });

  it('recovers a smooth gesture from high-frequency hand tremor', () => {
    const clean = Array.from({ length: 1_001 }, (_, index) => {
      const progress = index / 1_000;
      return {
        x: progress * 650,
        y: -120 * Math.sin(Math.PI * progress),
      };
    });
    const shaky = clean.map((point, index) => ({
      ...point,
      y: point.y + 8 * Math.sin(index * 1.91) + 3 * Math.sin(index * 0.37),
    }));
    const automatic = fitBezierSegments(shaky, {
      continuity: 'c1',
      maxSegments: null,
      sampleTolerance: 1,
      targetError: bezierAccuracyTargetError(3),
    });
    expect(automatic).toHaveLength(1);
    expect(symmetricSplineError(clean, automatic)).toBeLessThan(4);
  });

  it('uses C0 capacity to preserve deliberate corners without overshoot', () => {
    const vertices = [
      { x: 0, y: 0 },
      { x: 110, y: -100 },
      { x: 210, y: 80 },
      { x: 300, y: -95 },
      { x: 410, y: 65 },
      { x: 520, y: -25 },
      { x: 600, y: 0 },
    ];
    const points = vertices.slice(0, -1).flatMap((start, index) => {
      const end = requiredTestValue(vertices[index + 1], 'next corner vertex');
      return Array.from({ length: 80 }, (_, offset) => {
        const progress = offset / 80;
        return {
          x: start.x + (end.x - start.x) * progress,
          y: start.y + (end.y - start.y) * progress,
        };
      });
    });
    points.push(requiredTestValue(vertices.at(-1), 'final corner vertex'));
    const segments = fitBezierSegments(points, {
      continuity: 'c0',
      maxSegments: 8,
      sampleTolerance: 1,
    });
    expect(segments).toHaveLength(6);
    expect(symmetricSplineError(points, segments)).toBeLessThan(0.1);
  });

  it('closes C1 and C2 loops periodically at their seam', () => {
    const points = Array.from({ length: 401 }, (_, index) => {
      const angle = (index / 400) * Math.PI * 2;
      return { x: 230 * Math.cos(angle), y: 135 * Math.sin(angle) };
    });
    for (const continuity of ['c1', 'c2'] as const) {
      const segments = fitBezierSegments(points, {
        continuity,
        maxSegments: 8,
        sampleTolerance: 1,
      });
      const knots = [{ x: 0, y: 0 }, ...segments.map(({ end }) => end)];
      const intervals = segments.map((segment, index) => {
        const start = requiredTestValue(
          knots[index],
          'closed-loop segment start',
        );
        return Math.max(
          1e-6,
          Math.hypot(segment.end.x - start.x, segment.end.y - start.y),
        );
      });
      const first = requiredTestValue(segments[0], 'first closed-loop segment');
      const last = requiredTestValue(
        segments.at(-1),
        'last closed-loop segment',
      );
      const firstInterval = requiredTestValue(
        intervals[0],
        'first closed-loop interval',
      );
      const lastInterval = requiredTestValue(
        intervals.at(-1),
        'last closed-loop interval',
      );
      expect(
        Math.hypot(
          (last.end.x - last.control2.x) / lastInterval -
            first.control1.x / firstInterval,
          (last.end.y - last.control2.y) / lastInterval -
            first.control1.y / firstInterval,
        ),
      ).toBeLessThan(1e-7);
      if (continuity === 'c2') {
        expect(
          Math.hypot(
            (last.end.x - 2 * last.control2.x + last.control1.x) /
              lastInterval ** 2 -
              (first.control2.x - 2 * first.control1.x) / firstInterval ** 2,
            (last.end.y - 2 * last.control2.y + last.control1.y) /
              lastInterval ** 2 -
              (first.control2.y - 2 * first.control1.y) / firstInterval ** 2,
          ),
        ).toBeLessThan(1e-7);
      }
    }
  });

  it('preserves periodic continuity while editing a closed-loop handle', () => {
    const points = Array.from({ length: 241 }, (_, index) => {
      const angle = (index / 240) * Math.PI * 2;
      return { x: 180 * Math.cos(angle), y: 110 * Math.sin(angle) };
    });
    for (const continuity of ['c1', 'c2'] as const) {
      const fitted = fitBezierSegments(points, {
        continuity,
        maxSegments: 8,
        sampleTolerance: 1,
      });
      const firstFittedSegment = requiredTestValue(
        fitted[0],
        'first fitted closed-loop segment',
      );
      const movedControl = {
        x: firstFittedSegment.control1.x + 15,
        y: firstFittedSegment.control1.y - 10,
      };
      const edited = enforceBezierContinuity(
        {
          ...rectangle,
          height: 0,
          id: `closed-${continuity}`,
          pathKind: 'bezier',
          segments: fitted.map((segment, index) =>
            index === 0 ? { ...segment, control1: movedControl } : segment,
          ),
          splineContinuity: continuity,
          type: 'line',
          width: 0,
        },
        continuity,
        { control: 'control1', segmentIndex: 0 },
      );
      if (continuity === 'c1') {
        const firstEditedSegment = requiredTestValue(
          edited.segments[0],
          'first edited loop segment',
        );
        expect(firstEditedSegment.control1.x).toBeCloseTo(movedControl.x, 8);
        expect(firstEditedSegment.control1.y).toBeCloseTo(movedControl.y, 8);
      }
      const first = requiredTestValue(
        edited.segments[0],
        'first edited closed-loop segment',
      );
      const last = requiredTestValue(
        edited.segments.at(-1),
        'last edited closed-loop segment',
      );
      const knots = [{ x: 0, y: 0 }, ...edited.segments.map(({ end }) => end)];
      const intervals = edited.segments.map((segment, index) => {
        const start = requiredTestValue(
          knots[index],
          'edited closed-loop segment start',
        );
        return Math.max(
          1e-6,
          Math.hypot(segment.end.x - start.x, segment.end.y - start.y),
        );
      });
      const firstInterval = requiredTestValue(
        intervals[0],
        'first edited closed-loop interval',
      );
      const lastInterval = requiredTestValue(
        intervals.at(-1),
        'last edited closed-loop interval',
      );
      expect(
        Math.hypot(
          (last.end.x - last.control2.x) / lastInterval -
            first.control1.x / firstInterval,
          (last.end.y - last.control2.y) / lastInterval -
            first.control1.y / firstInterval,
        ),
      ).toBeLessThan(1e-7);
      if (continuity === 'c2') {
        expect(
          Math.hypot(
            (last.end.x - 2 * last.control2.x + last.control1.x) /
              lastInterval ** 2 -
              (first.control2.x - 2 * first.control1.x) / firstInterval ** 2,
            (last.end.y - 2 * last.control2.y + last.control1.y) /
              lastInterval ** 2 -
              (first.control2.y - 2 * first.control1.y) / firstInterval ** 2,
          ),
        ).toBeLessThan(1e-7);
      }
    }
  });

  it('fits freehand input with connected horizontal and vertical lines', () => {
    const points = [
      { x: 0, y: 1 },
      { x: 20, y: -1 },
      { x: 40, y: 2 },
      { x: 60, y: 0 },
      { x: 80, y: 2 },
      { x: 100, y: 0 },
      { x: 101, y: 20 },
      { x: 98, y: 40 },
      { x: 100, y: 60 },
    ];
    const segments = fitOrthogonalSegments(points, 6);

    expect(segments.length).toBeGreaterThanOrEqual(2);
    let previous = { x: 0, y: 0 };
    for (const segment of segments) {
      expect(segment.end.x === previous.x || segment.end.y === previous.y).toBe(
        true,
      );
      previous = segment.end;
    }
    const finalSegment = requiredTestValue(
      segments.at(-1),
      'final orthogonal segment',
    );
    expect(finalSegment.end.x).toBeCloseTo(100, 0);
    expect(finalSegment.end.y).toBe(59);
  });

  it('normalizes orthogonal line lengths by their axis extents', () => {
    const segments = fitOrthogonalSegments(
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 20 },
        { x: 400, y: 20 },
      ],
      1,
    );
    const normalizedLengths: number[] = [];
    let previous = { x: 0, y: 0 };
    for (const segment of segments) {
      normalizedLengths.push(
        segment.end.y === previous.y
          ? Math.abs(segment.end.x - previous.x) / 400
          : Math.abs(segment.end.y - previous.y) / 20,
      );
      previous = segment.end;
    }

    expect(segments).toHaveLength(3);
    expect(Math.min(...normalizedLengths)).toBeGreaterThanOrEqual(
      Math.max(...normalizedLengths) / 5,
    );
  });

  it('automatically chooses connected lines with right-angle turns', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
      { x: 150, y: 100 },
    ];
    const segments = fitOrthogonalSegments(points, 1);

    expect(segments.length).toBeGreaterThan(0);
    let previous = { x: 0, y: 0 };
    let previousOrientation: 'horizontal' | 'vertical' | null = null;
    for (const segment of segments) {
      const horizontal =
        previous.y === segment.control1.y &&
        previous.y === segment.control2.y &&
        previous.y === segment.end.y;
      const vertical =
        previous.x === segment.control1.x &&
        previous.x === segment.control2.x &&
        previous.x === segment.end.x;
      expect(horizontal || vertical).toBe(true);
      const orientation = horizontal ? 'horizontal' : 'vertical';
      expect(orientation).not.toBe(previousOrientation);
      previousOrientation = orientation;
      previous = segment.end;
    }
  });

  it('uses fewer segments when they fit equally well', () => {
    const points = Array.from({ length: 40 }, (_, index) => ({
      x: index * 5,
      y: index * 2,
    }));

    expect(
      fitBezierSegments(points, { continuity: 'c1', maxSegments: 8 }),
    ).toHaveLength(1);
  });

  it('fits closed freeform input under only the requested segment limit', () => {
    const points = Array.from({ length: 65 }, (_, index) => {
      const angle = (index / 64) * Math.PI * 2;
      return { x: 50 * Math.cos(angle), y: 30 * Math.sin(angle) };
    });
    const segments = fitBezierSegments(points, {
      continuity: 'c2',
      maxSegments: 4,
    });

    expect(segments).toHaveLength(4);
    const finalSegment = requiredTestValue(
      segments.at(-1),
      'final closed-fit segment',
    );
    expect(finalSegment.end.x).toBeCloseTo(0);
    expect(finalSegment.end.y).toBeCloseTo(0);
    expect(
      segments.every((segment) =>
        [segment.control1, segment.control2, segment.end].every(
          (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
        ),
      ),
    ).toBe(true);
  });

  it('bounds and hit-tests straight and editable Bézier paths', () => {
    const line: LineElement = {
      ...rectangle,
      height: 0,
      id: 'line',
      pathKind: 'bezier',
      segments: [
        {
          control1: { x: 100 / 3, y: 35 },
          control2: { x: 200 / 3, y: 35 },
          end: { x: 100, y: 0 },
        },
      ],
      type: 'line',
    };

    expect(elementBounds(line)).toMatchObject({
      height: 26.25,
      width: 100,
      x: 10,
      y: 20,
    });
    expect(linePathPoints(line)).toHaveLength(17);
    expect(hitTestElement(line, { x: 60, y: 46.25 }, 1)).toBe(true);
    expect(
      hitTestElement({ ...line, pathKind: 'straight' }, { x: 60, y: 46.25 }, 1),
    ).toBe(false);
  });

  it('hit-tests ellipse, triangle, and diamond geometry', () => {
    const shape: ShapeElement = {
      ...rectangle,
      cornerRadius: 0,
      id: 'shape',
      shapeKind: 'ellipse',
      type: 'shape',
    };

    expect(hitTestElement(shape, { x: 60, y: 45 }, 0)).toBe(true);
    expect(hitTestElement(shape, { x: 12, y: 22 }, 0)).toBe(false);
    expect(
      hitTestElement({ ...shape, shapeKind: 'triangle' }, { x: 60, y: 30 }, 0),
    ).toBe(true);
    expect(
      hitTestElement({ ...shape, shapeKind: 'triangle' }, { x: 12, y: 22 }, 0),
    ).toBe(false);
    expect(
      hitTestElement({ ...shape, shapeKind: 'diamond' }, { x: 60, y: 45 }, 0),
    ).toBe(true);
    for (const shapeKind of [
      'pentagon',
      'hexagon',
      'parallelogram',
      'trapezoid',
      'star',
    ] as const) {
      expect(hitTestElement({ ...shape, shapeKind }, { x: 60, y: 45 }, 0)).toBe(
        true,
      );
    }
    expect(
      hitTestElement({ ...shape, shapeKind: 'star' }, { x: 12, y: 22 }, 0),
    ).toBe(false);
    expect(
      hitTestElement({ ...shape, shapeKind: 'trapezoid' }, { x: 12, y: 22 }, 0),
    ).toBe(false);
  });

  it('translates elements without mutation', () => {
    const translated = translateElement(rectangle, { x: 5, y: -10 });

    expect(translated).toMatchObject({ x: 15, y: 10 });
    expect(rectangle).toMatchObject({ x: 10, y: 20 });
  });
});
