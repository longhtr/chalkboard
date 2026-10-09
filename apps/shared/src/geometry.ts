/**
 * Deterministic world-space geometry shared by rendering, interaction, export,
 * and persistence. This module never reads DOM, canvas, or device-pixel state.
 */
import {
  isFreehandElement,
  isLinearElement,
  isShapeElement,
  type BoardElement,
  type LineElement,
  type Point,
  type RectangleElement,
  type ShapeElement,
} from './elementSchema.js';
import {
  cubicPoint,
  distanceToSegment,
  polylineCubicSegments,
  simplifiedPointIndexes,
  strokeEndDirection,
} from './curveGeometry.js';
import {
  ellipseArcFillPoints,
  ellipseArcPoints,
  isFullEllipseArc,
  normalizedEllipseArc,
  shapePolygonPoints,
} from './shapeGeometry.js';

export { enforceBezierContinuity } from './bezierContinuity.js';
export {
  distanceToSegment,
  polylineCubicSegments,
  simplifiedPointIndexes,
  strokeEndDirection,
};

/** Maps world coordinates to the viewport without entering persisted geometry. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** Axis-aligned world rectangle; width and height may be negative before normalization. */
export interface Bounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

/** Projects a persisted world point through the current viewport camera. */
export function worldToScreen(point: Point, camera: Camera): Point {
  return {
    x: point.x * camera.zoom + camera.x,
    y: point.y * camera.zoom + camera.y,
  };
}

/** Reverses the camera transform for pointer and placement coordinates. */
export function screenToWorld(point: Point, camera: Camera): Point {
  return {
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom,
  };
}

/** Returns positive dimensions while preserving the represented rectangle. */
export function normalizeBounds(bounds: Bounds): Bounds {
  return {
    x: Math.min(bounds.x, bounds.x + bounds.width),
    y: Math.min(bounds.y, bounds.y + bounds.height),
    width: Math.abs(bounds.width),
    height: Math.abs(bounds.height),
  };
}

/** Returns the smallest world rectangle enclosing every supplied point. */
export function boundsForPoints(points: readonly Point[]): Bounds | null {
  if (points.length === 0) return null;
  const minX = Math.min(...points.map(({ x }) => x));
  const minY = Math.min(...points.map(({ y }) => y));
  const maxX = Math.max(...points.map(({ x }) => x));
  const maxY = Math.max(...points.map(({ y }) => y));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Returns canonical world bounds, including sampled curved line geometry. */
export function elementBounds(element: BoardElement): Bounds {
  if (element.type !== 'line') return normalizeBounds(element);
  return boundsForPoints(linePathPoints(element)) ?? normalizeBounds(element);
}

/**
 * The point an element turns around: the centre of its unrotated bounds.
 *
 * Rotation is stored as an angle and nothing else, so the centre has to be
 * derived the same way everywhere. Deriving it differently in two places would
 * make an element draw in one spot and answer clicks in another.
 */
/**
 * Whether an element turns at all.
 *
 * A mixed text block is HTML positioned over the canvas, not something the
 * renderer draws into a turned context, so it is always upright on screen
 * however its angle reads. Letting it carry one made the selection box, the
 * resize handles and the hit test drift away from writing that had not moved.
 * Everything that consumes an angle asks here instead of reading the field, so
 * a block that was turned before this existed answers clicks where it is drawn.
 */
export function canRotateElement(element: BoardElement): boolean {
  return element.type !== 'equation';
}

/** The angle an element is actually drawn at, which is zero when it cannot turn. */
export function elementRotation(element: BoardElement): number {
  return canRotateElement(element) ? element.rotation : 0;
}

export function elementRotationCenter(element: BoardElement): Point {
  const bounds = elementBounds(element);
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

/**
 * The upright rectangle enclosing an element after it has been turned.
 *
 * An element stores unrotated geometry plus an angle, so its stored bounds
 * describe where it would be if it were upright. Anything that has to enclose
 * what is actually on screen -- a selection box, a viewport cull, an export
 * canvas -- needs this instead.
 */
export function rotatedElementBounds(element: BoardElement): Bounds {
  const bounds = elementBounds(element);
  const rotation = elementRotation(element);
  if (rotation === 0) return bounds;
  const center = elementRotationCenter(element);
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  ].map((corner) => rotatePoint(corner, center, rotation));
  return boundsForPoints(corners) ?? bounds;
}

/** Turns a point around a centre by an angle in degrees. */
export function rotatePoint(
  point: Point,
  center: Point,
  degrees: number,
): Point {
  if (degrees === 0) return point;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return {
    x: center.x + x * cos - y * sin,
    y: center.y + x * sin + y * cos,
  };
}

/** Returns the smallest world rectangle enclosing every supplied element. */
export function selectionBounds(
  elements: readonly BoardElement[],
): Bounds | null {
  if (elements.length === 0) return null;

  const bounds = elements.map(elementBounds);
  const minX = Math.min(...bounds.map(({ x }) => x));
  const minY = Math.min(...bounds.map(({ y }) => y));
  const maxX = Math.max(...bounds.map(({ x, width }) => x + width));
  const maxY = Math.max(...bounds.map(({ y, height }) => y + height));

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The upright rectangle enclosing what a whole selection covers on screen.
 *
 * Like `selectionBounds`, but each element contributes the ground it covers
 * after its own turn. Anything sizing a canvas, a crop, or an overlay around a
 * selection wants this one; sizing from the stored boxes crops turned content.
 */
export function rotatedSelectionBounds(
  elements: readonly BoardElement[],
): Bounds | null {
  if (elements.length === 0) return null;
  const bounds = elements.map(rotatedElementBounds);
  const minX = Math.min(...bounds.map(({ x }) => x));
  const minY = Math.min(...bounds.map(({ y }) => y));
  const maxX = Math.max(...bounds.map(({ x, width }) => x + width));
  const maxY = Math.max(...bounds.map(({ y, height }) => y + height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Reports whether two normalized axis-aligned rectangles touch or overlap. */
export function boundsIntersect(first: Bounds, second: Bounds): boolean {
  const a = normalizeBounds(first);
  const b = normalizeBounds(second);
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

/** Tests a point against normalized bounds expanded by an optional world tolerance. */
export function pointInBounds(
  point: Point,
  bounds: Bounds,
  tolerance = 0,
): boolean {
  const normalized = normalizeBounds(bounds);
  return (
    point.x >= normalized.x - tolerance &&
    point.x <= normalized.x + normalized.width + tolerance &&
    point.y >= normalized.y - tolerance &&
    point.y <= normalized.y + normalized.height + tolerance
  );
}

/** Cubic Bézier segment with every control expressed in absolute world coordinates. */
export interface AbsoluteBezierSegment {
  control1: Point;
  control2: Point;
  end: Point;
  start: Point;
}

/** Canonical absolute geometry for a single line, straight polyline, or curve. */
export type LinePathGeometry =
  | { end: Point; kind: 'straight'; start: Point }
  | { kind: 'polyline'; points: Point[]; start: Point }
  | { kind: 'bezier'; segments: AbsoluteBezierSegment[]; start: Point };

/** Converts persisted origin-relative line geometry to absolute world geometry. */
export function linePathGeometry(element: LineElement): LinePathGeometry {
  const start = { x: element.x, y: element.y };
  const end = {
    x: element.x + element.width,
    y: element.y + element.height,
  };
  if (element.pathKind === 'straight') {
    return element.straightSegmented === true && element.segments.length > 1
      ? {
          kind: 'polyline',
          points: [
            start,
            ...element.segments.map((segment) => ({
              x: element.x + segment.end.x,
              y: element.y + segment.end.y,
            })),
          ],
          start,
        }
      : { end, kind: 'straight', start };
  }
  let segmentStart = start;
  const segments = element.segments.map((segment) => {
    const absolute = {
      control1: {
        x: element.x + segment.control1.x,
        y: element.y + segment.control1.y,
      },
      control2: {
        x: element.x + segment.control2.x,
        y: element.y + segment.control2.y,
      },
      end: {
        x: element.x + segment.end.x,
        y: element.y + segment.end.y,
      },
      start: segmentStart,
    };
    segmentStart = absolute.end;
    return absolute;
  });
  return { kind: 'bezier', segments, start };
}

export {
  bezierAccuracyTargetError,
  type BezierFitOptions,
  fitBezierSegments,
  MAX_BEZIER_FIT_SAMPLES,
  sampleBezierPoints,
} from './bezierFitting.js';

export {
  fitOrthogonalSegments,
  moveOrthogonalVertex,
} from './orthogonalFitting.js';

/**
 * World-space corner vertices of a path. Straight-run kinds keep their turns
 * exactly here, so handles, rounding, and export all read one source rather
 * than re-deriving corners from sampled curve points.
 */
export function linePathVertices(element: LineElement): Point[] {
  const geometry = linePathGeometry(element);
  if (geometry.kind === 'straight') return [geometry.start, geometry.end];
  if (geometry.kind === 'polyline') return geometry.points;
  return [geometry.start, ...geometry.segments.map((segment) => segment.end)];
}

/** Produces the canonical world-space polyline used by bounds and hit tests. */
export function linePathPoints(
  element: LineElement,
  samplesPerSegment = 16,
): Point[] {
  const geometry = linePathGeometry(element);
  if (geometry.kind === 'straight') return [geometry.start, geometry.end];
  if (geometry.kind === 'polyline') return geometry.points;
  const points: Point[] = [geometry.start];
  for (const segment of geometry.segments) {
    for (let index = 1; index <= samplesPerSegment; index += 1) {
      const t = index / samplesPerSegment;
      points.push(
        cubicPoint(
          segment.start,
          segment.control1,
          segment.control2,
          segment.end,
          t,
        ),
      );
    }
  }
  return points;
}

function pointInPolygon(point: Point, vertices: readonly Point[]): boolean {
  let inside = false;
  for (
    let index = 0, previousIndex = vertices.length - 1;
    index < vertices.length;
    previousIndex = index, index += 1
  ) {
    const current = vertices[index];
    const previous = vertices[previousIndex];
    if (current === undefined || previous === undefined) continue;
    const crosses =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonHitTest(
  point: Point,
  vertices: readonly Point[],
  tolerance: number,
): boolean {
  if (pointInPolygon(point, vertices)) return true;
  return vertices.some((vertex, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return (
      next !== undefined && distanceToSegment(point, vertex, next) <= tolerance
    );
  });
}

/**
 * Applies one top-level hit-test policy across element kinds. Tolerance remains
 * in world units; callers convert screen-sized affordances through camera zoom.
 */
export function hitTestElement(
  element: BoardElement,
  rawPoint: Point,
  tolerance = 6,
): boolean {
  // A rotated element is drawn by turning the canvas, not by moving its stored
  // geometry, so the geometry below still describes the unrotated shape. Turn
  // the click back by the same angle and every test after this stays honest.
  const rotation = elementRotation(element);
  const point =
    rotation === 0
      ? rawPoint
      : rotatePoint(rawPoint, elementRotationCenter(element), -rotation);
  if (
    element.type === 'equation' ||
    element.type === 'image' ||
    element.type === 'rectangle'
  ) {
    return pointInBounds(point, elementBounds(element), tolerance);
  }

  if (isShapeElement(element)) {
    const bounds = elementBounds(element);
    if (element.shapeKind === 'rectangle') {
      return pointInBounds(point, bounds, tolerance);
    }
    const center = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    if (element.shapeKind === 'ellipse') {
      const range = normalizedEllipseArc(
        element.ellipseStartAngle,
        element.ellipseEndAngle,
      );
      if (!isFullEllipseArc(range)) {
        const arc = ellipseArcPoints(bounds, range);
        if (element.backgroundColor !== 'transparent') {
          return polygonHitTest(
            point,
            ellipseArcFillPoints(bounds, range, element.strokeWidth / 2),
            tolerance,
          );
        }
        return arc.slice(1).some((current, index) => {
          const previous = arc[index];
          return (
            previous !== undefined &&
            distanceToSegment(point, previous, current) <= tolerance
          );
        });
      }
      const radiusX = bounds.width / 2 + tolerance;
      const radiusY = bounds.height / 2 + tolerance;
      if (radiusX <= 0 || radiusY <= 0) return false;
      return (
        ((point.x - center.x) / radiusX) ** 2 +
          ((point.y - center.y) / radiusY) ** 2 <=
        1
      );
    }
    const vertices = shapePolygonPoints(element.shapeKind, bounds, {
      trapezoidTopLeft: element.trapezoidTopLeft,
      trapezoidTopRight: element.trapezoidTopRight,
    });
    return vertices !== null && polygonHitTest(point, vertices, tolerance);
  }

  if (element.type === 'line') {
    const points = linePathPoints(element);
    return points.slice(1).some((current, index) => {
      const previous = points[index];
      return (
        previous !== undefined &&
        distanceToSegment(point, previous, current) <= tolerance
      );
    });
  }

  if (isLinearElement(element)) {
    return (
      distanceToSegment(
        point,
        { x: element.x, y: element.y },
        {
          x: element.x + element.width,
          y: element.y + element.height,
        },
      ) <= tolerance
    );
  }

  if (isFreehandElement(element)) {
    for (let index = 1; index < element.points.length; index += 1) {
      const previous = element.points[index - 1];
      const current = element.points[index];
      if (previous === undefined || current === undefined) continue;
      if (
        distanceToSegment(
          point,
          { x: element.x + previous.x, y: element.y + previous.y },
          { x: element.x + current.x, y: element.y + current.y },
        ) <= tolerance
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Returns a translated semantic element without mutating local path coordinates.
 * Shape normalization remains the responsibility of the corresponding helper.
 */
export function translateElement(
  element: BoardElement,
  delta: Point,
): BoardElement {
  return {
    ...element,
    x: element.x + delta.x,
    y: element.y + delta.y,
  };
}

/** Converts a possibly reverse-drawn rectangle to positive world bounds. */
export function normalizeRectangle(
  element: RectangleElement,
): RectangleElement {
  const bounds = normalizeBounds(element);
  return { ...element, ...bounds };
}

/** Converts a possibly reverse-drawn shape to positive world bounds. */
export function normalizeShape(element: ShapeElement): ShapeElement {
  const bounds = normalizeBounds(element);
  return { ...element, ...bounds };
}
