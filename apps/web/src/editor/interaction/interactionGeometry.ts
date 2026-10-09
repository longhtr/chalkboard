/**
 * Geometry for selection boxes, resize handles, Bézier controls, trapezoid
 * controls, dragging, and resizing. Functions are pure and use world space.
 */
import {
  enforceBezierContinuity,
  equationSourceFontSize,
  isShapeElement,
  linePathGeometry,
  linePathVertices,
  MIN_TRAPEZOID_TOP_EDGE_RATIO,
  moveOrthogonalVertex,
  normalizedTrapezoidTop,
  polylineCubicSegments,
  canRotateElement,
  elementBounds,
  elementRotation,
  elementRotationCenter,
  boundsForPoints,
  rotatedElementBounds,
  rotatePoint,
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
/**
 * Undoes an element's own turn on a screen point.
 *
 * Direct handles -- Bézier nodes and controls, trapezoid corners -- are stored
 * in the element's upright coordinates, so a turned element's handles are drawn
 * turned but computed upright. Bringing the pointer back into those upright
 * coordinates lets the search and the drag below stay exactly as they were.
 */
export function pointInElementFrame(
  point: Point,
  element: BoardElement,
  camera: Camera,
): Point {
  const rotation = elementRotation(element);
  if (rotation === 0) return point;
  return rotatePoint(
    point,
    worldToScreen(elementRotationCenter(element), camera),
    -rotation,
  );
}

export function findBezierHandle(
  point: Point,
  elements: readonly BoardElement[],
  camera: Camera,
): { handle: BezierHandle; line: LineElement } | null {
  if (elements.length !== 1) return null;
  const line = elements[0];
  if (line?.type !== 'line') return null;
  const editableStraight = line.pathKind === 'straight';
  if (
    line.pathKind !== 'bezier' &&
    line.pathKind !== 'orthogonal' &&
    !editableStraight
  ) {
    return null;
  }
  const path = linePathGeometry(line);
  const handles: [BezierHandle, Point][] = linePathVertices(line).map(
    (point, nodeIndex) => [{ kind: 'node', nodeIndex }, point],
  );
  if (
    line.pathKind === 'bezier' &&
    path.kind === 'bezier' &&
    !hasLockedPeriodicC2Controls(line)
  ) {
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
  const local = pointInElementFrame(point, line, camera);
  const handle = handles.find(([, worldPoint]) => {
    const screenPoint = worldToScreen(worldPoint, camera);
    return Math.hypot(local.x - screenPoint.x, local.y - screenPoint.y) <= 9;
  })?.[0];
  return handle === undefined ? null : { handle, line };
}

/** Rebuilds exact straight cubic records around a possibly moved origin. */
function rebuiltPolyline(
  element: LineElement,
  vertices: readonly Point[],
): LineElement {
  const origin = vertices[0];
  if (origin === undefined) return element;
  const segments = polylineCubicSegments(vertices, origin);
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

function moveStraightHandle(
  element: LineElement,
  nodeIndex: number,
  point: Point,
): LineElement {
  const vertices = linePathVertices(element);
  const connection = vertices[nodeIndex];
  if (connection === undefined) return element;
  return rebuiltPolyline(
    element,
    vertices.map((vertex) =>
      Math.hypot(vertex.x - connection.x, vertex.y - connection.y) <= 1e-6
        ? point
        : vertex,
    ),
  );
}

/**
 * Moves one orthogonal corner, rebuilding the whole path so every run stays
 * axis-aligned. A corner move can shift three vertices at once.
 */
function moveOrthogonalHandle(
  element: LineElement,
  nodeIndex: number,
  point: Point,
): LineElement {
  const path = linePathGeometry(element);
  if (path.kind !== 'bezier') return element;
  const vertices = [path.start, ...path.segments.map((segment) => segment.end)];
  return rebuiltPolyline(
    element,
    moveOrthogonalVertex(vertices, nodeIndex, point),
  );
}

/** Moves one Bézier handle and reapplies the line's continuity constraints. */
export function moveBezierHandle(
  element: LineElement,
  handle: BezierHandle,
  point: Point,
): LineElement {
  if (element.pathKind === 'straight') {
    return handle.kind === 'node'
      ? moveStraightHandle(element, handle.nodeIndex, point)
      : element;
  }
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
  point = pointInElementFrame(point, shape, camera);
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
/**
 * The rectangle the editor draws its chrome around, and the angle it sits at.
 *
 * One selected element gives its own upright bounds and its own angle, so the
 * box and every handle turn with it. Several elements have no single angle
 * between them, so the frame is the upright rectangle enclosing all of them as
 * drawn, and stays at zero.
 *
 * Everything that positions chrome reads this, which is what keeps the box, the
 * eight resize handles and the rotation handle from disagreeing about where the
 * selection is.
 */
export interface SelectionFrame {
  bounds: Bounds;
  center: Point;
  rotation: number;
}

/** The frame for a selection, or `null` when there is nothing to draw around. */
export function selectionFrame(
  elements: readonly BoardElement[],
): SelectionFrame | null {
  const only = elements.length === 1 ? elements[0] : undefined;
  if (only !== undefined) {
    const bounds = elementBounds(only);
    return {
      bounds,
      center: elementRotationCenter(only),
      rotation: elementRotation(only),
    };
  }
  const enclosing =
    elements.length === 0
      ? null
      : boundsForPoints(
          elements.flatMap((element) => {
            const turned = rotatedElementBounds(element);
            return [
              { x: turned.x, y: turned.y },
              { x: turned.x + turned.width, y: turned.y + turned.height },
            ];
          }),
        );
  if (enclosing === null) return null;
  return {
    bounds: enclosing,
    center: {
      x: enclosing.x + enclosing.width / 2,
      y: enclosing.y + enclosing.height / 2,
    },
    rotation: 0,
  };
}

/** The eight resize anchors of a frame, in world coordinates, already turned. */
export function frameHandlePoints(
  frame: SelectionFrame,
): [ResizeHandle, Point][] {
  const { x, y, width, height } = frame.bounds;
  const local: [ResizeHandle, Point][] = [
    ['north-west', { x, y }],
    ['north', { x: x + width / 2, y }],
    ['north-east', { x: x + width, y }],
    ['east', { x: x + width, y: y + height / 2 }],
    ['south-east', { x: x + width, y: y + height }],
    ['south', { x: x + width / 2, y: y + height }],
    ['south-west', { x, y: y + height }],
    ['west', { x, y: y + height / 2 }],
  ];
  return local.map(([handle, point]) => [
    handle,
    rotatePoint(point, frame.center, frame.rotation),
  ]);
}

/**
 * Whether a selection may be turned.
 *
 * One element that cannot turn is enough to withhold the handle from the whole
 * selection: turning a group moves every member around a shared centre, so a
 * block that stays upright would be carried away from the writing it belongs
 * to while the others turned around it.
 */
export function selectionCanRotate(elements: readonly BoardElement[]): boolean {
  return elements.length > 0 && elements.every(canRotateElement);
}

/** Screen-space gap between the selection's top edge and the rotation handle. */
const ROTATION_HANDLE_GAP_PX = 22;

/** Screen radius within which a press counts as grabbing the rotation handle. */
const ROTATION_HANDLE_RADIUS_PX = 9;

/**
 * Where the rotation handle sits on screen, or `null` when there is nothing to
 * rotate.
 *
 * Above the top edge, clear of the eight resize handles, which is where people
 * expect it and — more usefully — where it cannot be confused with them. The
 * drawing code and the hit test both call this, so the handle a reader sees is
 * always the handle they can grab.
 */
export function rotationHandlePoint(
  elements: readonly BoardElement[],
  camera: Camera,
): Point | null {
  if (!selectionCanRotate(elements)) return null;
  const frame = selectionFrame(elements);
  if (frame === null) return null;
  const { bounds } = frame;
  if (bounds.width < 3 || bounds.height < 3) return null;
  const topLeft = worldToScreen(bounds, camera);
  const upright = {
    x: topLeft.x + (bounds.width * camera.zoom) / 2,
    y: topLeft.y - 4 - ROTATION_HANDLE_GAP_PX,
  };
  // Placed above the frame's own top edge, then turned with it, so the handle
  // stays over the same edge of the shape however far it has been rotated.
  return frame.rotation === 0
    ? upright
    : rotatePoint(upright, worldToScreen(frame.center, camera), frame.rotation);
}

/** Reports whether a screen point grabs the rotation handle. */
export function isRotationHandleAt(
  point: Point,
  elements: readonly BoardElement[],
  camera: Camera,
): boolean {
  const handle = rotationHandlePoint(elements, camera);
  return (
    handle !== null &&
    Math.hypot(point.x - handle.x, point.y - handle.y) <=
      ROTATION_HANDLE_RADIUS_PX
  );
}

/**
 * Turns a screen point into the frame's own upright coordinates.
 *
 * Rotation is about the frame's centre and the camera scales uniformly, so
 * undoing the turn about that centre on screen is the same as undoing it in the
 * world. Doing this first lets every corner and edge test below stay the plain
 * axis-aligned arithmetic it always was.
 */
function pointInFrame(
  point: Point,
  frame: SelectionFrame,
  camera: Camera,
): Point {
  if (frame.rotation === 0) return point;
  return rotatePoint(
    point,
    worldToScreen(frame.center, camera),
    -frame.rotation,
  );
}

/** Screen direction each resize anchor faces on an upright frame, in degrees. */
const RESIZE_HANDLE_ANGLES: [ResizeHandle, number][] = [
  ['east', 0],
  ['south-east', 45],
  ['south', 90],
  ['south-west', 135],
  ['west', 180],
  ['north-west', 225],
  ['north', 270],
  ['north-east', 315],
];

/**
 * The handle whose upright cursor matches where this one now points.
 *
 * Cursors are chosen by handle name, and those names describe an upright frame.
 * On a shape turned a quarter turn its east handle is at the bottom of the
 * screen and drags vertically, so showing the east-west cursor would point
 * across the direction the handle actually moves. Naming the handle it now
 * resembles keeps the cursor honest without a second cursor vocabulary.
 */
export function visualResizeHandle(
  handle: ResizeHandle,
  rotation: number,
): ResizeHandle {
  if (rotation === 0) return handle;
  const natural = RESIZE_HANDLE_ANGLES.find(([name]) => name === handle)?.[1];
  if (natural === undefined) return handle;
  const turned = (((natural + rotation) % 360) + 360) % 360;
  let closest = handle;
  let smallest = Number.POSITIVE_INFINITY;
  for (const [name, angle] of RESIZE_HANDLE_ANGLES) {
    // Shortest way round the circle, so 350 and 10 degrees count as 20 apart
    // rather than 340.
    const apart = Math.abs(((turned - angle + 540) % 360) - 180);
    if (apart < smallest) {
      smallest = apart;
      closest = name;
    }
  }
  return closest;
}

export function findResizeHandle(
  point: Point,
  elements: readonly BoardElement[],
  camera: Camera,
): ResizeHandle | null {
  const frame = selectionFrame(elements);
  if (frame === null) return null;
  const bounds = frame.bounds;
  if (bounds.width < 3 || bounds.height < 3) return null;
  point = pointInFrame(point, frame, camera);
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
      const xChanged = Math.abs(scaleX - 1) > 1e-9;
      const yChanged = Math.abs(scaleY - 1) > 1e-9;
      const requestedScale =
        xChanged && !yChanged
          ? scaleX
          : yChanged && !xChanged
            ? scaleY
            : Math.min(scaleX, scaleY);
      const scale = Math.max(0.2, requestedScale);
      // Equations scale uniformly. Transform their center through the selected
      // frame, then grow around that center so a horizontal or vertical edge
      // handle changes size without making the perpendicular edge jump.
      const center = {
        x: to.x + (element.x + element.width / 2 - from.x) * scaleX,
        y: to.y + (element.y + element.height / 2 - from.y) * scaleY,
      };
      const width = element.width * scale;
      const height = element.height * scale;
      return {
        ...element,
        fontSize: Math.max(12, element.fontSize * scale),
        height,
        sourceFontSize: Math.max(1, equationSourceFontSize(element) * scale),
        width,
        x: center.x - width / 2,
        y: center.y - height / 2,
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
