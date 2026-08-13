/**
 * Produces canonical world-space outlines for shapes whose vertices are not
 * represented directly in persisted element records.
 */
import type { FillStyle, Point, ShapeKind } from './elementSchema.js';

interface ShapeBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

/** Places alternating outer/inner vertices around the ellipse defined by bounds. */
function radialPolygonPoints(
  bounds: ShapeBounds,
  pointCount: number,
  innerRadius = 1,
): Point[] {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return Array.from({ length: pointCount }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / pointCount;
    const radius = index % 2 === 0 ? 1 : innerRadius;
    return {
      x: centerX + Math.cos(angle) * (bounds.width / 2) * radius,
      y: centerY + Math.sin(angle) * (bounds.height / 2) * radius,
    };
  });
}

/** Default normalized horizontal position of the trapezoid's top-left corner. */
export const DEFAULT_TRAPEZOID_TOP_LEFT = 0.2;
/** Default normalized horizontal position of the trapezoid's top-right corner. */
export const DEFAULT_TRAPEZOID_TOP_RIGHT = 0.8;
/** Smallest allowed top-edge width as a fraction of total shape width. */
export const MIN_TRAPEZOID_TOP_EDGE_RATIO = 0.1;

/** Clamps trapezoid top corners while preserving the minimum top-edge width. */
export function normalizedTrapezoidTop(
  topLeft = DEFAULT_TRAPEZOID_TOP_LEFT,
  topRight = DEFAULT_TRAPEZOID_TOP_RIGHT,
): { left: number; right: number } {
  const left = Math.max(0, Math.min(1, topLeft));
  const right = Math.max(0, Math.min(1, topRight));
  if (right - left >= MIN_TRAPEZOID_TOP_EDGE_RATIO) return { left, right };
  return {
    left: Math.max(0, Math.min(left, 1 - MIN_TRAPEZOID_TOP_EDGE_RATIO)),
    right: Math.min(1, Math.max(right, left + MIN_TRAPEZOID_TOP_EDGE_RATIO)),
  };
}

/** Returns clockwise trapezoid vertices for normalized top-corner positions. */
export function trapezoidPoints(
  bounds: ShapeBounds,
  topLeft = DEFAULT_TRAPEZOID_TOP_LEFT,
  topRight = DEFAULT_TRAPEZOID_TOP_RIGHT,
): Point[] {
  const top = normalizedTrapezoidTop(topLeft, topRight);
  return [
    { x: bounds.x + bounds.width * top.left, y: bounds.y },
    { x: bounds.x + bounds.width * top.right, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];
}

/** World-space distance between adjacent hatch lines by default. */
export const SHAPE_HATCH_SPACING = 8;
/**
 * Tightest selectable gap. It stays wider than the heaviest hatch line so the
 * densest fill is still a readable pattern instead of a solid block of ink.
 */
export const MIN_SHAPE_FILL_SPACING = 4;
/** Widest selectable gap, matching the grid's own spacing ceiling. */
export const MAX_SHAPE_FILL_SPACING = 100;

/**
 * Hatch weight tracks the outline: a hairline outline keeps a hairline hatch,
 * and anything heavier gets a hatch heavy enough to read against it. Shared so
 * the canvas and the vector export cannot draw the fill at different weights.
 */
export function shapeHatchStrokeWidth(strokeWidth: number): number {
  return strokeWidth <= 1 ? 1 : 2;
}

/**
 * Clamps a requested gap into the selectable range. Out-of-range and non-finite
 * values are clamped rather than rejected, because this runs on every rendered
 * frame and a bad number must not stop a board from drawing.
 */
export function shapeHatchSpacing(spacing = SHAPE_HATCH_SPACING): number {
  const requested = Number.isFinite(spacing) ? spacing : SHAPE_HATCH_SPACING;
  return Math.min(
    MAX_SHAPE_FILL_SPACING,
    Math.max(MIN_SHAPE_FILL_SPACING, requested),
  );
}
/** Hatch direction; cross-hatch adds the perpendicular pass. */
export const SHAPE_HATCH_ANGLE = Math.PI / 4;
const ELLIPSE_FILL_SEGMENTS = 64;
const CORNER_FILL_SEGMENTS = 6;
// Pathological bounds with a small spacing would otherwise emit unbounded work.
const MAX_HATCH_LINES = 2_048;

function rotatePoint(point: Point, cosine: number, sine: number): Point {
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  };
}

/**
 * One vertex replaced by the rounded join both renderers draw: the straight run
 * ends at `entry`, and a quadratic through `vertex` resumes the outline at
 * `exit`. Kept here so the canvas tracer, the SVG writer, and the fill sampler
 * cannot round corners three slightly different ways.
 */
export interface RoundedCorner {
  entry: Point;
  exit: Point;
  vertex: Point;
}

/**
 * Splits every vertex into its rounded join. The radius is capped at half of
 * each adjacent edge so neighbouring corners cannot consume the same edge.
 */
export function roundedPolygonCorners(
  points: readonly Point[],
  radius: number,
): RoundedCorner[] {
  return points.map((vertex, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    if (previous === undefined || next === undefined) {
      return { entry: vertex, exit: vertex, vertex };
    }
    const previousLength = Math.hypot(
      previous.x - vertex.x,
      previous.y - vertex.y,
    );
    const nextLength = Math.hypot(next.x - vertex.x, next.y - vertex.y);
    if (previousLength === 0 || nextLength === 0) {
      return { entry: vertex, exit: vertex, vertex };
    }
    const distance = Math.min(radius, previousLength / 2, nextLength / 2);
    return {
      entry: {
        x: vertex.x + ((previous.x - vertex.x) / previousLength) * distance,
        y: vertex.y + ((previous.y - vertex.y) / previousLength) * distance,
      },
      exit: {
        x: vertex.x + ((next.x - vertex.x) / nextLength) * distance,
        y: vertex.y + ((next.y - vertex.y) / nextLength) * distance,
      },
      vertex,
    };
  });
}

function quadraticPoint(
  from: Point,
  control: Point,
  to: Point,
  position: number,
): Point {
  const inverse = 1 - position;
  return {
    x:
      inverse * inverse * from.x +
      2 * inverse * position * control.x +
      position * position * to.x,
    y:
      inverse * inverse * from.y +
      2 * inverse * position * control.y +
      position * position * to.y,
  };
}

/** Samples the quadratic joins so a rounded polygon becomes fillable vertices. */
function roundedPolygonFillPoints(
  points: readonly Point[],
  radius: number,
): Point[] {
  const sampled: Point[] = [];
  for (const corner of roundedPolygonCorners(points, radius)) {
    for (let step = 0; step <= CORNER_FILL_SEGMENTS; step += 1) {
      sampled.push(
        quadraticPoint(
          corner.entry,
          corner.vertex,
          corner.exit,
          step / CORNER_FILL_SEGMENTS,
        ),
      );
    }
  }
  return sampled;
}

/**
 * Samples a rounded rectangle. Rectangles round with true circular arcs in both
 * renderers (`roundRect` and `rx`), not the quadratic joins polygons use, so the
 * arc is reproduced here rather than approximated.
 */
function roundedRectangleFillPoints(
  bounds: ShapeBounds,
  radius: number,
): Point[] {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const inset = Math.min(
    Math.max(0, radius),
    bounds.width / 2,
    bounds.height / 2,
  );
  if (inset <= 0) {
    return [
      { x: bounds.x, y: bounds.y },
      { x: right, y: bounds.y },
      { x: right, y: bottom },
      { x: bounds.x, y: bottom },
    ];
  }
  // Clockwise from the top-right corner, matching the outline's winding.
  const corners = [
    { centerX: right - inset, centerY: bounds.y + inset, start: -Math.PI / 2 },
    { centerX: right - inset, centerY: bottom - inset, start: 0 },
    { centerX: bounds.x + inset, centerY: bottom - inset, start: Math.PI / 2 },
    { centerX: bounds.x + inset, centerY: bounds.y + inset, start: Math.PI },
  ];
  const sampled: Point[] = [];
  for (const corner of corners) {
    for (let step = 0; step <= CORNER_FILL_SEGMENTS; step += 1) {
      const angle =
        corner.start + (step / CORNER_FILL_SEGMENTS) * (Math.PI / 2);
      sampled.push({
        x: corner.centerX + Math.cos(angle) * inset,
        y: corner.centerY + Math.sin(angle) * inset,
      });
    }
  }
  return sampled;
}

/**
 * Returns vertices enclosing any shape kind, sampling curves and rounded
 * corners, so area operations such as fill patterns treat every shape uniformly
 * and stay within the outline that is actually drawn.
 */
export function shapeFillPolygon(
  kind: ShapeKind,
  bounds: ShapeBounds,
  options: {
    cornerRadius?: number | undefined;
    trapezoidTopLeft?: number | undefined;
    trapezoidTopRight?: number | undefined;
  } = {},
): Point[] {
  if (kind === 'ellipse') {
    return radialPolygonPoints(bounds, ELLIPSE_FILL_SEGMENTS);
  }
  const radius = Math.max(0, options.cornerRadius ?? 0);
  const polygon = shapePolygonPoints(kind, bounds, options);
  if (polygon === null) return roundedRectangleFillPoints(bounds, radius);
  return radius > 0 ? roundedPolygonFillPoints(polygon, radius) : polygon;
}

/**
 * Clips evenly spaced parallel lines to a polygon by scanline. Canvas rendering
 * and vector export share this so a hatched shape cannot look one way on screen
 * and another in an export; neither needs a clip path or a pattern definition.
 */
export function hatchSegments(
  vertices: readonly Point[],
  angleRadians: number,
  spacing: number,
): [Point, Point][] {
  if (vertices.length < 3 || !(spacing > 0)) return [];
  const forwardCosine = Math.cos(-angleRadians);
  const forwardSine = Math.sin(-angleRadians);
  const rotated = vertices.map((vertex) =>
    rotatePoint(vertex, forwardCosine, forwardSine),
  );
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (const vertex of rotated) {
    lowest = Math.min(lowest, vertex.y);
    highest = Math.max(highest, vertex.y);
  }
  if (!Number.isFinite(lowest) || !Number.isFinite(highest)) return [];

  const backCosine = Math.cos(angleRadians);
  const backSine = Math.sin(angleRadians);
  const segments: [Point, Point][] = [];
  let lines = 0;
  for (
    let scan = Math.ceil(lowest / spacing) * spacing;
    scan <= highest && lines < MAX_HATCH_LINES;
    scan += spacing, lines += 1
  ) {
    const crossings: number[] = [];
    for (let index = 0; index < rotated.length; index += 1) {
      const from = rotated[index];
      const to = rotated[(index + 1) % rotated.length];
      if (from === undefined || to === undefined) continue;
      // Half-open containment counts a shared vertex once, so the even-odd
      // pairing below cannot invert inside and outside.
      if (scan < Math.min(from.y, to.y) || scan >= Math.max(from.y, to.y)) {
        continue;
      }
      crossings.push(
        from.x + ((scan - from.y) / (to.y - from.y)) * (to.x - from.x),
      );
    }
    crossings.sort((first, second) => first - second);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const start = crossings[index];
      const end = crossings[index + 1];
      if (start === undefined || end === undefined || end - start < 1e-9) {
        continue;
      }
      segments.push([
        rotatePoint({ x: start, y: scan }, backCosine, backSine),
        rotatePoint({ x: end, y: scan }, backCosine, backSine),
      ]);
    }
  }
  return segments;
}

/** Returns every hatch line for one fill style; a solid fill needs none. */
export function shapeFillSegments(
  vertices: readonly Point[],
  fillStyle: FillStyle,
  spacing?: number,
): [Point, Point][] {
  if (fillStyle === 'solid') return [];
  const gap = shapeHatchSpacing(spacing);
  const primary = hatchSegments(vertices, SHAPE_HATCH_ANGLE, gap);
  if (fillStyle === 'hachure') return primary;
  return [
    ...primary,
    ...hatchSegments(vertices, SHAPE_HATCH_ANGLE + Math.PI / 2, gap),
  ];
}

/** Returns canonical vertices for polygonal shapes; curved/rectangular shapes return null. */
export function shapePolygonPoints(
  kind: ShapeKind,
  bounds: ShapeBounds,
  options: {
    trapezoidTopLeft?: number | undefined;
    trapezoidTopRight?: number | undefined;
  } = {},
): Point[] | null {
  if (kind === 'triangle') {
    return [
      { x: bounds.x + bounds.width / 2, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height },
    ];
  }
  if (kind === 'diamond') {
    return [
      { x: bounds.x + bounds.width / 2, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height / 2 },
    ];
  }
  if (kind === 'pentagon') return radialPolygonPoints(bounds, 5);
  if (kind === 'hexagon') {
    return [
      { x: bounds.x + bounds.width * 0.25, y: bounds.y },
      { x: bounds.x + bounds.width * 0.75, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
      { x: bounds.x + bounds.width * 0.75, y: bounds.y + bounds.height },
      { x: bounds.x + bounds.width * 0.25, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height / 2 },
    ];
  }
  if (kind === 'trapezoid') {
    return trapezoidPoints(
      bounds,
      options.trapezoidTopLeft,
      options.trapezoidTopRight,
    );
  }
  if (kind === 'parallelogram') {
    return [
      { x: bounds.x + bounds.width * 0.2, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x + bounds.width * 0.8, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height },
    ];
  }
  if (kind === 'star') return radialPolygonPoints(bounds, 10, 0.45);
  return null;
}
