/**
 * Converts noisy pointer samples into a bounded Bézier path. Candidate fits are
 * scored against geometric error and safety limits before continuity-specific
 * fitting; invalid candidates fall back rather than emitting corrupt geometry.
 */
import type {
  BezierSegment,
  Point,
  SplineContinuity,
} from './elementSchema.js';
import { adaptiveContinuousFit } from './bezierContinuity.js';
import {
  chordParameters,
  cubicFitCost,
  cubicPoint,
  perpendicularDistance,
  simplifiedPointIndexes,
} from './curveGeometry.js';

function requiredFitValue<Value>(
  value: Value | undefined,
  description: string,
): Value {
  if (value === undefined) {
    throw new Error(`Bézier fitting invariant failed: missing ${description}`);
  }
  return value;
}

function simplifyPoints(points: readonly Point[], tolerance: number): Point[] {
  return simplifiedPointIndexes(points, tolerance).map((index) =>
    requiredFitValue(points[index], 'retained point'),
  );
}

function removeTransientBezierLoops(
  points: readonly Point[],
  tolerance: number,
): Point[] {
  if (points.length < 4) return [...points];
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const gestureScale = Math.hypot(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
  const maximumDiameter = Math.max(tolerance * 32, gestureScale * 0.05);
  const retained: Point[] = [];
  let index = 0;
  while (index < points.length) {
    const start = requiredFitValue(points[index], 'loop candidate start');
    retained.push(start);
    let minX = start.x;
    let maxX = start.x;
    let minY = start.y;
    let maxY = start.y;
    let pathLength = 0;
    let loopEnd = -1;
    const searchEnd = Math.min(points.length - 1, index + 2_048);
    for (
      let candidateIndex = index + 1;
      candidateIndex <= searchEnd;
      candidateIndex += 1
    ) {
      const previous = requiredFitValue(
        points[candidateIndex - 1],
        'previous loop candidate',
      );
      const candidate = requiredFitValue(
        points[candidateIndex],
        'current loop candidate',
      );
      pathLength += Math.hypot(
        candidate.x - previous.x,
        candidate.y - previous.y,
      );
      minX = Math.min(minX, candidate.x);
      maxX = Math.max(maxX, candidate.x);
      minY = Math.min(minY, candidate.y);
      maxY = Math.max(maxY, candidate.y);
      const diameter = Math.hypot(maxX - minX, maxY - minY);
      if (diameter > maximumDiameter) break;
      if (
        candidateIndex > index + 2 &&
        pathLength > Math.max(tolerance * 12, diameter * 8) &&
        Math.hypot(candidate.x - start.x, candidate.y - start.y) <=
          tolerance * 4
      ) {
        loopEnd = candidateIndex;
      }
    }
    if (loopEnd > index) {
      index = loopEnd;
    } else {
      index += 1;
    }
  }
  const last = requiredFitValue(points.at(-1), 'final retained point');
  if (retained.at(-1) !== last) retained.push(last);
  return retained;
}

function removeTransientBezierSpikes(
  points: readonly Point[],
  tolerance: number,
): Point[] {
  let current = [...points];
  const scale = Math.max(1e-6, tolerance);
  for (let pass = 0; pass < 4 && current.length > 2; pass += 1) {
    let changed = false;
    const next: Point[] = [
      requiredFitValue(current[0], 'first spike-filter point'),
    ];
    for (let index = 1; index < current.length - 1; index += 1) {
      const previous = next.at(-1);
      const point = current[index];
      const following = current[index + 1];
      if (
        previous === undefined ||
        point === undefined ||
        following === undefined
      )
        continue;
      const direct = Math.hypot(
        following.x - previous.x,
        following.y - previous.y,
      );
      const incoming = Math.hypot(point.x - previous.x, point.y - previous.y);
      const outgoing = Math.hypot(following.x - point.x, following.y - point.y);
      const deviation = perpendicularDistance(point, previous, following);
      const transient =
        direct <= scale * 4 &&
        deviation > scale * 2 &&
        incoming + outgoing > Math.max(scale * 8, direct * 4);
      if (transient) {
        changed = true;
      } else {
        next.push(point);
      }
    }
    next.push(requiredFitValue(current.at(-1), 'last spike-filter point'));
    current = next;
    if (!changed) break;
  }
  return current;
}

/** Maps the five-step drawing accuracy control to a decreasing world-error target. */
export function bezierAccuracyTargetError(accuracy: number): number {
  const normalizedAccuracy = (Math.min(5, Math.max(1, accuracy)) - 1) / 4;
  return 5 * 5 ** -normalizedAccuracy;
}

/** Bounds and continuity policy for converting pointer samples to cubic segments. */
export interface BezierFitOptions {
  /** Continuity enforced at interior knots; defaults to tangent-continuous C1. */
  continuity?: SplineContinuity;
  /** Segment cap, or null to choose a bounded count from targetError. */
  maxSegments?: number | null;
  /** World-distance threshold used to remove redundant pointer samples. */
  sampleTolerance?: number;
  /** Maximum fitting error used only when maxSegments is null. */
  targetError?: number;
}

interface FittedCubic {
  control1: Point;
  control2: Point;
  cost: number;
  end: Point;
}

/** Maximum points admitted to ordinary continuous fitting work. */
export const MAX_BEZIER_FIT_SAMPLES = 64;

/**
 * Removes event-rate bias before fitting: geometric deviations survive while
 * redundant coalesced/collinear pointer samples do not. Endpoints are exact.
 */
export function sampleBezierPoints(
  points: readonly Point[],
  tolerance = 0.5,
  maximumSamples = MAX_BEZIER_FIT_SAMPLES,
): Point[] {
  if (points.length <= 2) return [...points];
  const limit = Math.max(2, Math.floor(maximumSamples));
  const minimumTolerance = Math.max(1e-6, tolerance);
  const simplified = simplifyPoints(points, minimumTolerance);
  if (simplified.length <= limit) return simplified;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  let lowerTolerance = minimumTolerance;
  let upperTolerance = Math.max(
    minimumTolerance,
    Math.hypot(maxX - minX, maxY - minY),
  );
  let limited = [
    requiredFitValue(points[0], 'first sampled point'),
    requiredFitValue(points.at(-1), 'last sampled point'),
  ];
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const candidateTolerance = (lowerTolerance + upperTolerance) / 2;
    const candidate = simplifyPoints(points, candidateTolerance);
    if (candidate.length > limit) {
      lowerTolerance = candidateTolerance;
    } else {
      upperTolerance = candidateTolerance;
      limited = candidate;
    }
  }
  return limited;
}

function cubicDerivatives(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  t: number,
): { first: Point; second: Point } {
  const inverse = 1 - t;
  return {
    first: {
      x:
        3 * inverse * inverse * (control1.x - start.x) +
        6 * inverse * t * (control2.x - control1.x) +
        3 * t * t * (end.x - control2.x),
      y:
        3 * inverse * inverse * (control1.y - start.y) +
        6 * inverse * t * (control2.y - control1.y) +
        3 * t * t * (end.y - control2.y),
    },
    second: {
      x:
        6 * inverse * (control2.x - 2 * control1.x + start.x) +
        6 * t * (end.x - 2 * control2.x + control1.x),
      y:
        6 * inverse * (control2.y - 2 * control1.y + start.y) +
        6 * t * (end.y - 2 * control2.y + control1.y),
    },
  };
}

function solveCubicControls(
  points: readonly Point[],
  startIndex: number,
  endIndex: number,
  parameters: readonly number[],
): FittedCubic {
  const start = points[startIndex];
  const end = points[endIndex];
  if (start === undefined || end === undefined) {
    return {
      control1: { x: 0, y: 0 },
      control2: { x: 0, y: 0 },
      cost: Number.POSITIVE_INFINITY,
      end: { x: 0, y: 0 },
    };
  }
  const baseline1 = {
    x: start.x + (end.x - start.x) / 3,
    y: start.y + (end.y - start.y) / 3,
  };
  const baseline2 = {
    x: start.x + (2 * (end.x - start.x)) / 3,
    y: start.y + (2 * (end.y - start.y)) / 3,
  };
  let a11 = 1e-8;
  let a12 = 0;
  let a22 = 1e-8;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const point = points[index];
    const t = parameters[index - startIndex];
    if (point === undefined || t === undefined) continue;
    const inverse = 1 - t;
    const b0 = inverse ** 3;
    const b1 = 3 * inverse * inverse * t;
    const b2 = 3 * inverse * t * t;
    const b3 = t ** 3;
    const residual = {
      x:
        point.x -
        b0 * start.x -
        b1 * baseline1.x -
        b2 * baseline2.x -
        b3 * end.x,
      y:
        point.y -
        b0 * start.y -
        b1 * baseline1.y -
        b2 * baseline2.y -
        b3 * end.y,
    };
    a11 += b1 * b1;
    a12 += b1 * b2;
    a22 += b2 * b2;
    x1 += b1 * residual.x;
    x2 += b2 * residual.x;
    y1 += b1 * residual.y;
    y2 += b2 * residual.y;
  }
  const determinant = a11 * a22 - a12 * a12;
  const control1 = {
    x: baseline1.x + (x1 * a22 - x2 * a12) / determinant,
    y: baseline1.y + (y1 * a22 - y2 * a12) / determinant,
  };
  const control2 = {
    x: baseline2.x + (x2 * a11 - x1 * a12) / determinant,
    y: baseline2.y + (y2 * a11 - y1 * a12) / determinant,
  };
  const cost = cubicFitCost(points, parameters, startIndex, endIndex, {
    control1,
    control2,
    end,
    start,
  });
  return { control1, control2, cost, end };
}

function nearestCubicParameter(
  point: Point,
  start: Point,
  cubic: FittedCubic,
  initial: number,
): number {
  let t = initial;
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const fitted = cubicPoint(
      start,
      cubic.control1,
      cubic.control2,
      cubic.end,
      t,
    );
    const derivatives = cubicDerivatives(
      start,
      cubic.control1,
      cubic.control2,
      cubic.end,
      t,
    );
    const offset = { x: fitted.x - point.x, y: fitted.y - point.y };
    const numerator =
      offset.x * derivatives.first.x + offset.y * derivatives.first.y;
    const denominator =
      derivatives.first.x ** 2 +
      derivatives.first.y ** 2 +
      offset.x * derivatives.second.x +
      offset.y * derivatives.second.y;
    if (Math.abs(denominator) < 1e-9) break;
    t = Math.min(1, Math.max(0, t - numerator / denominator));
  }
  return t;
}

function fitCubicRange(
  points: readonly Point[],
  startIndex: number,
  endIndex: number,
): FittedCubic {
  const start = points[startIndex];
  if (start === undefined) {
    return solveCubicControls(points, startIndex, endIndex, [0, 1]);
  }
  let parameters = chordParameters(points, startIndex, endIndex);
  let current = solveCubicControls(points, startIndex, endIndex, parameters);
  let best = current;
  for (let iteration = 0; iteration < 1; iteration += 1) {
    const refined = parameters.map((parameter, offset) => {
      const point = points[startIndex + offset];
      return point === undefined
        ? parameter
        : nearestCubicParameter(point, start, current, parameter);
    });
    refined[0] = 0;
    refined[refined.length - 1] = 1;
    const minimumStep = 1e-6;
    for (let index = 1; index < refined.length - 1; index += 1) {
      refined[index] = Math.max(
        refined[index] ?? 0,
        (refined[index - 1] ?? 0) + minimumStep,
      );
    }
    for (let index = refined.length - 2; index > 0; index -= 1) {
      refined[index] = Math.min(
        refined[index] ?? 1,
        (refined[index + 1] ?? 1) - minimumStep,
      );
    }
    parameters = refined;
    current = solveCubicControls(points, startIndex, endIndex, parameters);
    if (current.cost < best.cost) best = current;
  }
  return best;
}

interface BezierFitQuality {
  maximumError: number;
  rmsError: number;
  score: number;
  stable: boolean;
}

function pointDistanceToPolyline(
  point: Point,
  polyline: readonly Point[],
): number {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < polyline.length; index += 1) {
    const start = polyline[index - 1];
    const end = polyline[index];
    if (start === undefined || end === undefined) continue;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const parameter =
      lengthSquared <= Number.EPSILON
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.x - start.x) * dx + (point.y - start.y) * dy) /
                lengthSquared,
            ),
          );
    distance = Math.min(
      distance,
      Math.hypot(
        point.x - start.x - parameter * dx,
        point.y - start.y - parameter * dy,
      ),
    );
  }
  return distance;
}

function polylineLength(points: readonly Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (previous !== undefined && point !== undefined) {
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
    }
  }
  return length;
}

function bezierFitQuality(
  points: readonly Point[],
  fitted: readonly FittedCubic[],
): BezierFitQuality {
  if (fitted.length === 0 || points.length < 2) {
    return {
      maximumError: Number.POSITIVE_INFINITY,
      rmsError: Number.POSITIVE_INFINITY,
      score: Number.POSITIVE_INFINITY,
      stable: false,
    };
  }
  const curve: Point[] = [requiredFitValue(points[0], 'first fitted point')];
  let start = requiredFitValue(points[0], 'first normalized point');
  let finite = true;
  for (const cubic of fitted) {
    finite &&= [cubic.control1, cubic.control2, cubic.end].every(
      ({ x, y }) => Number.isFinite(x) && Number.isFinite(y),
    );
    for (let index = 1; index <= 16; index += 1) {
      curve.push(
        cubicPoint(
          start,
          cubic.control1,
          cubic.control2,
          cubic.end,
          index / 16,
        ),
      );
    }
    start = cubic.end;
  }
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const scale = Math.max(
    1,
    Math.hypot(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    ),
  );
  const origin = requiredFitValue(points[0], 'fit origin');
  const controlExtent = Math.max(
    ...fitted.flatMap(({ control1, control2, end }) =>
      [control1, control2, end].map(({ x, y }) =>
        Math.hypot(x - origin.x, y - origin.y),
      ),
    ),
  );
  const inputLength = polylineLength(points);
  const curveLength = polylineLength(curve);
  const stable =
    finite &&
    controlExtent <= scale * 8 &&
    curveLength <= Math.max(scale * 8, inputLength * 8);
  let maximumError = 0;
  let forwardSquared = 0;
  for (const point of points) {
    const error = pointDistanceToPolyline(point, curve);
    maximumError = Math.max(maximumError, error);
    forwardSquared += error * error;
  }
  let reverseSquared = 0;
  for (const point of curve) {
    const error = pointDistanceToPolyline(point, points);
    maximumError = Math.max(maximumError, error);
    reverseSquared += error * error;
  }
  const forwardMean = forwardSquared / points.length;
  const reverseMean = reverseSquared / curve.length;
  const rmsError = Math.sqrt(forwardMean);
  return {
    maximumError,
    rmsError,
    score: stable
      ? forwardMean + reverseMean * 0.5 + maximumError ** 2 * 0.05
      : Number.POSITIVE_INFINITY,
    stable,
  };
}

function isBetterBezierFit(
  candidate: BezierFitQuality,
  current: BezierFitQuality,
): boolean {
  if (!candidate.stable) return false;
  if (!current.stable) return true;
  const tolerance = Math.max(1e-6, current.maximumError * 1e-6);
  return (
    candidate.maximumError < current.maximumError - tolerance ||
    (Math.abs(candidate.maximumError - current.maximumError) <= tolerance &&
      candidate.score < current.score)
  );
}

function fitConstrainedBezierSegments(
  points: readonly Point[],
  maximumSegments: number,
  continuity: SplineContinuity,
  targetError?: number,
  validationPoints: readonly Point[] = points,
): BezierSegment[] {
  const anchorIndexes = points.map((_, index) => index);
  const maximumSegmentCount = Math.min(
    Math.max(1, Math.floor(maximumSegments)),
    anchorIndexes.length - 1,
  );
  const candidates: (FittedCubic | undefined)[][] = Array.from(
    { length: anchorIndexes.length },
    () => Array<FittedCubic | undefined>(anchorIndexes.length),
  );
  const splits: number[][] = Array.from(
    { length: maximumSegmentCount + 1 },
    () => Array<number>(anchorIndexes.length).fill(-1),
  );
  if (continuity === 'c0') {
    for (let start = 0; start < anchorIndexes.length - 1; start += 1) {
      for (let end = start + 1; end < anchorIndexes.length; end += 1) {
        const rangeStart = anchorIndexes[start];
        const rangeEnd = anchorIndexes[end];
        if (rangeStart === undefined || rangeEnd === undefined) continue;
        requiredFitValue(candidates[start], 'candidate-fit row')[end] =
          fitCubicRange(points, rangeStart, rangeEnd);
      }
    }
    const costs: number[][] = Array.from(
      { length: maximumSegmentCount + 1 },
      () => Array<number>(anchorIndexes.length).fill(Number.POSITIVE_INFINITY),
    );
    requiredFitValue(costs[0], 'initial cost row')[0] = 0;
    for (let count = 1; count <= maximumSegmentCount; count += 1) {
      for (let end = count; end < anchorIndexes.length; end += 1) {
        for (let start = count - 1; start < end; start += 1) {
          const previousCost = costs[count - 1]?.[start];
          const candidate = candidates[start]?.[end];
          if (previousCost === undefined || candidate === undefined) continue;
          const cost = previousCost + candidate.cost;
          if (cost < (costs[count]?.[end] ?? Number.POSITIVE_INFINITY)) {
            requiredFitValue(costs[count], 'cost row')[end] = cost;
            requiredFitValue(splits[count], 'split row')[end] = start;
          }
        }
      }
    }
  }

  const finalPointIndex = anchorIndexes.length - 1;
  const firstPoint = points[0];
  const finalPoint = points.at(-1);
  const closedInput =
    firstPoint !== undefined &&
    finalPoint !== undefined &&
    points.length > 2 &&
    Math.hypot(finalPoint.x - firstPoint.x, finalPoint.y - firstPoint.y) <=
      1e-8;
  const fits = new Map<number, FittedCubic[]>();
  const fitForCount = (segmentCount: number): FittedCubic[] => {
    const cached = fits.get(segmentCount);
    if (cached !== undefined) return cached;
    if (continuity !== 'c0') {
      // With one open curve there is no junction, so every continuity level
      // uses the same independent cubic. A closed curve has a periodic seam.
      const fitted =
        segmentCount === 1 && !closedInput
          ? [fitCubicRange(points, 0, finalPointIndex)]
          : adaptiveContinuousFit(points, segmentCount, continuity);
      fits.set(segmentCount, fitted);
      return fitted;
    }
    const independent: FittedCubic[] = [];
    let end = finalPointIndex;
    for (let count = segmentCount; count > 0; count -= 1) {
      const start = splits[count]?.[end] ?? -1;
      const candidate = start >= 0 ? candidates[start]?.[end] : undefined;
      if (start < 0 || candidate === undefined) return [];
      independent.unshift(candidate);
      end = start;
    }
    fits.set(segmentCount, independent);
    return independent;
  };
  const qualities = new Map<number, BezierFitQuality>();
  const qualityForCount = (segmentCount: number): BezierFitQuality => {
    const cached = qualities.get(segmentCount);
    if (cached !== undefined) return cached;
    const quality = bezierFitQuality(
      validationPoints,
      fitForCount(segmentCount),
    );
    qualities.set(segmentCount, quality);
    return quality;
  };

  let fitted = fitForCount(1);
  let chosenQuality = qualityForCount(1);
  if (targetError !== undefined && Number.isFinite(targetError)) {
    const target = Math.max(0.1, targetError);
    for (let count = 1; count <= maximumSegmentCount; count += 1) {
      const candidate = fitForCount(count);
      const quality = qualityForCount(count);
      if (isBetterBezierFit(quality, chosenQuality)) {
        fitted = candidate;
        chosenQuality = quality;
      }
      if (
        quality.stable &&
        quality.rmsError <= target &&
        quality.maximumError <= target * 3
      ) {
        break;
      }
    }
  } else {
    for (let count = 2; count <= maximumSegmentCount; count += 1) {
      const candidate = fitForCount(count);
      const quality = qualityForCount(count);
      if (isBetterBezierFit(quality, chosenQuality)) {
        fitted = candidate;
        chosenQuality = quality;
      }
    }
  }

  const origin = points[0];
  if (origin === undefined) return [];
  const relative = (point: Point): Point => ({
    x: point.x - origin.x,
    y: point.y - origin.y,
  });
  return fitted.map(({ control1, control2, end }) => ({
    control1: relative(control1),
    control2: relative(control2),
    end: relative(end),
  }));
}

/** Fits bounded origin-relative cubic segments after removing pointer-rate noise. */
export function fitBezierSegments(
  points: readonly Point[],
  settings: BezierFitOptions = { maxSegments: 4 },
): BezierSegment[] {
  if (points.length < 2) return [];
  const maximumSegments =
    settings.maxSegments === null ? 12 : (settings.maxSegments ?? 4);
  const sampleTolerance = settings.sampleTolerance ?? 0.5;
  const withoutDwellLoops = removeTransientBezierLoops(points, sampleTolerance);
  const stabilized = removeTransientBezierSpikes(
    withoutDwellLoops,
    sampleTolerance,
  );
  const prepared = [...stabilized];
  const first = prepared[0];
  const last = prepared.at(-1);
  if (
    first !== undefined &&
    last !== undefined &&
    polylineLength(prepared) >= sampleTolerance * 20 &&
    Math.hypot(last.x - first.x, last.y - first.y) <= sampleTolerance * 2
  ) {
    prepared[prepared.length - 1] = { ...first };
  }
  const fittingPoints = sampleBezierPoints(
    prepared,
    sampleTolerance,
    (settings.continuity ?? 'c1') === 'c0' ? 48 : MAX_BEZIER_FIT_SAMPLES,
  );
  const validationPoints = sampleBezierPoints(
    prepared,
    Math.max(1e-6, sampleTolerance * 0.25),
    128,
  );
  return fitConstrainedBezierSegments(
    fittingPoints,
    maximumSegments,
    settings.continuity ?? 'c1',
    settings.maxSegments === null ? settings.targetError : undefined,
    validationPoints,
  );
}
