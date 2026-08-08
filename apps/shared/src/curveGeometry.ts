/** Small allocation-free geometry primitives shared by Bézier and orthogonal fitters. */
import type { BezierSegment, Point } from './elementSchema.js';

/** Returns the shortest distance from a point to a finite line segment. */
export function distanceToSegment(
  point: Point,
  start: Point,
  end: Point,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  const closestX = start.x + projection * dx;
  const closestY = start.y + projection * dy;
  return Math.hypot(point.x - closestX, point.y - closestY);
}

/** Returns the shortest distance from a point to the infinite endpoint line. */
export function perpendicularDistance(
  point: Point,
  start: Point,
  end: Point,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  return (
    Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) /
    Math.hypot(dx, dy)
  );
}

/** Returns ordered point indexes retained by Ramer-Douglas-Peucker simplification. */
export function simplifiedPointIndexes(
  points: readonly Point[],
  tolerance: number,
): number[] {
  if (points.length <= 2) return points.map((_, index) => index);
  const retained = new Set([0, points.length - 1]);
  const ranges: Array<[number, number]> = [[0, points.length - 1]];
  while (ranges.length > 0) {
    const range = ranges.pop();
    if (range === undefined) break;
    const [startIndex, endIndex] = range;
    const start = points[startIndex];
    const end = points[endIndex];
    if (start === undefined || end === undefined) continue;
    let furthestIndex = -1;
    let furthestDistance = 0;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const point = points[index];
      if (point === undefined) continue;
      const distance = perpendicularDistance(point, start, end);
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthestIndex = index;
      }
    }
    if (furthestIndex < 0 || furthestDistance <= tolerance) continue;
    retained.add(furthestIndex);
    ranges.push([startIndex, furthestIndex], [furthestIndex, endIndex]);
  }
  return [...retained].sort((first, second) => first - second);
}

/**
 * Direction at one end of a sampled stroke, taken from the first neighbour far
 * enough away to give a stable angle. Pointer sampling repeats and nearly
 * repeats points where a stroke starts and stops, and those yield no tangent.
 * Canvas rendering and vector export share this so an exported arrowhead
 * cannot point somewhere the on-screen one does not.
 */
export function strokeEndDirection(
  points: readonly Point[],
  fromEnd: boolean,
): Point | null {
  const tipIndex = fromEnd ? points.length - 1 : 0;
  const tip = points[tipIndex];
  if (tip === undefined) return null;
  const step = fromEnd ? -1 : 1;
  for (
    let index = tipIndex + step;
    index >= 0 && index < points.length;
    index += step
  ) {
    const point = points[index];
    if (point === undefined) continue;
    const direction = { x: tip.x - point.x, y: tip.y - point.y };
    if (Math.hypot(direction.x, direction.y) > 1e-6) return direction;
  }
  return null;
}

/** Evaluates one cubic Bézier segment at its local parameter. */
export function cubicPoint(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  t: number,
): Point {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse * inverse * t * control1.x +
      3 * inverse * t * t * control2.x +
      t ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse * inverse * t * control1.y +
      3 * inverse * t * t * control2.y +
      t ** 3 * end.y,
  };
}

/** Maps a point range to normalized cumulative chord lengths. */
export function chordParameters(
  points: readonly Point[],
  startIndex: number,
  endIndex: number,
): number[] {
  const parameters = [0];
  let length = 0;
  for (let index = startIndex + 1; index <= endIndex; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (previous === undefined || point === undefined) continue;
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    parameters.push(length);
  }
  if (length <= Number.EPSILON) {
    return parameters.map((_, index) => index / (parameters.length - 1));
  }
  return parameters.map((distance) => distance / length);
}

/**
 * Rewrites a polyline as cubic segments positioned relative to `origin`, which
 * is the element's own anchor and need not be the polyline's first point.
 * Placing both controls on the chord thirds makes each cubic draw exactly as the
 * straight edge it replaces, so callers can emit corners without leaving the
 * cubic representation the rest of the path pipeline expects.
 */
export function polylineCubicSegments(
  points: readonly Point[],
  origin: Point,
): BezierSegment[] {
  const relative = (point: Point): Point => ({
    x: point.x - origin.x,
    y: point.y - origin.y,
  });
  return points.slice(1).flatMap((end, index) => {
    const start = points[index];
    if (start === undefined) return [];
    return [
      {
        control1: relative({
          x: start.x + (end.x - start.x) / 3,
          y: start.y + (end.y - start.y) / 3,
        }),
        control2: relative({
          x: start.x + (2 * (end.x - start.x)) / 3,
          y: start.y + (2 * (end.y - start.y)) / 3,
        }),
        end: relative(end),
      },
    ];
  });
}

/**
 * Sums the squared distance between a cubic and the samples it was fitted to.
 * Every fitter scores candidates this way, so the comparison stays identical
 * across them and their costs remain directly comparable.
 */
export function cubicFitCost(
  points: readonly Point[],
  parameters: readonly number[],
  startIndex: number,
  endIndex: number,
  cubic: { control1: Point; control2: Point; end: Point; start: Point },
): number {
  let cost = 0;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const point = points[index];
    const position = parameters[index - startIndex];
    if (point === undefined || position === undefined) continue;
    const fitted = cubicPoint(
      cubic.start,
      cubic.control1,
      cubic.control2,
      cubic.end,
      position,
    );
    cost += (fitted.x - point.x) ** 2 + (fitted.y - point.y) ** 2;
  }
  return cost;
}
