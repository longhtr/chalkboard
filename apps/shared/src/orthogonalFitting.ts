/**
 * Fits pointer samples to bounded horizontal/vertical paths. Samples are first
 * normalized, then candidate corners are compared in world space so output is
 * stable across devices with different pointer-event cadence.
 */
import type { BezierSegment, Point } from './elementSchema.js';
import {
  distanceToSegment,
  polylineCubicSegments,
  simplifiedPointIndexes,
} from './curveGeometry.js';

function pointDistanceSquaredToOrthogonalPair(
  point: Point,
  start: Point,
  elbow: Point,
  end: Point,
): number {
  const distance = Math.min(
    distanceToSegment(point, start, elbow),
    distanceToSegment(point, elbow, end),
  );
  return distance * distance;
}

function appendOrthogonalVertex(vertices: Point[], point: Point): void {
  while (vertices.length >= 2) {
    const previous = vertices.at(-1);
    const beforePrevious = vertices.at(-2);
    if (previous === undefined || beforePrevious === undefined) break;
    const continuesVertically =
      beforePrevious.x === previous.x && previous.x === point.x;
    const continuesHorizontally =
      beforePrevious.y === previous.y && previous.y === point.y;
    if (!continuesVertically && !continuesHorizontally) break;
    vertices.pop();
  }
  const previous = vertices.at(-1);
  if (
    previous === undefined ||
    previous.x !== point.x ||
    previous.y !== point.y
  ) {
    vertices.push(point);
  }
}

function resamplePolyline(
  points: readonly Point[],
  preferredSpacing: number,
  maximumPoints: number,
): Point[] {
  const first = points[0];
  if (first === undefined) return [];
  const lengths: number[] = [];
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length =
      start === undefined || end === undefined
        ? 0
        : Math.hypot(end.x - start.x, end.y - start.y);
    lengths.push(length);
    totalLength += length;
  }
  if (totalLength === 0) return [first];
  const spacing = Math.max(
    preferredSpacing,
    totalLength / Math.max(1, maximumPoints - 1),
  );
  const result = [first];
  let traversed = 0;
  let nextDistance = spacing;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = lengths[index - 1] ?? 0;
    if (start === undefined || end === undefined || length === 0) continue;
    while (nextDistance < traversed + length) {
      const amount = (nextDistance - traversed) / length;
      result.push({
        x: start.x + (end.x - start.x) * amount,
        y: start.y + (end.y - start.y) * amount,
      });
      nextDistance += spacing;
    }
    traversed += length;
  }
  const last = points.at(-1);
  const resultLast = result.at(-1);
  if (
    last !== undefined &&
    (resultLast === undefined ||
      resultLast.x !== last.x ||
      resultLast.y !== last.y)
  ) {
    result.push(last);
  }
  return result;
}

function orthogonalVertices(
  points: readonly Point[],
  tolerance: number,
): Point[] {
  const anchorIndexes = simplifiedPointIndexes(points, tolerance);
  const first = points[0];
  if (first === undefined) return [];
  const vertices: Point[] = [first];
  for (let anchor = 1; anchor < anchorIndexes.length; anchor += 1) {
    const startIndex = anchorIndexes[anchor - 1];
    const endIndex = anchorIndexes[anchor];
    const start = startIndex === undefined ? undefined : points[startIndex];
    const end = endIndex === undefined ? undefined : points[endIndex];
    if (
      startIndex === undefined ||
      endIndex === undefined ||
      start === undefined ||
      end === undefined
    ) {
      continue;
    }
    const horizontalFirst = { x: end.x, y: start.y };
    const verticalFirst = { x: start.x, y: end.y };
    let horizontalCost = 0;
    let verticalCost = 0;
    for (let index = startIndex; index <= endIndex; index += 1) {
      const point = points[index];
      if (point === undefined) continue;
      horizontalCost += pointDistanceSquaredToOrthogonalPair(
        point,
        start,
        horizontalFirst,
        end,
      );
      verticalCost += pointDistanceSquaredToOrthogonalPair(
        point,
        start,
        verticalFirst,
        end,
      );
    }
    appendOrthogonalVertex(
      vertices,
      horizontalCost <= verticalCost ? horizontalFirst : verticalFirst,
    );
    appendOrthogonalVertex(vertices, end);
  }
  return vertices;
}

function orthogonalVerticesTurnAtRightAngles(
  vertices: readonly Point[],
): boolean {
  let previousOrientation: 'horizontal' | 'vertical' | null = null;
  for (let index = 1; index < vertices.length; index += 1) {
    const start = vertices[index - 1];
    const end = vertices[index];
    if (start === undefined || end === undefined) return false;
    const orientation =
      start.y === end.y && start.x !== end.x
        ? 'horizontal'
        : start.x === end.x && start.y !== end.y
          ? 'vertical'
          : null;
    if (orientation === null || orientation === previousOrientation) {
      return false;
    }
    previousOrientation = orientation;
  }
  return previousOrientation !== null;
}

function orthogonalVerticesMeetLengthRatio(
  vertices: readonly Point[],
  ratio: number,
  minimumExtent: number,
): boolean {
  if (vertices.length < 2) return false;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxX = Math.max(maxX, vertex.x);
    maxY = Math.max(maxY, vertex.y);
  }
  const horizontalExtent = Math.max(minimumExtent, maxX - minX);
  const verticalExtent = Math.max(minimumExtent, maxY - minY);
  const normalizedLengths = vertices.slice(1).flatMap((vertex, index) => {
    const start = vertices[index];
    if (start === undefined) return [];
    if (vertex.y === start.y && vertex.x !== start.x) {
      return [Math.abs(vertex.x - start.x) / horizontalExtent];
    }
    if (vertex.x === start.x && vertex.y !== start.y) {
      return [Math.abs(vertex.y - start.y) / verticalExtent];
    }
    return [];
  });
  if (normalizedLengths.length !== vertices.length - 1) return false;
  return (
    Math.min(...normalizedLengths) + 1e-9 >=
    Math.max(...normalizedLengths) * ratio
  );
}

function orthogonalVerticesFitCost(
  points: readonly Point[],
  vertices: readonly Point[],
): number {
  const segmentCount = vertices.length - 1;
  if (segmentCount < 1 || points.length < segmentCount) {
    return Number.POSITIVE_INFINITY;
  }
  const distancePrefixes = Array.from(
    { length: segmentCount },
    (_, segmentIndex) => {
      const start = vertices[segmentIndex];
      const end = vertices[segmentIndex + 1];
      const prefix = [0];
      if (start === undefined || end === undefined) return prefix;
      for (const point of points) {
        const distance = distanceToSegment(point, start, end);
        prefix.push((prefix.at(-1) ?? 0) + distance * distance);
      }
      return prefix;
    },
  );
  let previous = points.map((_, pointIndex) => {
    const prefix = distancePrefixes[0];
    return prefix?.[pointIndex + 1] ?? Number.POSITIVE_INFINITY;
  });
  for (let segmentIndex = 1; segmentIndex < segmentCount; segmentIndex += 1) {
    const prefix = distancePrefixes[segmentIndex];
    const current = points.map(() => Number.POSITIVE_INFINITY);
    for (
      let pointIndex = segmentIndex;
      pointIndex < points.length;
      pointIndex += 1
    ) {
      for (
        let previousEnd = segmentIndex - 1;
        previousEnd < pointIndex;
        previousEnd += 1
      ) {
        const priorCost = previous[previousEnd];
        if (priorCost === undefined || prefix === undefined) continue;
        const sectionCost =
          (prefix[pointIndex + 1] ?? Number.POSITIVE_INFINITY) -
          (prefix[previousEnd + 1] ?? 0);
        current[pointIndex] = Math.min(
          current[pointIndex] ?? Number.POSITIVE_INFINITY,
          priorCost + sectionCost,
        );
      }
    }
    previous = current;
  }
  return previous.at(-1) ?? Number.POSITIVE_INFINITY;
}

function alternatingOrthogonalVertices(
  points: readonly Point[],
  segmentCount: number,
  firstOrientation: 'horizontal' | 'vertical',
): Point[] {
  const first = points[0];
  const last = points.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    segmentCount < 2 ||
    segmentCount > points.length
  ) {
    return [];
  }
  const prefixX = [0];
  const prefixY = [0];
  const prefixX2 = [0];
  const prefixY2 = [0];
  for (const point of points) {
    prefixX.push((prefixX.at(-1) ?? 0) + point.x);
    prefixY.push((prefixY.at(-1) ?? 0) + point.y);
    prefixX2.push((prefixX2.at(-1) ?? 0) + point.x * point.x);
    prefixY2.push((prefixY2.at(-1) ?? 0) + point.y * point.y);
  }
  const orientationAt = (segmentIndex: number) =>
    segmentIndex % 2 === 0
      ? firstOrientation
      : firstOrientation === 'horizontal'
        ? 'vertical'
        : 'horizontal';
  const intervalCost = (
    startIndex: number,
    endIndex: number,
    orientation: 'horizontal' | 'vertical',
    fixedCoordinate: number | null = null,
  ) => {
    const count = endIndex - startIndex + 1;
    const values = orientation === 'horizontal' ? prefixY : prefixX;
    const squares = orientation === 'horizontal' ? prefixY2 : prefixX2;
    const sum = (values[endIndex + 1] ?? 0) - (values[startIndex] ?? 0);
    const sumSquares =
      (squares[endIndex + 1] ?? 0) - (squares[startIndex] ?? 0);
    return fixedCoordinate === null
      ? Math.max(0, sumSquares - (sum * sum) / count)
      : Math.max(
          0,
          sumSquares - 2 * fixedCoordinate * sum + count * fixedCoordinate ** 2,
        );
  };

  let previous = points.map((_, endIndex) =>
    intervalCost(
      0,
      endIndex,
      firstOrientation,
      firstOrientation === 'horizontal' ? first.y : first.x,
    ),
  );
  const backPointers: number[][] = [];
  for (let segmentIndex = 1; segmentIndex < segmentCount; segmentIndex += 1) {
    const current = points.map(() => Number.POSITIVE_INFINITY);
    const pointers = points.map(() => -1);
    const orientation = orientationAt(segmentIndex);
    for (let endIndex = segmentIndex; endIndex < points.length; endIndex += 1) {
      for (
        let previousEnd = segmentIndex - 1;
        previousEnd < endIndex;
        previousEnd += 1
      ) {
        const candidate =
          (previous[previousEnd] ?? Number.POSITIVE_INFINITY) +
          intervalCost(previousEnd + 1, endIndex, orientation);
        if (candidate < (current[endIndex] ?? Number.POSITIVE_INFINITY)) {
          current[endIndex] = candidate;
          pointers[endIndex] = previousEnd;
        }
      }
    }
    previous = current;
    backPointers.push(pointers);
  }
  if (!Number.isFinite(previous.at(-1))) return [];

  const intervals: { end: number; start: number }[] = [];
  let endIndex = points.length - 1;
  for (
    let segmentIndex = segmentCount - 1;
    segmentIndex >= 0;
    segmentIndex -= 1
  ) {
    const previousEnd =
      segmentIndex === 0
        ? -1
        : (backPointers[segmentIndex - 1]?.[endIndex] ?? -1);
    intervals.unshift({ end: endIndex, start: previousEnd + 1 });
    endIndex = previousEnd;
  }
  const lines = intervals.map((interval, segmentIndex) => {
    const orientation = orientationAt(segmentIndex);
    const values = orientation === 'horizontal' ? prefixY : prefixX;
    const sum = (values[interval.end + 1] ?? 0) - (values[interval.start] ?? 0);
    return {
      coordinate:
        segmentIndex === 0
          ? orientation === 'horizontal'
            ? first.y
            : first.x
          : sum / (interval.end - interval.start + 1),
      orientation,
    };
  });
  const vertices = [first];
  for (let lineIndex = 0; lineIndex < lines.length - 1; lineIndex += 1) {
    const line = lines[lineIndex];
    const next = lines[lineIndex + 1];
    if (line === undefined || next === undefined) return [];
    vertices.push(
      line.orientation === 'horizontal'
        ? { x: next.coordinate, y: line.coordinate }
        : { x: line.coordinate, y: next.coordinate },
    );
  }
  const finalLine = lines.at(-1);
  if (finalLine === undefined) return [];
  vertices.push(
    finalLine.orientation === 'horizontal'
      ? { x: last.x, y: finalLine.coordinate }
      : { x: finalLine.coordinate, y: last.y },
  );
  return vertices;
}

function singleOrthogonalSegmentVertices(points: readonly Point[]): Point[] {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return [];
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const candidates = [
    { x: last.x, y: first.y },
    { x: minX, y: first.y },
    { x: maxX, y: first.y },
    { x: first.x, y: last.y },
    { x: first.x, y: minY },
    { x: first.x, y: maxY },
  ].filter((end) => end.x !== first.x || end.y !== first.y);
  const end = candidates.reduce<Point | null>((best, candidate) => {
    if (best === null) return candidate;
    const candidateCost = orthogonalVerticesFitCost(points, [first, candidate]);
    const bestCost = orthogonalVerticesFitCost(points, [first, best]);
    return candidateCost < bestCost ? candidate : best;
  }, null);
  return end === null ? [] : [first, end];
}

/**
 * Fits a bounded alternating horizontal/vertical path to pointer samples. The
 * selected candidate minimizes geometric error while preserving endpoints and
 * rejecting needless short turns.
 */
export function fitOrthogonalSegments(
  points: readonly Point[],
  tolerance: number,
): BezierSegment[] {
  if (points.length < 2) return [];
  const normalizedTolerance = Math.max(0.1, tolerance);
  const samples = resamplePolyline(
    points,
    Math.max(0.5, normalizedTolerance / 3),
    256,
  );
  const first = samples[0];
  if (first === undefined || samples.length < 2) return [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of samples) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const maximumTolerance = Math.max(
    normalizedTolerance,
    Math.hypot(maxX - minX, maxY - minY) + 1,
  );
  const candidates: Point[][] = [];
  const addCandidate = (candidate: Point[]) => {
    if (
      candidate.length >= 2 &&
      candidate.length - 1 <= 24 &&
      orthogonalVerticesTurnAtRightAngles(candidate) &&
      orthogonalVerticesMeetLengthRatio(candidate, 1 / 5, normalizedTolerance)
    ) {
      candidates.push(candidate);
    }
  };

  const candidateLimit = Math.min(12, samples.length);
  for (
    let segmentCount = 2;
    segmentCount <= candidateLimit;
    segmentCount += 1
  ) {
    addCandidate(
      alternatingOrthogonalVertices(samples, segmentCount, 'horizontal'),
    );
    addCandidate(
      alternatingOrthogonalVertices(samples, segmentCount, 'vertical'),
    );
  }
  for (let iteration = 0; iteration <= 24; iteration += 1) {
    const progress = iteration / 24;
    const candidateTolerance =
      normalizedTolerance +
      (maximumTolerance - normalizedTolerance) * progress * progress;
    addCandidate(orthogonalVertices(samples, candidateTolerance));
  }
  addCandidate(singleOrthogonalSegmentVertices(samples));

  const scoredCandidates = candidates.map((candidate) => ({
    candidate,
    cost: orthogonalVerticesFitCost(samples, candidate),
  }));
  const targetCost = normalizedTolerance ** 2 * samples.length;
  const accurateCandidates = scoredCandidates
    .filter(({ cost }) => cost <= targetCost)
    .sort(
      (firstCandidate, secondCandidate) =>
        firstCandidate.candidate.length - secondCandidate.candidate.length ||
        firstCandidate.cost - secondCandidate.cost,
    );
  const best =
    accurateCandidates[0] ??
    scoredCandidates.reduce<{ candidate: Point[]; cost: number } | undefined>(
      (current, candidate) =>
        current === undefined || candidate.cost < current.cost
          ? candidate
          : current,
      undefined,
    );
  return polylineCubicSegments(best?.candidate ?? [], first);
}
