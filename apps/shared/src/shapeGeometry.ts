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

/** Lower bound offered by both circular ellipse-angle controls. */
export const MIN_ELLIPSE_ANGLE = 0;
/** Upper bound offered by both circular ellipse-angle controls. */
export const MAX_ELLIPSE_ANGLE = 360;
/** Default start of a full ellipse arc, measured clockwise from its right edge. */
export const DEFAULT_ELLIPSE_START_ANGLE = 0;
/** Default end of a full ellipse arc. */
export const DEFAULT_ELLIPSE_END_ANGLE = 360;

export interface EllipseArcRange {
  endAngle: number;
  startAngle: number;
}

/** Clamps an ellipse's persisted degree range to one non-empty clockwise arc. */
export function normalizedEllipseArc(
  startAngle = DEFAULT_ELLIPSE_START_ANGLE,
  endAngle = DEFAULT_ELLIPSE_END_ANGLE,
): EllipseArcRange {
  const finiteStart = Number.isFinite(startAngle)
    ? startAngle
    : DEFAULT_ELLIPSE_START_ANGLE;
  const finiteEnd = Number.isFinite(endAngle)
    ? endAngle
    : DEFAULT_ELLIPSE_END_ANGLE;
  const start = Math.min(
    MAX_ELLIPSE_ANGLE,
    Math.max(MIN_ELLIPSE_ANGLE, finiteStart),
  );
  const end = Math.min(
    MAX_ELLIPSE_ANGLE,
    Math.max(MIN_ELLIPSE_ANGLE, finiteEnd),
  );
  if (start !== end) return { endAngle: end, startAngle: start };
  // Equal normalized endpoints would be an invisible zero-length arc. Preserve
  // a one-degree clockwise arc instead; full circles use 0°–360°.
  return {
    endAngle: start === MAX_ELLIPSE_ANGLE ? 1 : start + 1,
    startAngle: start,
  };
}

/** Clockwise sweep represented by two circular endpoints. */
export function ellipseArcSweep(range: EllipseArcRange): number {
  const difference = range.endAngle - range.startAngle;
  if (Math.abs(difference) >= 360) return 360;
  return ((difference % 360) + 360) % 360;
}

/** Whether an angle range represents the complete ellipse rather than an arc. */
export function isFullEllipseArc(range: EllipseArcRange): boolean {
  return ellipseArcSweep(range) === 360;
}

/** Samples only the visible circumference between an ellipse's two angles. */
export function ellipseArcPoints(
  bounds: ShapeBounds,
  range: EllipseArcRange,
): Point[] {
  if (isFullEllipseArc(range)) {
    return radialPolygonPoints(bounds, ELLIPSE_FILL_SEGMENTS);
  }
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const sweep = ellipseArcSweep(range);
  const segmentCount = Math.max(
    2,
    Math.ceil((ELLIPSE_FILL_SEGMENTS * sweep) / 360),
  );
  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const degrees =
      range.startAngle + (sweep * index) / Math.max(1, segmentCount);
    const radians = (degrees * Math.PI) / 180;
    return {
      x: center.x + Math.cos(radians) * (bounds.width / 2),
      y: center.y + Math.sin(radians) * (bounds.height / 2),
    };
  });
}

/**
 * Fill polygon for an arc, extended beneath its rounded endpoint caps.
 *
 * The closing boundary remains an un-stroked direct chord. Extending that
 * chord outward by half the outline width prevents the background from showing
 * through beside a round cap while preserving the visibly open arc stroke.
 */
export function ellipseArcFillPoints(
  bounds: ShapeBounds,
  range: EllipseArcRange,
  chordExtension = 0,
): Point[] {
  const arc = ellipseArcPoints(bounds, range);
  if (isFullEllipseArc(range) || !(chordExtension > 0)) return arc;
  const start = arc[0];
  const end = arc.at(-1);
  const middle = arc[Math.floor(arc.length / 2)];
  if (start === undefined || end === undefined || middle === undefined) {
    return arc;
  }
  const chordMiddle = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
  // The middle of the sampled arc points into the filled segment. Moving in
  // the opposite direction puts the closing edge beneath the outer cap edge.
  const outward = {
    x: chordMiddle.x - middle.x,
    y: chordMiddle.y - middle.y,
  };
  const length = Math.hypot(outward.x, outward.y);
  if (length <= 1e-9) return arc;
  const offset = {
    x: (outward.x / length) * chordExtension,
    y: (outward.y / length) * chordExtension,
  };
  return [
    ...arc,
    { x: end.x + offset.x, y: end.y + offset.y },
    { x: start.x + offset.x, y: start.y + offset.y },
  ];
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
    ellipseEndAngle?: number | undefined;
    ellipseStartAngle?: number | undefined;
    strokeWidth?: number | undefined;
    trapezoidTopLeft?: number | undefined;
    trapezoidTopRight?: number | undefined;
  } = {},
): Point[] {
  if (kind === 'ellipse') {
    const range = normalizedEllipseArc(
      options.ellipseStartAngle,
      options.ellipseEndAngle,
    );
    // Filling an open arc closes it with one un-stroked endpoint chord. Its
    // slight outward extension sits beneath the arc's rounded endpoint caps.
    return ellipseArcFillPoints(bounds, range, (options.strokeWidth ?? 0) / 2);
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

/**
 * Rounds the interior turns of an open polyline, leaving both endpoints sharp.
 *
 * Unlike a closed polygon, the first and last vertices terminate the path and
 * have nothing to round against, so they are returned degenerate (entry and
 * exit both at the vertex). Every corner's inset is capped at half the shorter
 * adjoining run so neighbouring arcs can never overlap or invert, which is what
 * keeps a large radius on a short run from folding the path back on itself.
 */
export function roundedPolylineCorners(
  points: readonly Point[],
  radius: number,
): RoundedCorner[] {
  return points.map((vertex, index) => {
    const previous = points[index - 1];
    const next = points[index + 1];
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
