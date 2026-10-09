/**
 * Creates valid initial records for every drawing tool from one pointer origin
 * and style template. IDs and creator identity are assigned exactly once here.
 */
import {
  EQUATION_SOURCE_FONT_SIZE_OFFSET,
  SHAPE_HATCH_SPACING,
  fitBezierSegments,
  fitOrthogonalSegments,
  linePathVertices,
  MAX_FREEHAND_POINTS,
  normalizeShape,
  polylineCubicSegments,
  simplifiedPointIndexes,
  type BezierFitOptions,
  type BoardElement,
  type ElementStyle,
  type FreehandElement,
  type FillStyle,
  type LineArrowheads,
  type LineElement,
  type PathKind,
  type Point,
  type ShapeKind,
  type SplineContinuity,
} from '@chalkboard/shared';

import { randomUuid } from '../../randomUuid';
import { DEFAULT_LINE_SPACING, DEFAULT_TEXT_SIZE } from './limits';

function requiredDrawingValue<Value>(
  value: Value | undefined,
  description: string,
): Value {
  if (value === undefined) {
    throw new Error(`Drawing invariant failed: missing ${description}`);
  }
  return value;
}

interface ElementCreationOptions {
  arrowheads?: LineArrowheads;
  cornerRadius?: number;
  ellipseEndAngle?: number;
  ellipseStartAngle?: number;
  fillSpacing?: number;
  fillStyle?: FillStyle;
  lineSpacing?: number;
  pathKind?: PathKind;
  shapeKind?: ShapeKind;
  splineContinuity?: SplineContinuity;
  sourceTextSize?: number;
  textSize?: number;
}

/** Creates a new element draft at a world point from the current tool/style policy. */
export function createElement(
  type: 'equation' | 'freehand' | 'line' | 'shape',
  start: Point,
  style: ElementStyle,
  options: ElementCreationOptions = {},
): BoardElement {
  const {
    arrowheads = 'none',
    cornerRadius = 0,
    ellipseEndAngle = 360,
    ellipseStartAngle = 0,
    fillSpacing = SHAPE_HATCH_SPACING,
    fillStyle = 'solid',
    lineSpacing = DEFAULT_LINE_SPACING,
    pathKind = 'straight',
    shapeKind = 'rectangle',
    splineContinuity = 'c1',
    textSize = DEFAULT_TEXT_SIZE,
    sourceTextSize = textSize - EQUATION_SOURCE_FONT_SIZE_OFFSET,
  } = options;
  const base = {
    ...style,
    createdBy: 'local',
    height: 0,
    id: randomUuid(),
    rotation: 0,
    width: 0,
    x: start.x,
    y: start.y,
  };

  if (type === 'equation') {
    return {
      ...base,
      fontSize: textSize,
      height: 42,
      lineSpacing,
      source: '',
      sourceFontSize: sourceTextSize,
      type,
      width: 32,
    };
  }
  if (type === 'line') {
    return {
      ...base,
      arrowheads,
      pathKind,
      segments: [],
      ...(pathKind === 'bezier' ? { splineContinuity } : {}),
      // Only orthogonal turns are rounded, so the radius is carried nowhere
      // else and a straight or spline path stays free of a dead field.
      ...(pathKind === 'orthogonal' && cornerRadius > 0
        ? { cornerRadius }
        : {}),
      type,
    };
  }
  if (type === 'freehand') {
    return { ...base, arrowheads, points: [{ x: 0, y: 0 }], type };
  }
  return {
    ...base,
    cornerRadius,
    ...(shapeKind === 'ellipse' &&
    (ellipseStartAngle !== 0 || ellipseEndAngle !== 360)
      ? { ellipseEndAngle, ellipseStartAngle }
      : {}),
    fillSpacing,
    fillStyle,
    shapeKind,
    type,
  };
}

/** Appends distance-filtered samples while enforcing the persisted point bound. */
export function appendFreehandSamples(
  points: readonly Point[],
  samples: readonly Point[],
  minimumDistance: number,
): Point[] {
  const next = [...points];
  for (const sample of samples) {
    if (next.length >= MAX_FREEHAND_POINTS) break;
    const previous = next.at(-1);
    if (
      previous !== undefined &&
      Math.hypot(sample.x - previous.x, sample.y - previous.y) < minimumDistance
    ) {
      continue;
    }
    next.push(sample);
  }
  return next;
}

function normalizedFreehand(
  element: FreehandElement,
  worldPoints: readonly Point[],
): FreehandElement {
  const minX = Math.min(...worldPoints.map(({ x }) => x));
  const minY = Math.min(...worldPoints.map(({ y }) => y));
  const maxX = Math.max(...worldPoints.map(({ x }) => x));
  const maxY = Math.max(...worldPoints.map(({ y }) => y));
  return {
    ...element,
    height: maxY - minY,
    points: worldPoints.map(({ x, y }) => ({ x: x - minX, y: y - minY })),
    width: maxX - minX,
    x: minX,
    y: minY,
  };
}

/** Rebounds a freehand draft around its complete world-space sample set. */
export function updateFreehandDrawing(
  element: FreehandElement,
  points: readonly Point[],
): FreehandElement {
  if (points.length === 0) return element;
  return normalizedFreehand(element, points);
}

function simplifyFreehandPoints(
  points: readonly Point[],
  tolerance: number,
): Point[] {
  return simplifiedPointIndexes(points, tolerance).map((index) =>
    requiredDrawingValue(points[index], 'retained freehand point'),
  );
}

/** Updates a drag-created draft with optional line/shape proportion constraints. */
export function updateDrawingElement(
  element: BoardElement,
  current: Point,
  { constrainProportions }: { constrainProportions: boolean },
): BoardElement {
  const width = current.x - element.x;
  const height = current.y - element.y;
  if (element.type === 'line') {
    let nextWidth = width;
    let nextHeight = height;
    if (constrainProportions) {
      const length = Math.hypot(width, height);
      const angle =
        Math.round(Math.atan2(height, width) / (Math.PI / 4)) * (Math.PI / 4);
      nextWidth = Math.cos(angle) * length;
      nextHeight = Math.sin(angle) * length;
    }
    return {
      ...element,
      height: nextHeight,
      segments: [
        {
          control1: { x: nextWidth / 3, y: nextHeight / 3 },
          control2: { x: (nextWidth * 2) / 3, y: (nextHeight * 2) / 3 },
          end: { x: nextWidth, y: nextHeight },
        },
      ],
      width: nextWidth,
    };
  }
  if (!constrainProportions || element.type !== 'shape') {
    return { ...element, height, width };
  }
  const heightRatio = element.shapeKind === 'triangle' ? Math.sqrt(3) / 2 : 1;
  const constrainedWidth = Math.max(
    Math.abs(width),
    Math.abs(height) / heightRatio,
  );
  return {
    ...element,
    height: Math.sign(height || 1) * constrainedWidth * heightRatio,
    width: Math.sign(width || 1) * constrainedWidth,
  };
}

/** Rebuilds an exact connected straight path from absolute world vertices. */
export function updateStraightDrawing(
  element: LineElement,
  points: readonly Point[],
): LineElement {
  const origin = points[0];
  if (origin === undefined) return element;
  const vertices = points.filter((point, index) => {
    const previous = points[index - 1];
    return (
      previous === undefined || point.x !== previous.x || point.y !== previous.y
    );
  });
  const end = vertices.at(-1) ?? origin;
  const line = { ...element };
  delete line.straightSegmented;
  return {
    ...line,
    height: end.y - origin.y,
    segments: polylineCubicSegments(vertices, origin),
    ...(vertices.length > 2 ? { straightSegmented: true as const } : {}),
    width: end.x - origin.x,
    x: origin.x,
    y: origin.y,
  };
}

/** Builds one temporary cubic segment per pointer interval without fitting. */
export function previewFreeDrawnPath(
  element: LineElement,
  points: readonly Point[],
): LineElement {
  const origin = points[0];
  if (origin === undefined) return element;
  const segments = polylineCubicSegments(points, origin);
  const end = segments.at(-1)?.end ?? { x: 0, y: 0 };
  return { ...element, height: end.y, segments, width: end.x };
}

/** Fits sampled pointer input into bounded cubic Bézier segments. */
export function updateBezierDrawing(
  element: LineElement,
  points: readonly Point[],
  options: BezierFitOptions,
): LineElement {
  const segments = fitBezierSegments(points, options);
  const end = segments.at(-1)?.end ?? { x: 0, y: 0 };
  return {
    ...element,
    height: end.y,
    segments,
    splineContinuity: options.continuity ?? 'c1',
    width: end.x,
  };
}

/** Fits sampled pointer input into connected horizontal/vertical segments. */
export function updateOrthogonalDrawing(
  element: LineElement,
  points: readonly Point[],
  tolerance: number,
): LineElement {
  const segments = fitOrthogonalSegments(points, tolerance);
  const end = segments.at(-1)?.end ?? { x: 0, y: 0 };
  return { ...element, height: end.y, segments, width: end.x };
}

/** Normalizes a completed draft or returns null when it is too small to retain. */
export function finalizeDrawing(element: BoardElement): BoardElement | null {
  if (element.type === 'freehand') {
    if (element.points.length < 2) return null;
    let length = 0;
    for (let index = 1; index < element.points.length; index += 1) {
      const previous = requiredDrawingValue(
        element.points[index - 1],
        'previous freehand point',
      );
      const point = requiredDrawingValue(
        element.points[index],
        'current freehand point',
      );
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
    }
    if (length < 3) return null;
    const simplified = simplifyFreehandPoints(element.points, 0.6);
    return normalizedFreehand(
      element,
      simplified.map(({ x, y }) => ({ x: element.x + x, y: element.y + y })),
    );
  }
  if (element.type === 'line') {
    if (element.pathKind === 'straight') {
      const vertices = linePathVertices(element);
      const length = vertices.slice(1).reduce((total, point, index) => {
        const previous = vertices[index];
        return previous === undefined
          ? total
          : total + Math.hypot(point.x - previous.x, point.y - previous.y);
      }, 0);
      return length < 3 ? null : element;
    }
    let previous = { x: 0, y: 0 };
    let length = 0;
    for (const segment of element.segments) {
      length +=
        Math.hypot(
          segment.control1.x - previous.x,
          segment.control1.y - previous.y,
        ) +
        Math.hypot(
          segment.control2.x - segment.control1.x,
          segment.control2.y - segment.control1.y,
        ) +
        Math.hypot(
          segment.end.x - segment.control2.x,
          segment.end.y - segment.control2.y,
        );
      previous = segment.end;
    }
    return length < 3 ? null : element;
  }
  if (element.type !== 'shape') return null;
  if (Math.abs(element.width) < 3 || Math.abs(element.height) < 3) return null;
  return normalizeShape(element);
}
