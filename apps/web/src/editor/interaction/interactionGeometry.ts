/**
 * Geometry for selection boxes, resize handles, Bézier controls, trapezoid
 * controls, dragging, and resizing. Functions are pure and use world space.
 */
import {
  enforceBezierContinuity,
  equationSourceFontSize,
  isShapeElement,
  linePathGeometry,
  MIN_TRAPEZOID_TOP_EDGE_RATIO,
  moveOrthogonalVertex,
  normalizedTrapezoidTop,
  polylineCubicSegments,
  selectionBounds,
  trapezoidPoints,
  worldToScreen,
  type BoardElement,
  type Bounds,
  type Camera,
  type LineElement,
  type Point,
  type ShapeElement,
} from '@chalkboard/shared';

/** Editable node or cubic control-point identity within one Bézier line. */
export type BezierHandle =
  | { kind: 'node'; nodeIndex: number }
  | {
      control: 'control1' | 'control2';
      kind: 'control';
      segmentIndex: number;
    };

/** Editable normalized top-corner identity within one trapezoid. */
export type TrapezoidHandle = 'left' | 'right';

/** Compass identity of a selection-bounds resize affordance. */
export type ResizeHandle =
  | 'north-west'
  | 'north'
  | 'north-east'
  | 'east'
  | 'south-east'
  | 'south'
  | 'south-west'
  | 'west';

/** Converts client coordinates to coordinates local to the event canvas. */
export function getScreenPoint(event: {
  clientX: number;
  clientY: number;
  currentTarget: HTMLCanvasElement;
}): Point {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function hasLockedPeriodicC2Controls(element: LineElement): boolean {
  const end = element.segments.at(-1)?.end;
  return (
    element.splineContinuity === 'c2' &&
    end !== undefined &&
    Math.hypot(end.x, end.y) <= 1e-6
  );
}

/**
 * Finds the nearest visible node/control handle for a single selected line.
 * Orthogonal paths expose their corners as nodes but never expose cubic
 * controls, because moving one would tilt a run off its axis.
 */
export function findBezierHandle(
  point: Point,
  elements: readonly BoardElement[],
  camera: Camera,
): { handle: BezierHandle; line: LineElement } | null {
  if (elements.length !== 1) return null;
  const line = elements[0];
  if (line?.type !== 'line') return null;
  if (line.pathKind !== 'bezier' && line.pathKind !== 'orthogonal') return null;
  const path = linePathGeometry(line);
  if (path.kind !== 'bezier') return null;
  const handles: [BezierHandle, Point][] = [
    [{ kind: 'node', nodeIndex: 0 }, path.start],
  ];
  path.segments.forEach((segment, segmentIndex) => {
    handles.push([{ kind: 'node', nodeIndex: segmentIndex + 1 }, segment.end]);
  });
  if (line.pathKind === 'bezier' && !hasLockedPeriodicC2Controls(line)) {
    path.segments.forEach((segment, segmentIndex) => {
      handles.push(
        [
          { control: 'control1', kind: 'control', segmentIndex },
          segment.control1,
        ],
        [
          { control: 'control2', kind: 'control', segmentIndex },
          segment.control2,
        ],
      );
    });
  }
  const handle = handles.find(([, worldPoint]) => {
    const screenPoint = worldToScreen(worldPoint, camera);
    return Math.hypot(point.x - screenPoint.x, point.y - screenPoint.y) <= 9;
  })?.[0];
  return handle === undefined ? null : { handle, line };
}

/**
 * Moves one orthogonal corner, rebuilding the whole path so every run stays
 * axis-aligned. The polyline is re-derived rather than patched segment by
 * segment because a corner move can shift three vertices at once.
 */
function moveOrthogonalHandle(
  element: LineElement,
  nodeIndex: number,
  point: Point,
): LineElement {
  const path = linePathGeometry(element);
  if (path.kind !== 'bezier') return element;
  const vertices = [path.start, ...path.segments.map((segment) => segment.end)];
  const moved = moveOrthogonalVertex(vertices, nodeIndex, point);
  const origin = moved[0];
  if (origin === undefined) return element;
  const segments = polylineCubicSegments(moved, origin);
  const end = segments.at(-1)?.end ?? { x: 0, y: 0 };
  return {
    ...element,
    height: end.y,
    segments,
    width: end.x,
    x: origin.x,
    y: origin.y,
  };
}

/** Moves one Bézier handle and reapplies the line's continuity constraints. */
export function moveBezierHandle(
  element: LineElement,
  handle: BezierHandle,
  point: Point,
): LineElement {
  if (element.pathKind === 'orthogonal') {
    return handle.kind === 'node'
      ? moveOrthogonalHandle(element, handle.nodeIndex, point)
      : element;
  }
  const segments = element.segments.map((segment) => ({
    control1: { ...segment.control1 },
    control2: { ...segment.control2 },
    end: { ...segment.end },
  }));
  if (handle.kind === 'control') {
    if (hasLockedPeriodicC2Controls(element)) return element;
    const segment = segments[handle.segmentIndex];
    if (segment === undefined) return element;
    segment[handle.control] = {
      x: point.x - element.x,
      y: point.y - element.y,
    };
    return enforceBezierContinuity(
      { ...element, segments },
      element.splineContinuity ?? 'c0',
      handle,
    );
  }

  if (handle.nodeIndex === 0) {
    const closed =
      Math.hypot(
        element.segments.at(-1)?.end.x ?? Number.POSITIVE_INFINITY,
        element.segments.at(-1)?.end.y ?? Number.POSITIVE_INFINITY,
      ) <= 1e-6;
    const delta = { x: point.x - element.x, y: point.y - element.y };
    for (const segment of segments) {
      for (const key of ['control1', 'control2', 'end'] as const) {
        segment[key].x -= delta.x;
        segment[key].y -= delta.y;
      }
    }
    const first = segments[0];
    if (first !== undefined) {
      first.control1.x += delta.x;
      first.control1.y += delta.y;
    }
    const last = segments.at(-1);
    if (closed && last !== undefined) {
      last.control2.x += delta.x;
      last.control2.y += delta.y;
      last.end = { x: 0, y: 0 };
    }
    const end = last?.end ?? { x: 0, y: 0 };
    return enforceBezierContinuity(
      {
        ...element,
        height: end.y,
        segments,
        width: end.x,
        x: point.x,
        y: point.y,
      },
      element.splineContinuity ?? 'c0',
    );
  }

  const previous = segments[handle.nodeIndex - 1];
  if (previous === undefined) return element;
  const target = { x: point.x - element.x, y: point.y - element.y };
  const delta = {
    x: target.x - previous.end.x,
    y: target.y - previous.end.y,
  };
  previous.end = target;
  previous.control2.x += delta.x;
  previous.control2.y += delta.y;
  const next = segments[handle.nodeIndex];
  if (next !== undefined) {
    next.control1.x += delta.x;
    next.control1.y += delta.y;
  }
  const end = segments.at(-1)?.end ?? { x: 0, y: 0 };
  return enforceBezierContinuity(
    { ...element, height: end.y, segments, width: end.x },
    element.splineContinuity ?? 'c0',
  );
}

/** Finds the nearest top-corner handle for a single selected trapezoid. */
export function findTrapezoidHandle(
  point: Point,
  elements: readonly BoardElement[],
  camera: Camera,
): { handle: TrapezoidHandle; shape: ShapeElement } | null {
  if (elements.length !== 1) return null;
  const shape = elements[0];
  if (shape?.type !== 'shape' || shape.shapeKind !== 'trapezoid') return null;
  const [left, right] = trapezoidPoints(
    shape,
    shape.trapezoidTopLeft,
    shape.trapezoidTopRight,
  );
  if (left === undefined || right === undefined) return null;
  const handles: [TrapezoidHandle, Point][] = [
    ['left', worldToScreen(left, camera)],
    ['right', worldToScreen(right, camera)],
  ];
  const handle = handles.find(
    ([, handlePoint]) =>
      Math.hypot(point.x - handlePoint.x, point.y - handlePoint.y) <= 9,
  )?.[0];
  return handle === undefined ? null : { handle, shape };
}

/** Moves one trapezoid top corner while retaining the minimum top-edge width. */
export function moveTrapezoidHandle(
  element: ShapeElement,
  handle: TrapezoidHandle,
  point: Point,
): ShapeElement {
  if (element.shapeKind !== 'trapezoid' || element.width <= 0) return element;
  const top = normalizedTrapezoidTop(
    element.trapezoidTopLeft,
    element.trapezoidTopRight,
  );
  const ratio = Math.max(0, Math.min(1, (point.x - element.x) / element.width));
  return handle === 'left'
    ? {
        ...element,
        trapezoidTopLeft: Math.min(
          ratio,
          top.right - MIN_TRAPEZOID_TOP_EDGE_RATIO,
        ),
        trapezoidTopRight: top.right,
      }
    : {
        ...element,
        trapezoidTopLeft: top.left,
        trapezoidTopRight: Math.max(
          ratio,
          top.left + MIN_TRAPEZOID_TOP_EDGE_RATIO,
        ),
      };
}

/** Finds the nearest visible resize affordance around selected bounds. */
export function findResizeHandle(
  point: Point,
  elements: readonly BoardElement[],
  camera: Camera,
): ResizeHandle | null {
  const bounds = selectionBounds(elements);
  if (bounds === null || bounds.width < 3 || bounds.height < 3) return null;
  const topLeft = worldToScreen(bounds, camera);
  const right = topLeft.x + bounds.width * camera.zoom;
  const bottom = topLeft.y + bounds.height * camera.zoom;
  const handles: [ResizeHandle, Point][] = [
    ['north-west', { x: topLeft.x - 4, y: topLeft.y - 4 }],
    ['north-east', { x: right + 4, y: topLeft.y - 4 }],
    ['south-west', { x: topLeft.x - 4, y: bottom + 4 }],
    ['south-east', { x: right + 4, y: bottom + 4 }],
    ['north', { x: (topLeft.x + right) / 2, y: topLeft.y - 4 }],
    ['east', { x: right + 4, y: (topLeft.y + bottom) / 2 }],
    ['south', { x: (topLeft.x + right) / 2, y: bottom + 4 }],
    ['west', { x: topLeft.x - 4, y: (topLeft.y + bottom) / 2 }],
  ];
  const handle = handles.find(
    ([, handlePoint]) =>
      Math.hypot(point.x - handlePoint.x, point.y - handlePoint.y) <= 9,
  )?.[0];
  if (handle !== undefined) return handle;

  const edgeTolerance = 6;
  const left = topLeft.x - 4;
  const top = topLeft.y - 4;
  const edgeRight = right + 4;
  const edgeBottom = bottom + 4;
  if (point.x >= left + edgeTolerance && point.x <= edgeRight - edgeTolerance) {
    if (Math.abs(point.y - top) <= edgeTolerance) return 'north';
    if (Math.abs(point.y - edgeBottom) <= edgeTolerance) return 'south';
  }
  if (point.y >= top + edgeTolerance && point.y <= edgeBottom - edgeTolerance) {
    if (Math.abs(point.x - left) <= edgeTolerance) return 'west';
    if (Math.abs(point.x - edgeRight) <= edgeTolerance) return 'east';
  }
  return null;
}

/** Computes bounds for a dragged handle with size and aspect-ratio constraints. */
export function resizedBounds(
  bounds: Bounds,
  options: {
    handle: ResizeHandle;
    minimumSize: number;
    point: Point;
    preserveAspectRatio: boolean;
  },
): Bounds {
  const { handle, minimumSize, point, preserveAspectRatio } = options;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const west =
    handle === 'north-west' || handle === 'south-west' || handle === 'west';
  const east =
    handle === 'north-east' || handle === 'south-east' || handle === 'east';
  const north =
    handle === 'north-west' || handle === 'north-east' || handle === 'north';
  const south =
    handle === 'south-west' || handle === 'south-east' || handle === 'south';
  let width = west
    ? Math.max(minimumSize, right - point.x)
    : east
      ? Math.max(minimumSize, point.x - bounds.x)
      : bounds.width;
  let height = north
    ? Math.max(minimumSize, bottom - point.y)
    : south
      ? Math.max(minimumSize, point.y - bounds.y)
      : bounds.height;

  if (
    preserveAspectRatio &&
    (west || east) &&
    (north || south) &&
    bounds.width > 0 &&
    bounds.height > 0
  ) {
    const aspectRatio = bounds.width / bounds.height;
    if (width / bounds.width >= height / bounds.height) {
      height = Math.max(minimumSize, width / aspectRatio);
    } else {
      width = Math.max(minimumSize, height * aspectRatio);
    }
  }

  return {
    x: west ? right - width : bounds.x,
    y: north ? bottom - height : bounds.y,
    width,
    height,
  };
}

/** Scales selected element geometry from old bounds into new bounds. */
export function resizeElements(
  elements: readonly BoardElement[],
  selectedIds: ReadonlySet<string>,
  from: Bounds,
  to: Bounds,
): BoardElement[] {
  const scaleX = to.width / from.width;
  const scaleY = to.height / from.height;
  return elements.map((element) => {
    if (!selectedIds.has(element.id)) return element;
    if (
      !isShapeElement(element) &&
      element.type !== 'image' &&
      element.type !== 'line' &&
      element.type !== 'equation' &&
      element.type !== 'freehand'
    ) {
      return element;
    }
    const position = {
      x: to.x + (element.x - from.x) * scaleX,
      y: to.y + (element.y - from.y) * scaleY,
    };
    if (element.type === 'equation') {
      const scale = Math.max(0.2, Math.min(scaleX, scaleY));
      return {
        ...element,
        ...position,
        fontSize: Math.max(12, element.fontSize * scale),
        height: element.height * scale,
        sourceFontSize: Math.max(1, equationSourceFontSize(element) * scale),
        width: element.width * scale,
      };
    }
    if (element.type === 'freehand') {
      return {
        ...element,
        ...position,
        height: element.height * scaleY,
        points: element.points.map((point) => ({
          x: point.x * scaleX,
          y: point.y * scaleY,
        })),
        width: element.width * scaleX,
      };
    }
    if (element.type === 'line') {
      const resized = {
        ...element,
        ...position,
        height: element.height * scaleY,
        segments: element.segments.map((segment) => ({
          control1: {
            x: segment.control1.x * scaleX,
            y: segment.control1.y * scaleY,
          },
          control2: {
            x: segment.control2.x * scaleX,
            y: segment.control2.y * scaleY,
          },
          end: {
            x: segment.end.x * scaleX,
            y: segment.end.y * scaleY,
          },
        })),
        width: element.width * scaleX,
      };
      return element.pathKind === 'bezier'
        ? enforceBezierContinuity(resized, element.splineContinuity ?? 'c0')
        : resized;
    }
    return {
      ...element,
      ...position,
      height: element.height * scaleY,
      width: element.width * scaleX,
    };
  });
}
