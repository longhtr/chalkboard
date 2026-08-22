/** Covers handle hit targets and every drag, resize, and control transform across element kinds. */
import {
  elementBounds,
  elementRotationCenter,
  polylineCubicSegments,
  rotatePoint,
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
  isRotationHandleAt,
  moveBezierHandle,
  moveTrapezoidHandle,
  pointInElementFrame,
  resizeElements,
  resizedBounds,
  rotationHandlePoint,
  selectionCanRotate,
  selectionFrame,
  visualResizeHandle,
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

  it('scales an equation from a single-axis edge handle', () => {
    const equation: EquationElement = {
      ...base,
      fontSize: 20,
      id: 'equation',
      source: '$x$',
      sourceFontSize: 18,
      type: 'equation',
    };
    const resized = resizeElements(
      [equation],
      new Set(['equation']),
      { x: 10, y: 20, width: 100, height: 50 },
      { x: 10, y: 20, width: 170, height: 50 },
    )[0];

    expect(resized).toMatchObject({
      fontSize: 34,
      height: 85,
      width: 170,
      x: 10,
      y: 2.5,
    });
    expect((resized as EquationElement).sourceFontSize).toBeCloseTo(30.6);
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

describe('Straight path handles', () => {
  it('exposes and moves both endpoints of a single segment', () => {
    const simple: LineElement = {
      ...base,
      height: 50,
      id: 'simple-straight',
      pathKind: 'straight',
      segments: polylineCubicSegments(
        [
          { x: 10, y: 20 },
          { x: 110, y: 70 },
        ],
        { x: 10, y: 20 },
      ),
      type: 'line',
      width: 100,
      x: 10,
      y: 20,
    };

    expect(
      findBezierHandle({ x: 10, y: 20 }, [simple], identityCamera),
    ).toMatchObject({ handle: { kind: 'node', nodeIndex: 0 } });
    expect(
      findBezierHandle({ x: 110, y: 70 }, [simple], identityCamera),
    ).toMatchObject({ handle: { kind: 'node', nodeIndex: 1 } });
    expect(findBezierHandle({ x: 60, y: 45 }, [simple], identityCamera)).toBe(
      null,
    );

    expect(
      moveBezierHandle(
        simple,
        { kind: 'node', nodeIndex: 0 },
        { x: 20, y: 30 },
      ),
    ).toMatchObject({ height: 40, width: 90, x: 20, y: 30 });
    expect(
      moveBezierHandle(
        simple,
        { kind: 'node', nodeIndex: 1 },
        { x: 140, y: 90 },
      ),
    ).toMatchObject({ height: 70, width: 130, x: 10, y: 20 });
  });

  const vertices = [
    { x: 10, y: 20 },
    { x: 110, y: 20 },
    { x: 110, y: 70 },
  ];
  const straight: LineElement = {
    ...base,
    id: 'connected-straight',
    pathKind: 'straight',
    segments: polylineCubicSegments(vertices, vertices[0] ?? { x: 0, y: 0 }),
    straightSegmented: true,
    type: 'line',
  };

  it('exposes every vertex but no cubic controls', () => {
    vertices.forEach((point, nodeIndex) => {
      expect(findBezierHandle(point, [straight], identityCamera)).toMatchObject(
        {
          handle: { kind: 'node', nodeIndex },
        },
      );
    });
    expect(findBezierHandle({ x: 43, y: 20 }, [straight], identityCamera)).toBe(
      null,
    );
  });

  it('moves a shared vertex while keeping both adjacent runs straight', () => {
    const moved = moveBezierHandle(
      straight,
      { kind: 'node', nodeIndex: 1 },
      { x: 140, y: 50 },
    );
    expect(moved.segments).toEqual(
      polylineCubicSegments(
        [
          vertices[0] ?? { x: 0, y: 0 },
          { x: 140, y: 50 },
          vertices[2] ?? { x: 0, y: 0 },
        ],
        vertices[0] ?? { x: 0, y: 0 },
      ),
    );
  });

  it('keeps a snapped closed connection joined when its handle moves', () => {
    const origin = vertices[0] ?? { x: 0, y: 0 };
    const closed = {
      ...straight,
      height: 0,
      segments: polylineCubicSegments([...vertices, origin], origin),
      width: 0,
    };
    const moved = moveBezierHandle(
      closed,
      { kind: 'node', nodeIndex: 0 },
      { x: 40, y: 50 },
    );

    expect(moved).toMatchObject({ height: 0, width: 0, x: 40, y: 50 });
    expect(moved.segments.at(-1)?.end).toEqual({ x: 0, y: 0 });
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

/**
 * Rotation moves every piece of selection chrome, and each piece is found by a
 * different function. These pin the arithmetic with exact numbers so a
 * regression names itself instead of showing up as "the handle feels off".
 *
 * The shape is 100 x 50 at (10, 20), so its centre is (60, 45), and the camera
 * is the identity, so screen coordinates equal world coordinates.
 */
describe('rotated selection chrome', () => {
  const turned: ShapeElement = { ...shape, rotation: 90 };

  it('describes a single selection by its own angle and centre', () => {
    const frame = requiredTestValue(selectionFrame([turned]), 'frame');
    expect(frame.rotation).toBe(90);
    expect(frame.center).toEqual({ x: 60, y: 45 });
    expect(frame.bounds).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('treats a group as an upright box around the turned pieces', () => {
    // The turned 100 x 50 shape covers a 50 x 100 patch of screen, so a group
    // containing it is measured from that patch, not from its stored box.
    const other: ShapeElement = { ...shape, id: 'other', x: 200, y: 200 };
    const frame = requiredTestValue(selectionFrame([turned, other]), 'frame');
    expect(frame.rotation).toBe(0);
    expect(frame.bounds.x).toBeCloseTo(35, 6);
    expect(frame.bounds.y).toBeCloseTo(-5, 6);
    expect(frame.bounds.width).toBeCloseTo(265, 6);
    expect(frame.bounds.height).toBeCloseTo(255, 6);
  });

  it('carries the rotation handle around with the shape', () => {
    // Upright the handle sits 26px above the top edge, at (60, -6). A quarter
    // turn swings that to the same distance out to the right.
    expect(rotationHandlePoint([shape], identityCamera)).toEqual({
      x: 60,
      y: -6,
    });
    const carried = requiredTestValue(
      rotationHandlePoint([turned], identityCamera),
      'turned handle',
    );
    expect(carried.x).toBeCloseTo(111, 6);
    expect(carried.y).toBeCloseTo(45, 6);
    expect(isRotationHandleAt(carried, [turned], identityCamera)).toBe(true);
    // And no longer where it used to be.
    expect(isRotationHandleAt({ x: 60, y: -6 }, [turned], identityCamera)).toBe(
      false,
    );
  });

  it('withholds the rotation handle from a mixed text block', () => {
    // A mixed text block is HTML over the canvas and is always drawn upright,
    // so offering the handle stored an angle that moved the selection box and
    // the hit test away from writing that had not moved.
    const equation: EquationElement = {
      ...base,
      fontSize: 20,
      id: 'equation',
      source: '$x$',
      type: 'equation',
    };
    expect(selectionCanRotate([equation])).toBe(false);
    expect(rotationHandlePoint([equation], identityCamera)).toBeNull();
    expect(
      isRotationHandleAt({ x: 60, y: -6 }, [equation], identityCamera),
    ).toBe(false);
    // One block is enough to withhold it from a group, which would otherwise
    // carry the block around a shared centre without turning it.
    expect(selectionCanRotate([shape, equation])).toBe(false);
    expect(rotationHandlePoint([shape, equation], identityCamera)).toBeNull();
    // Shapes are unaffected.
    expect(selectionCanRotate([shape])).toBe(true);
    expect(rotationHandlePoint([shape], identityCamera)).not.toBeNull();
  });

  it('reports a mixed text block upright however its angle reads', () => {
    // A block turned before the handle was withheld still answers clicks and
    // draws its selection box where the writing actually is.
    const turnedEquation: EquationElement = {
      ...base,
      fontSize: 20,
      id: 'equation',
      rotation: 70,
      source: '$x$',
      type: 'equation',
    };
    const frame = requiredTestValue(
      selectionFrame([turnedEquation]),
      'equation frame',
    );
    expect(frame.rotation).toBe(0);
    expect(frame.bounds).toEqual(elementBounds(turnedEquation));
  });

  it('finds every resize handle at its turned position', () => {
    // Each handle's upright position, turned a quarter turn about (60, 45).
    const expected: [string, { x: number; y: number }][] = [
      ['north-west', { x: 85, y: -5 }],
      ['north', { x: 85, y: 45 }],
      ['north-east', { x: 85, y: 95 }],
      ['east', { x: 60, y: 95 }],
      ['south-east', { x: 35, y: 95 }],
      ['south', { x: 35, y: 45 }],
      ['south-west', { x: 35, y: -5 }],
      ['west', { x: 60, y: -5 }],
    ];
    for (const [handle, point] of expected) {
      expect(findResizeHandle(point, [turned], identityCamera)).toBe(handle);
    }
    // The upright positions are no longer handles, which is what makes the
    // eight results above a turn rather than a coincidence.
    expect(findResizeHandle({ x: 10, y: 20 }, [turned], identityCamera)).toBe(
      null,
    );
  });

  it('names the cursor after where a handle now points', () => {
    expect(visualResizeHandle('north-west', 0)).toBe('north-west');
    expect(visualResizeHandle('north-west', 90)).toBe('north-east');
    expect(visualResizeHandle('east', 90)).toBe('south');
    expect(visualResizeHandle('south-east', 90)).toBe('south-west');
    expect(visualResizeHandle('north', 45)).toBe('north-east');
    // Nearly a full turn is a small turn, not a large one.
    expect(visualResizeHandle('east', 350)).toBe('east');
  });

  it('carries Bezier nodes and controls round with a turned path', () => {
    // The same path, upright and turned. Every handle has to be grabbable where
    // it is now drawn, and nowhere else -- a handle still answering at its
    // upright position is a handle the reader can no longer see.
    const turnedLine: LineElement = { ...bezier, rotation: 90 };
    const centre = elementRotationCenter(bezier);
    const node = { x: 10, y: 20 };
    const control = { x: 40, y: 60 };

    expect(
      requiredTestValue(
        findBezierHandle(node, [bezier], identityCamera),
        'upright node',
      ).handle,
    ).toEqual({ kind: 'node', nodeIndex: 0 });
    expect(
      requiredTestValue(
        findBezierHandle(
          rotatePoint(node, centre, 90),
          [turnedLine],
          identityCamera,
        ),
        'turned node',
      ).handle,
    ).toEqual({ kind: 'node', nodeIndex: 0 });
    expect(findBezierHandle(node, [turnedLine], identityCamera)).toBe(null);

    expect(
      requiredTestValue(
        findBezierHandle(control, [bezier], identityCamera),
        'upright control',
      ).handle,
    ).toEqual({ control: 'control1', kind: 'control', segmentIndex: 0 });
    expect(
      requiredTestValue(
        findBezierHandle(
          rotatePoint(control, centre, 90),
          [turnedLine],
          identityCamera,
        ),
        'turned control',
      ).handle,
    ).toEqual({ control: 'control1', kind: 'control', segmentIndex: 0 });
    // The upright spot no longer answers as that control. (It lands near where
    // the *other* control has been carried to, which is why this checks the
    // identity rather than expecting nothing at all.)
    expect(
      findBezierHandle(control, [turnedLine], identityCamera)?.handle,
    ).not.toEqual({ control: 'control1', kind: 'control', segmentIndex: 0 });
  });

  it('carries a trapezoid top corner round with the turned shape', () => {
    const trapezoid: ShapeElement = {
      ...shape,
      shapeKind: 'trapezoid',
      trapezoidTopLeft: 0.25,
      trapezoidTopRight: 0.75,
    };
    const turnedTrapezoid: ShapeElement = { ...trapezoid, rotation: 90 };
    // A quarter of the way along a 100-wide top edge that starts at x = 10.
    const corner = { x: 35, y: 20 };
    expect(
      requiredTestValue(
        findTrapezoidHandle(corner, [trapezoid], identityCamera),
        'upright corner',
      ).handle,
    ).toBe('left');
    expect(
      requiredTestValue(
        findTrapezoidHandle(
          rotatePoint(corner, elementRotationCenter(trapezoid), 90),
          [turnedTrapezoid],
          identityCamera,
        ),
        'turned corner',
      ).handle,
    ).toBe('left');
    expect(findTrapezoidHandle(corner, [turnedTrapezoid], identityCamera)).toBe(
      null,
    );
  });

  it('reads a direct handle in the element own upright frame', () => {
    // A point 40px straight above the centre on screen is, to a shape turned a
    // quarter turn clockwise, a point 40px to the left of its own centre.
    const local = pointInElementFrame({ x: 60, y: 5 }, turned, identityCamera);
    expect(local.x).toBeCloseTo(20, 6);
    expect(local.y).toBeCloseTo(45, 6);
    // An upright element is left exactly alone.
    expect(pointInElementFrame({ x: 60, y: 5 }, shape, identityCamera)).toEqual(
      {
        x: 60,
        y: 5,
      },
    );
  });
});
