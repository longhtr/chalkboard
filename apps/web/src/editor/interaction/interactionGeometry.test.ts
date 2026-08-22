/** Covers handle hit targets and every drag, resize, and control transform across element kinds. */
import {
  polylineCubicSegments,
  type EquationElement,
  type FreehandElement,
  type LineElement,
  type ShapeElement,
} from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import { requiredTestValue } from '../../test/assertions';
import {
  findBezierHandle,
  findResizeHandle,
  findTrapezoidHandle,
  moveBezierHandle,
  moveTrapezoidHandle,
  resizeElements,
  resizedBounds,
} from './interactionGeometry';

const base = {
  backgroundColor: 'transparent',
  createdBy: 'test',
  height: 50,
  opacity: 1,
  rotation: 0,
  strokeColor: '#111827',
  strokeWidth: 2,
  width: 100,
  x: 10,
  y: 20,
} as const;

const shape: ShapeElement = {
  ...base,
  cornerRadius: 0,
  id: 'shape',
  shapeKind: 'rectangle',
  type: 'shape',
};

const bezier: LineElement = {
  ...base,
  height: 0,
  id: 'line',
  pathKind: 'bezier',
  segments: [
    {
      control1: { x: 30, y: 40 },
      control2: { x: 70, y: 40 },
      end: { x: 100, y: 0 },
    },
  ],
  type: 'line',
};

const orthogonalVertices = [
  { x: 10, y: 20 },
  { x: 110, y: 20 },
  { x: 110, y: 70 },
];

const orthogonal: LineElement = {
  ...base,
  height: 50,
  id: 'orthogonal-line',
  pathKind: 'orthogonal',
  segments: polylineCubicSegments(orthogonalVertices, { x: 10, y: 20 }),
  type: 'line',
  width: 100,
};

const identityCamera = { x: 0, y: 0, zoom: 1 };

describe('interaction handles', () => {
  it('finds resize corners and edges around a selection', () => {
    expect(findResizeHandle({ x: 6, y: 16 }, [shape], identityCamera)).toBe(
      'north-west',
    );
    expect(findResizeHandle({ x: 60, y: 16 }, [shape], identityCamera)).toBe(
      'north',
    );
    expect(findResizeHandle({ x: 200, y: 200 }, [shape], identityCamera)).toBe(
      null,
    );
  });

  it('finds and constrains trapezoid top-corner handles', () => {
    const trapezoid: ShapeElement = {
      ...shape,
      shapeKind: 'trapezoid',
      trapezoidTopLeft: 0.2,
      trapezoidTopRight: 0.8,
    };
    expect(
      findTrapezoidHandle({ x: 30, y: 20 }, [trapezoid], identityCamera),
    ).toMatchObject({ handle: 'left' });
    const movedLeft = moveTrapezoidHandle(trapezoid, 'left', {
      x: 200,
      y: 500,
    });
    expect(movedLeft.trapezoidTopLeft).toBeCloseTo(0.7);
    expect(movedLeft.trapezoidTopRight).toBe(0.8);
    const movedRight = moveTrapezoidHandle(trapezoid, 'right', {
      x: -200,
      y: -500,
    });
    expect(movedRight.trapezoidTopLeft).toBe(0.2);
    expect(movedRight.trapezoidTopRight).toBeCloseTo(0.3);
  });

  it('finds and moves Bézier nodes and controls', () => {
    expect(
      requiredTestValue(
        findBezierHandle({ x: 10, y: 20 }, [bezier], identityCamera),
        'starting Bézier node handle',
      ).handle,
    ).toEqual({ kind: 'node', nodeIndex: 0 });

    const control = moveBezierHandle(
      bezier,
      { control: 'control1', kind: 'control', segmentIndex: 0 },
      { x: 50, y: 70 },
    );
    expect(
      requiredTestValue(control.segments[0], 'first controlled segment')
        .control1,
    ).toEqual({ x: 40, y: 50 });

    const endpoint = moveBezierHandle(
      bezier,
      { kind: 'node', nodeIndex: 1 },
      { x: 130, y: 30 },
    );
    expect(endpoint.segments[0]).toMatchObject({
      control2: { x: 90, y: 50 },
      end: { x: 120, y: 10 },
    });
    expect(endpoint).toMatchObject({ height: 10, width: 120 });
  });

  it('locks dependent controls on periodic C2 loops', () => {
    const closed: LineElement = {
      ...bezier,
      segments: [
        {
          control1: { x: 25, y: 40 },
          control2: { x: 75, y: 40 },
          end: { x: 100, y: 0 },
        },
        {
          control1: { x: 75, y: -40 },
          control2: { x: 25, y: -40 },
          end: { x: 0, y: 0 },
        },
      ],
      splineContinuity: 'c2',
      width: 0,
    };
    expect(findBezierHandle({ x: 35, y: 60 }, [closed], identityCamera)).toBe(
      null,
    );
    expect(
      moveBezierHandle(
        closed,
        { control: 'control1', kind: 'control', segmentIndex: 0 },
        { x: 80, y: 90 },
      ),
    ).toBe(closed);
    const movedSeam = moveBezierHandle(
      closed,
      { kind: 'node', nodeIndex: 0 },
      { x: closed.x + 15, y: closed.y - 10 },
    );
    expect(movedSeam).toMatchObject({
      height: 0,
      width: 0,
      x: closed.x + 15,
      y: closed.y - 10,
    });
    expect(
      requiredTestValue(movedSeam.segments.at(-1), 'moved seam segment').end,
    ).toEqual({ x: 0, y: 0 });
  });

  it('keeps linked C1 handles continuous while editing', () => {
    const continuous: LineElement = {
      ...bezier,
      segments: [
        {
          control1: { x: 15, y: 20 },
          control2: { x: 35, y: -20 },
          end: { x: 50, y: 0 },
        },
        {
          control1: { x: 65, y: 20 },
          control2: { x: 85, y: -20 },
          end: { x: 100, y: 0 },
        },
      ],
      splineContinuity: 'c1',
    };
    const moved = moveBezierHandle(
      continuous,
      { control: 'control2', kind: 'control', segmentIndex: 0 },
      { x: 50, y: 50 },
    );

    expect(
      requiredTestValue(moved.segments[0], 'first moved segment').control2,
    ).toEqual({ x: 40, y: 30 });
    expect(
      requiredTestValue(moved.segments[1], 'second moved segment').control1,
    ).toEqual({ x: 60, y: -30 });
  });
});

describe('selection resizing', () => {
  it('preserves spline continuity through nonuniform resizing', () => {
    const interval = Math.hypot(50, 50);
    const line: LineElement = {
      ...bezier,
      height: 50,
      segments: [
        {
          control1: { x: 10, y: 0 },
          control2: { x: 35, y: -10 },
          end: { x: 50, y: 0 },
        },
        {
          control1: {
            x: 50 + interval * 0.3,
            y: interval * 0.2,
          },
          control2: { x: 90, y: 45 },
          end: { x: 100, y: 50 },
        },
      ],
      splineContinuity: 'c1',
    };
    const resized = resizeElements(
      [line],
      new Set([line.id]),
      { x: 10, y: 20, width: 100, height: 50 },
      { x: 10, y: 20, width: 200, height: 50 },
    )[0] as LineElement;
    const left = requiredTestValue(
      resized.segments[0],
      'left resized Bézier segment',
    );
    const right = requiredTestValue(
      resized.segments[1],
      'right resized Bézier segment',
    );
    const leftInterval = Math.hypot(left.end.x, left.end.y);
    const rightInterval = Math.hypot(
      right.end.x - left.end.x,
      right.end.y - left.end.y,
    );

    expect((left.end.x - left.control2.x) / leftInterval).toBeCloseTo(
      (right.control1.x - left.end.x) / rightInterval,
      8,
    );
    expect((left.end.y - left.control2.y) / leftInterval).toBeCloseTo(
      (right.control1.y - left.end.y) / rightInterval,
      8,
    );
  });

  it('resizes cardinally with a minimum and preserves corner aspect ratio', () => {
    const bounds = { x: 10, y: 20, width: 100, height: 50 };
    expect(
      resizedBounds(bounds, {
        handle: 'east',
        minimumSize: 10,
        point: { x: 180, y: 0 },
        preserveAspectRatio: false,
      }),
    ).toEqual({ x: 10, y: 20, width: 170, height: 50 });
    expect(
      resizedBounds(bounds, {
        handle: 'south-east',
        minimumSize: 10,
        point: { x: 210, y: 80 },
        preserveAspectRatio: true,
      }),
    ).toEqual({ x: 10, y: 20, width: 200, height: 100 });
    expect(
      resizedBounds(bounds, {
        handle: 'west',
        minimumSize: 10,
        point: { x: 105, y: 0 },
        preserveAspectRatio: false,
      }),
    ).toEqual({ x: 100, y: 20, width: 10, height: 50 });
  });

  it('scales selected shapes, equations, and Bézier geometry', () => {
    const equation: EquationElement = {
      ...base,
      fontSize: 20,
      id: 'equation',
      source: '$x$',
      type: 'equation',
    };
    const freehand: FreehandElement = {
      ...base,
      id: 'freehand',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
      type: 'freehand',
    };
    const resized = resizeElements(
      [shape, equation, bezier, freehand],
      new Set(['shape', 'equation', 'line', 'freehand']),
      { x: 10, y: 20, width: 100, height: 50 },
      { x: 20, y: 30, width: 200, height: 100 },
    );

    expect(resized[0]).toMatchObject({
      height: 100,
      width: 200,
      x: 20,
      y: 30,
    });
    expect(resized[1]).toMatchObject({
      fontSize: 40,
      height: 100,
      width: 200,
    });
    expect((resized[2] as LineElement).segments[0]).toMatchObject({
      control1: { x: 60, y: 80 },
      end: { x: 200, y: 0 },
    });
    expect((resized[3] as FreehandElement).points).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 100 },
    ]);
  });
});

describe('orthogonal path handles', () => {
  it('exposes a node at every corner but never a cubic control', () => {
    expect(
      findBezierHandle({ x: 110, y: 20 }, [orthogonal], identityCamera),
    ).toMatchObject({ handle: { kind: 'node', nodeIndex: 1 } });
    // A cubic control of the first run sits a third of the way along it. That
    // point must not be grabbable, or dragging it would tilt the run.
    expect(
      findBezierHandle({ x: 43, y: 20 }, [orthogonal], identityCamera),
    ).toBe(null);
  });

  it('drags a corner so both adjoining runs stay axis-aligned', () => {
    const moved = moveBezierHandle(
      orthogonal,
      { kind: 'node', nodeIndex: 1 },
      { x: 150, y: 60 },
    );
    expect({
      height: moved.height,
      width: moved.width,
      x: moved.x,
      y: moved.y,
    }).toEqual({ height: 10, width: 140, x: 10, y: 60 });
    expect(moved.segments).toHaveLength(orthogonal.segments.length);
    const corners = [
      { x: moved.x, y: moved.y },
      ...moved.segments.map((segment) => ({
        x: moved.x + segment.end.x,
        y: moved.y + segment.end.y,
      })),
    ];
    expect(corners).toEqual([
      { x: 10, y: 60 },
      { x: 150, y: 60 },
      { x: 150, y: 70 },
    ]);
  });

  it('ignores a control handle aimed at an orthogonal path', () => {
    expect(
      moveBezierHandle(
        orthogonal,
        { control: 'control1', kind: 'control', segmentIndex: 0 },
        { x: 400, y: 400 },
      ),
    ).toBe(orthogonal);
  });
});
