/**
 * Solves and preserves C0, C1, and C2 Bézier continuity. The fitting routines
 * use bounded linear systems and explicit fallback paths so singular input
 * cannot produce non-finite control points.
 */
import type {
  BezierSegment,
  LineElement,
  Point,
  SplineContinuity,
} from './elementSchema.js';
import { chordParameters, cubicFitCost, cubicPoint } from './curveGeometry.js';

function requiredContinuityValue<Value>(
  value: Value | undefined,
  description: string,
): Value {
  if (value === undefined) {
    throw new Error(
      `Bézier continuity invariant failed: missing ${description}`,
    );
  }
  return value;
}

interface ContinuousFittedCubic {
  control1: Point;
  control2: Point;
  cost: number;
  end: Point;
}

interface CubicRange {
  endIndex: number;
  startIndex: number;
}

interface LinearConstraint {
  coefficients: number[];
  value: number;
}

function solveLinearSystem(
  matrix: readonly number[][],
  values: readonly number[],
): number[] | null {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index] ?? 0]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (
        Math.abs(augmented[row]?.[column] ?? 0) >
        Math.abs(augmented[pivot]?.[column] ?? 0)
      ) {
        pivot = row;
      }
    }
    const pivotValue = augmented[pivot]?.[column] ?? 0;
    if (Math.abs(pivotValue) < 1e-12) return null;
    const columnRow = requiredContinuityValue(
      augmented[column],
      'active linear-system row',
    );
    const pivotRow = requiredContinuityValue(
      augmented[pivot],
      'pivot linear-system row',
    );
    [augmented[column], augmented[pivot]] = [pivotRow, columnRow];
    for (let entry = column; entry <= size; entry += 1) {
      pivotRow[entry] = (pivotRow[entry] ?? 0) / pivotValue;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]?.[column] ?? 0;
      if (factor === 0) continue;
      const targetRow = requiredContinuityValue(
        augmented[row],
        'elimination target row',
      );
      const sourceRow = requiredContinuityValue(
        augmented[column],
        'elimination source row',
      );
      for (let entry = column; entry <= size; entry += 1) {
        targetRow[entry] =
          (targetRow[entry] ?? 0) - factor * (sourceRow[entry] ?? 0);
      }
    }
  }
  return augmented.map((row) => row[size] ?? 0);
}

function solveConstrainedLeastSquares(
  normal: readonly number[][],
  values: readonly number[],
  constraints: readonly LinearConstraint[],
): number[] | null {
  if (constraints.length === 0) return solveLinearSystem(normal, values);
  // KKT systems combine least-squares coefficients with derivative
  // constraints whose natural units vary with knot spacing. Unit row scaling
  // keeps an exact constraint exact while avoiding scale-dependent pivots.
  const normalizedConstraints = constraints.flatMap((constraint) => {
    const norm = Math.hypot(...constraint.coefficients);
    if (!Number.isFinite(norm) || norm <= 1e-12) return [];
    return [
      {
        coefficients: constraint.coefficients.map((value) => value / norm),
        value: constraint.value / norm,
      },
    ];
  });
  if (normalizedConstraints.length === 0) {
    return solveLinearSystem(normal, values);
  }
  const variableCount = values.length;
  const size = variableCount + normalizedConstraints.length;
  const matrix = Array.from({ length: size }, () =>
    Array<number>(size).fill(0),
  );
  const right = Array<number>(size).fill(0);
  for (let row = 0; row < variableCount; row += 1) {
    right[row] = values[row] ?? 0;
    const matrixRow = requiredContinuityValue(
      matrix[row],
      'least-squares matrix row',
    );
    for (let column = 0; column < variableCount; column += 1) {
      matrixRow[column] = normal[row]?.[column] ?? 0;
    }
  }
  normalizedConstraints.forEach((constraint, constraintIndex) => {
    const row = variableCount + constraintIndex;
    right[row] = constraint.value;
    const constraintRow = requiredContinuityValue(
      matrix[row],
      'constraint matrix row',
    );
    for (let column = 0; column < variableCount; column += 1) {
      const coefficient = constraint.coefficients[column] ?? 0;
      constraintRow[column] = coefficient;
      requiredContinuityValue(matrix[column], 'constraint matrix column row')[
        row
      ] = coefficient;
    }
  });
  return solveLinearSystem(matrix, right)?.slice(0, variableCount) ?? null;
}

function splineIntervals(knots: readonly Point[]): number[] {
  return knots.slice(1).map((knot, index) => {
    const previous = knots[index];
    if (previous === undefined) return 1;
    return Math.max(1e-6, Math.hypot(knot.x - previous.x, knot.y - previous.y));
  });
}

function forwardTangentPriors(
  knots: readonly Point[],
  intervals: readonly number[],
): Point[] {
  return knots.map((knot, index) => {
    const previous = knots[index - 1];
    const next = knots[index + 1];
    if (previous === undefined && next !== undefined) {
      const interval = intervals[index] ?? 1;
      return {
        x: (next.x - knot.x) / (3 * interval),
        y: (next.y - knot.y) / (3 * interval),
      };
    }
    if (next === undefined && previous !== undefined) {
      const interval = intervals[index - 1] ?? 1;
      return {
        x: (knot.x - previous.x) / (3 * interval),
        y: (knot.y - previous.y) / (3 * interval),
      };
    }
    const span = (intervals[index - 1] ?? 1) + (intervals[index] ?? 1);
    return previous === undefined || next === undefined
      ? { x: 0, y: 0 }
      : {
          x: (next.x - previous.x) / (3 * span),
          y: (next.y - previous.y) / (3 * span),
        };
  });
}

/**
 * Segment i uses controls Pᵢ + hᵢvᵢ and Pᵢ₊₁ - hᵢvᵢ₊₁.
 * Sharing v at a knot gives C1; these equations additionally equate the
 * second derivatives after each local Bézier parameter is scaled by h.
 */
function secondDerivativeConstraints(
  knots: readonly Point[],
  intervals: readonly number[],
  coordinate: 'x' | 'y',
): LinearConstraint[] {
  const constraints: LinearConstraint[] = [];
  for (let index = 1; index < knots.length - 1; index += 1) {
    const previous = knots[index - 1];
    const knot = knots[index];
    const next = knots[index + 1];
    const previousInterval = intervals[index - 1];
    const nextInterval = intervals[index];
    if (
      previous === undefined ||
      knot === undefined ||
      next === undefined ||
      previousInterval === undefined ||
      nextInterval === undefined
    ) {
      continue;
    }
    const coefficients = Array<number>(knots.length).fill(0);
    coefficients[index - 1] = 1 / previousInterval;
    coefficients[index] = 2 / previousInterval + 2 / nextInterval;
    coefficients[index + 1] = 1 / nextInterval;
    constraints.push({
      coefficients,
      value:
        (knot[coordinate] - previous[coordinate]) / previousInterval ** 2 +
        (next[coordinate] - knot[coordinate]) / nextInterval ** 2,
    });
  }
  return constraints;
}

function periodicSeamConstraints(
  knots: readonly Point[],
  intervals: readonly number[],
  coordinate: 'x' | 'y',
): LinearConstraint[] {
  const lastIndex = knots.length - 1;
  const previous = knots[lastIndex - 1];
  const seam = knots[lastIndex];
  const first = knots[0];
  const next = knots[1];
  const previousInterval = intervals.at(-1);
  const nextInterval = intervals[0];
  if (
    previous === undefined ||
    seam === undefined ||
    first === undefined ||
    next === undefined ||
    previousInterval === undefined ||
    nextInterval === undefined
  ) {
    return [];
  }
  const firstDerivative = Array<number>(knots.length).fill(0);
  firstDerivative[0] = 1;
  firstDerivative[lastIndex] = -1;
  const secondDerivative = Array<number>(knots.length).fill(0);
  secondDerivative[lastIndex - 1] = 1 / previousInterval;
  secondDerivative[lastIndex] = 2 / previousInterval;
  secondDerivative[0] = 2 / nextInterval;
  secondDerivative[1] = 1 / nextInterval;
  return [
    { coefficients: firstDerivative, value: 0 },
    {
      coefficients: secondDerivative,
      value:
        (seam[coordinate] - previous[coordinate]) / previousInterval ** 2 +
        (next[coordinate] - first[coordinate]) / nextInterval ** 2,
    },
  ];
}

function fitNaturalC2BezierRanges(
  points: readonly Point[],
  ranges: readonly CubicRange[],
): ContinuousFittedCubic[] {
  const knots = [
    points[ranges[0]?.startIndex ?? 0],
    ...ranges.map(({ endIndex }) => points[endIndex]),
  ].filter((point): point is Point => point !== undefined);
  if (knots.length !== ranges.length + 1) return [];
  const intervals = splineIntervals(knots);
  const first = requiredContinuityValue(knots[0], 'first natural spline knot');
  const last = requiredContinuityValue(
    knots.at(-1),
    'last natural spline knot',
  );
  const closed =
    knots.length > 3 && Math.hypot(last.x - first.x, last.y - first.y) <= 1e-8;
  const derivativeCount = closed ? knots.length - 1 : knots.length;
  const matrix = Array.from({ length: derivativeCount }, () =>
    Array<number>(derivativeCount).fill(0),
  );
  if (closed) {
    for (let index = 0; index < derivativeCount; index += 1) {
      const previousIndex = (index - 1 + derivativeCount) % derivativeCount;
      const nextIndex = (index + 1) % derivativeCount;
      const previousInterval = intervals[previousIndex] ?? 1;
      const nextInterval = intervals[index] ?? 1;
      const matrixRow = requiredContinuityValue(
        matrix[index],
        'closed-spline matrix row',
      );
      matrixRow[previousIndex] =
        (matrixRow[previousIndex] ?? 0) + previousInterval;
      matrixRow[index] =
        (matrixRow[index] ?? 0) + 2 * (previousInterval + nextInterval);
      matrixRow[nextIndex] = (matrixRow[nextIndex] ?? 0) + nextInterval;
    }
  } else {
    requiredContinuityValue(matrix[0], 'first natural-spline matrix row')[0] =
      1;
    requiredContinuityValue(
      matrix[derivativeCount - 1],
      'last natural-spline matrix row',
    )[derivativeCount - 1] = 1;
    for (let index = 1; index < derivativeCount - 1; index += 1) {
      const previousInterval = intervals[index - 1] ?? 1;
      const nextInterval = intervals[index] ?? 1;
      const matrixRow = requiredContinuityValue(
        matrix[index],
        'natural-spline matrix row',
      );
      matrixRow[index - 1] = previousInterval;
      matrixRow[index] = 2 * (previousInterval + nextInterval);
      matrixRow[index + 1] = nextInterval;
    }
  }
  const solveSecondDerivatives = (coordinate: 'x' | 'y') => {
    const values = Array<number>(derivativeCount).fill(0);
    const startIndex = closed ? 0 : 1;
    const endIndex = closed ? derivativeCount : derivativeCount - 1;
    for (let index = startIndex; index < endIndex; index += 1) {
      const previousIndex = (index - 1 + derivativeCount) % derivativeCount;
      const nextIndex = (index + 1) % derivativeCount;
      const previous = requiredContinuityValue(
        knots[previousIndex],
        'previous derivative knot',
      );
      const knot = requiredContinuityValue(
        knots[index],
        'current derivative knot',
      );
      const next = requiredContinuityValue(
        knots[nextIndex],
        'next derivative knot',
      );
      const previousInterval = intervals[previousIndex] ?? 1;
      const nextInterval = intervals[index] ?? 1;
      values[index] =
        6 *
        ((next[coordinate] - knot[coordinate]) / nextInterval -
          (knot[coordinate] - previous[coordinate]) / previousInterval);
    }
    return solveLinearSystem(matrix, values);
  };
  const xSecond = solveSecondDerivatives('x');
  const ySecond = solveSecondDerivatives('y');
  if (xSecond === null || ySecond === null) return [];

  return ranges.map(({ endIndex, startIndex }, rangeIndex) => {
    const start = requiredContinuityValue(
      points[startIndex],
      'natural fit range start',
    );
    const end = requiredContinuityValue(
      points[endIndex],
      'natural fit range end',
    );
    const interval = intervals[rangeIndex] ?? 1;
    const endSecondIndex =
      closed && rangeIndex + 1 === derivativeCount ? 0 : rangeIndex + 1;
    const startSecond = {
      x: xSecond[rangeIndex] ?? 0,
      y: ySecond[rangeIndex] ?? 0,
    };
    const endSecond = {
      x: xSecond[endSecondIndex] ?? 0,
      y: ySecond[endSecondIndex] ?? 0,
    };
    const derivativeStart = {
      x:
        (end.x - start.x) / interval -
        (interval * (2 * startSecond.x + endSecond.x)) / 6,
      y:
        (end.y - start.y) / interval -
        (interval * (2 * startSecond.y + endSecond.y)) / 6,
    };
    const derivativeEnd = {
      x:
        (end.x - start.x) / interval +
        (interval * (startSecond.x + 2 * endSecond.x)) / 6,
      y:
        (end.y - start.y) / interval +
        (interval * (startSecond.y + 2 * endSecond.y)) / 6,
    };
    const control1 = {
      x: start.x + (interval * derivativeStart.x) / 3,
      y: start.y + (interval * derivativeStart.y) / 3,
    };
    const control2 = {
      x: end.x - (interval * derivativeEnd.x) / 3,
      y: end.y - (interval * derivativeEnd.y) / 3,
    };
    const parameters = chordParameters(points, startIndex, endIndex);
    let cost = 0;
    for (let index = startIndex; index <= endIndex; index += 1) {
      const point = points[index];
      const parameter = parameters[index - startIndex];
      if (point === undefined || parameter === undefined) continue;
      const fitted = cubicPoint(start, control1, control2, end, parameter);
      cost += (fitted.x - point.x) ** 2 + (fitted.y - point.y) ** 2;
    }
    return { control1, control2, cost, end };
  });
}

function fitContinuousBezierRanges(
  points: readonly Point[],
  ranges: readonly CubicRange[],
  continuity: Exclude<SplineContinuity, 'c0'>,
): ContinuousFittedCubic[] {
  if (continuity === 'c2') {
    return fitNaturalC2BezierRanges(points, ranges);
  }
  const knots = [
    points[ranges[0]?.startIndex ?? 0],
    ...ranges.map(({ endIndex }) => points[endIndex]),
  ].filter((point): point is Point => point !== undefined);
  if (knots.length !== ranges.length + 1) return [];
  const tangentCount = knots.length;
  const intervals = splineIntervals(knots);
  const normal = Array.from({ length: tangentCount }, (_, row) =>
    Array.from<number, number>({ length: tangentCount }, (_, column) =>
      row === column ? 1e-8 : 0,
    ),
  );
  const xValues = Array<number>(tangentCount).fill(0);
  const yValues = Array<number>(tangentCount).fill(0);

  ranges.forEach(({ endIndex, startIndex }, rangeIndex) => {
    const start = points[startIndex];
    const end = points[endIndex];
    if (start === undefined || end === undefined) return;
    const parameters = chordParameters(points, startIndex, endIndex);
    for (let index = startIndex; index <= endIndex; index += 1) {
      const point = points[index];
      const t = parameters[index - startIndex];
      if (point === undefined || t === undefined) continue;
      const inverse = 1 - t;
      const b0 = inverse ** 3;
      const b1 = 3 * inverse * inverse * t;
      const b2 = 3 * inverse * t * t;
      const b3 = t ** 3;
      const interval = intervals[rangeIndex] ?? 1;
      const firstCoefficient = b1 * interval;
      const secondCoefficient = -b2 * interval;
      const xResidual = point.x - (b0 + b1) * start.x - (b2 + b3) * end.x;
      const yResidual = point.y - (b0 + b1) * start.y - (b2 + b3) * end.y;
      const startRow = requiredContinuityValue(
        normal[rangeIndex],
        'fit normal start row',
      );
      const endRow = requiredContinuityValue(
        normal[rangeIndex + 1],
        'fit normal end row',
      );
      startRow[rangeIndex] =
        (startRow[rangeIndex] ?? 0) + firstCoefficient * firstCoefficient;
      startRow[rangeIndex + 1] =
        (startRow[rangeIndex + 1] ?? 0) + firstCoefficient * secondCoefficient;
      endRow[rangeIndex] =
        (endRow[rangeIndex] ?? 0) + firstCoefficient * secondCoefficient;
      endRow[rangeIndex + 1] =
        (endRow[rangeIndex + 1] ?? 0) + secondCoefficient * secondCoefficient;
      xValues[rangeIndex] =
        (xValues[rangeIndex] ?? 0) + firstCoefficient * xResidual;
      xValues[rangeIndex + 1] =
        (xValues[rangeIndex + 1] ?? 0) + secondCoefficient * xResidual;
      yValues[rangeIndex] =
        (yValues[rangeIndex] ?? 0) + firstCoefficient * yResidual;
      yValues[rangeIndex + 1] =
        (yValues[rangeIndex + 1] ?? 0) + secondCoefficient * yResidual;
    }
  });

  const priors = forwardTangentPriors(knots, intervals);
  const closed =
    knots.length > 3 &&
    Math.hypot(
      (knots.at(-1)?.x ?? 0) - (knots[0]?.x ?? 0),
      (knots.at(-1)?.y ?? 0) - (knots[0]?.y ?? 0),
    ) <= 1e-8;
  if (closed) {
    const previous = requiredContinuityValue(
      knots.at(-2),
      'previous seam knot',
    );
    const next = requiredContinuityValue(knots[1], 'next seam knot');
    const span = (intervals.at(-1) ?? 1) + (intervals[0] ?? 1);
    const periodicPrior = {
      x: (next.x - previous.x) / (3 * span),
      y: (next.y - previous.y) / (3 * span),
    };
    priors[0] = periodicPrior;
    priors[priors.length - 1] = periodicPrior;
  }
  // A chord-derived prior regularizes sparse/noisy C1 fits.
  priors.forEach((prior, index) => {
    const weight = Math.max(1e-8, (normal[index]?.[index] ?? 0) * 0.5);
    const normalRow = requiredContinuityValue(
      normal[index],
      'prior normal row',
    );
    normalRow[index] = (normalRow[index] ?? 0) + weight;
    xValues[index] = (xValues[index] ?? 0) + weight * prior.x;
    yValues[index] = (yValues[index] ?? 0) + weight * prior.y;
  });
  const seamConstraints: LinearConstraint[] = closed
    ? [
        {
          coefficients: knots.map((_, index) => {
            if (index === 0) return 1;
            if (index === knots.length - 1) return -1;
            return 0;
          }),
          value: 0,
        },
      ]
    : [];
  const xTangents = solveConstrainedLeastSquares(
    normal,
    xValues,
    seamConstraints,
  );
  const yTangents = solveConstrainedLeastSquares(
    normal,
    yValues,
    seamConstraints,
  );
  if (xTangents === null || yTangents === null) return [];
  priors.forEach((prior, index) => {
    const priorMagnitudeSquared = prior.x ** 2 + prior.y ** 2;
    const forwardProjection =
      (xTangents[index] ?? 0) * prior.x + (yTangents[index] ?? 0) * prior.y;
    if (
      priorMagnitudeSquared > 1e-12 &&
      forwardProjection < priorMagnitudeSquared * 0.1
    ) {
      xTangents[index] = prior.x;
      yTangents[index] = prior.y;
    }
  });
  if (closed) {
    const lastIndex = knots.length - 1;
    const seam = {
      x: ((xTangents[0] ?? 0) + (xTangents[lastIndex] ?? 0)) / 2,
      y: ((yTangents[0] ?? 0) + (yTangents[lastIndex] ?? 0)) / 2,
    };
    xTangents[0] = seam.x;
    yTangents[0] = seam.y;
    xTangents[lastIndex] = seam.x;
    yTangents[lastIndex] = seam.y;
  }

  return ranges.map(({ endIndex, startIndex }, rangeIndex) => {
    const start = requiredContinuityValue(
      points[startIndex],
      'continuous fit range start',
    );
    const end = requiredContinuityValue(
      points[endIndex],
      'continuous fit range end',
    );
    const interval = intervals[rangeIndex] ?? 1;
    const control1 = {
      x: start.x + interval * (xTangents[rangeIndex] ?? 0),
      y: start.y + interval * (yTangents[rangeIndex] ?? 0),
    };
    const control2 = {
      x: end.x - interval * (xTangents[rangeIndex + 1] ?? 0),
      y: end.y - interval * (yTangents[rangeIndex + 1] ?? 0),
    };
    const parameters = chordParameters(points, startIndex, endIndex);
    const cost = cubicFitCost(points, parameters, startIndex, endIndex, {
      control1,
      control2,
      end,
      start,
    });
    return { control1, control2, cost, end };
  });
}

/** Fits a requested count of tangent- or curvature-continuous absolute cubics. */
export function adaptiveContinuousFit(
  points: readonly Point[],
  segmentCount: number,
  continuity: Exclude<SplineContinuity, 'c0'>,
): ContinuousFittedCubic[] {
  const origin = points[0];
  if (origin === undefined) return [];
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const scale = Math.max(
    1e-6,
    Math.hypot(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    ),
  );
  const normalized = points.map(({ x, y }) => ({
    x: (x - origin.x) / scale,
    y: (y - origin.y) / scale,
  }));
  const indexes = [0, normalized.length - 1];
  let fitted: ContinuousFittedCubic[] = [];
  while (indexes.length - 1 <= segmentCount) {
    const ranges = indexes.slice(1).map((endIndex, index) => ({
      endIndex,
      startIndex: indexes[index] ?? 0,
    }));
    fitted = fitContinuousBezierRanges(normalized, ranges, continuity);
    if (indexes.length - 1 === segmentCount || fitted.length === 0) break;
    let splitIndex = -1;
    let splitPriority = Number.NEGATIVE_INFINITY;
    ranges.forEach(({ endIndex, startIndex }, rangeIndex) => {
      const cubic = fitted[rangeIndex];
      const start = normalized[startIndex];
      if (cubic === undefined || start === undefined) return;
      const parameters = chordParameters(normalized, startIndex, endIndex);
      let rangeLength = 0;
      for (let index = startIndex + 1; index <= endIndex; index += 1) {
        const previous = normalized[index - 1];
        const point = normalized[index];
        if (previous !== undefined && point !== undefined) {
          rangeLength += Math.hypot(point.x - previous.x, point.y - previous.y);
        }
      }
      let rangeSplitIndex = -1;
      let rangeSplitError = Number.NEGATIVE_INFINITY;
      let rangeSquaredError = 0;
      const rangeErrors: { error: number; index: number }[] = [];
      for (let index = startIndex + 1; index < endIndex; index += 1) {
        const point = normalized[index];
        const parameter = parameters[index - startIndex];
        if (point === undefined || parameter === undefined) continue;
        const candidate = cubicPoint(
          start,
          cubic.control1,
          cubic.control2,
          cubic.end,
          parameter,
        );
        const error =
          (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
        rangeErrors.push({ error, index });
        rangeSquaredError += error;
        if (error > rangeSplitError) {
          rangeSplitError = error;
          rangeSplitIndex = index;
        }
      }
      const span = Math.max(1, endIndex - startIndex);
      const balancedError = ({ error, index }: (typeof rangeErrors)[number]) =>
        error * (0.2 + 0.8 * Math.sin((Math.PI * (index - startIndex)) / span));
      rangeSplitIndex =
        rangeErrors.sort(
          (first, second) => balancedError(second) - balancedError(first),
        )[0]?.index ?? rangeSplitIndex;
      // Integrated priority prevents a short difficult feature from consuming
      // every knot while a long underfit remainder is left unrepresented.
      const priority =
        rangeSquaredError * Math.sqrt(Math.max(1e-8, rangeLength));
      if (priority > splitPriority) {
        splitPriority = priority;
        splitIndex = rangeSplitIndex;
      }
    });
    if (splitIndex < 0) break;
    indexes.push(splitIndex);
    indexes.sort((first, second) => first - second);
  }
  return fitted.map(({ control1, control2, cost, end }) => ({
    control1: {
      x: origin.x + control1.x * scale,
      y: origin.y + control1.y * scale,
    },
    control2: {
      x: origin.x + control2.x * scale,
      y: origin.y + control2.y * scale,
    },
    cost: cost * scale ** 2,
    end: { x: origin.x + end.x * scale, y: origin.y + end.y * scale },
  }));
}

function enforceNormalizedBezierContinuity(
  element: LineElement,
  continuity: Exclude<SplineContinuity, 'c0'>,
  fixedControl?: {
    control: 'control1' | 'control2';
    segmentIndex: number;
  },
): LineElement {
  const knots = [
    { x: 0, y: 0 },
    ...element.segments.map(({ end }) => ({ ...end })),
  ];
  if (knots.length < 2) return { ...element, splineContinuity: continuity };
  const intervals = splineIntervals(knots);
  const closed =
    knots.length > 3 &&
    Math.hypot(
      (knots.at(-1)?.x ?? 0) - (knots[0]?.x ?? 0),
      (knots.at(-1)?.y ?? 0) - (knots[0]?.y ?? 0),
    ) <= 1e-8;

  const desired = knots.map((knot, index) => {
    const vectors: Point[] = [];
    const previous = element.segments[index - 1];
    const next = element.segments[index];
    const previousInterval = intervals[index - 1];
    const nextInterval = intervals[index];
    if (previous !== undefined && previousInterval !== undefined) {
      vectors.push({
        x: (knot.x - previous.control2.x) / previousInterval,
        y: (knot.y - previous.control2.y) / previousInterval,
      });
    }
    if (next !== undefined && nextInterval !== undefined) {
      vectors.push({
        x: (next.control1.x - knot.x) / nextInterval,
        y: (next.control1.y - knot.y) / nextInterval,
      });
    }
    return {
      x: vectors.reduce((sum, vector) => sum + vector.x, 0) / vectors.length,
      y: vectors.reduce((sum, vector) => sum + vector.y, 0) / vectors.length,
    };
  });
  let fixedTangentIndex: number | undefined;
  if (fixedControl !== undefined) {
    const segment = element.segments[fixedControl.segmentIndex];
    if (segment !== undefined) {
      fixedTangentIndex =
        fixedControl.segmentIndex +
        (fixedControl.control === 'control2' ? 1 : 0);
      const knot = knots[fixedTangentIndex];
      const interval = intervals[fixedControl.segmentIndex];
      if (knot !== undefined && interval !== undefined) {
        desired[fixedTangentIndex] =
          fixedControl.control === 'control1'
            ? {
                x: (segment.control1.x - knot.x) / interval,
                y: (segment.control1.y - knot.y) / interval,
              }
            : {
                x: (knot.x - segment.control2.x) / interval,
                y: (knot.y - segment.control2.y) / interval,
              };
      }
    }
  }

  let tangents = desired;
  if (continuity === 'c1' && closed) {
    const lastIndex = desired.length - 1;
    const firstDesiredTangent = requiredContinuityValue(
      desired[0],
      'first desired seam tangent',
    );
    const lastDesiredTangent = requiredContinuityValue(
      desired[lastIndex],
      'last desired seam tangent',
    );
    let seam: Point;
    if (fixedTangentIndex === 0) seam = firstDesiredTangent;
    else if (fixedTangentIndex === lastIndex) seam = lastDesiredTangent;
    else {
      seam = {
        x: (firstDesiredTangent.x + lastDesiredTangent.x) / 2,
        y: (firstDesiredTangent.y + lastDesiredTangent.y) / 2,
      };
    }
    desired[0] = seam;
    desired[lastIndex] = seam;
  }
  if (continuity === 'c2') {
    const normal = Array.from({ length: knots.length }, (_, row) =>
      Array.from({ length: knots.length }, (_, column) => {
        if (row !== column) return 0;
        const endpointWeight = row === 0 || row === knots.length - 1 ? 1 : 2;
        return endpointWeight + 1e-8;
      }),
    );
    const coordinateTangents = (coordinate: 'x' | 'y') => {
      const values = desired.map(
        (tangent, index) =>
          tangent[coordinate] *
          (index === 0 || index === knots.length - 1 ? 1 : 2),
      );
      const constraints = secondDerivativeConstraints(
        knots,
        intervals,
        coordinate,
      );
      if (closed) {
        constraints.push(
          ...periodicSeamConstraints(knots, intervals, coordinate),
        );
      }
      if (fixedTangentIndex !== undefined && !closed) {
        const coefficients = Array<number>(knots.length).fill(0);
        coefficients[fixedTangentIndex] = 1;
        constraints.push({
          coefficients,
          value: desired[fixedTangentIndex]?.[coordinate] ?? 0,
        });
      }
      return solveConstrainedLeastSquares(normal, values, constraints);
    };
    const xTangents = coordinateTangents('x');
    const yTangents = coordinateTangents('y');
    if (xTangents === null || yTangents === null) return element;
    tangents = knots.map((_, index) => ({
      x: xTangents[index] ?? 0,
      y: yTangents[index] ?? 0,
    }));
  }

  const segments: BezierSegment[] = element.segments.map((segment, index) => {
    const start = requiredContinuityValue(knots[index], 'segment start knot');
    const end = requiredContinuityValue(knots[index + 1], 'segment end knot');
    const startTangent = requiredContinuityValue(
      tangents[index],
      'segment start tangent',
    );
    const endTangent = requiredContinuityValue(
      tangents[index + 1],
      'segment end tangent',
    );
    const interval = intervals[index] ?? 1;
    return {
      ...segment,
      control1: {
        x: start.x + interval * startTangent.x,
        y: start.y + interval * startTangent.y,
      },
      control2: {
        x: end.x - interval * endTangent.x,
        y: end.y - interval * endTangent.y,
      },
    };
  });
  return { ...element, segments, splineContinuity: continuity };
}

/** Projects persisted controls onto the requested continuity while preserving fixed edits. */
export function enforceBezierContinuity(
  element: LineElement,
  continuity: SplineContinuity,
  fixedControl?: {
    control: 'control1' | 'control2';
    segmentIndex: number;
  },
): LineElement {
  if (element.pathKind !== 'bezier') return element;
  if (continuity === 'c0') {
    return { ...element, splineContinuity: continuity };
  }
  const knots = [{ x: 0, y: 0 }, ...element.segments.map(({ end }) => end)];
  const xs = knots.map(({ x }) => x);
  const ys = knots.map(({ y }) => y);
  const scale = Math.max(
    1e-6,
    Math.hypot(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    ),
  );
  const normalized: LineElement = {
    ...element,
    height: element.height / scale,
    segments: element.segments.map(({ control1, control2, end }) => ({
      control1: { x: control1.x / scale, y: control1.y / scale },
      control2: { x: control2.x / scale, y: control2.y / scale },
      end: { x: end.x / scale, y: end.y / scale },
    })),
    width: element.width / scale,
  };
  let projected = enforceNormalizedBezierContinuity(
    normalized,
    continuity,
    fixedControl,
  );
  if (continuity === 'c2') {
    const extent = Math.max(
      ...projected.segments
        .flatMap(({ control1, control2, end }) => [control1, control2, end])
        .map(({ x, y }) => Math.hypot(x, y)),
    );
    if (!Number.isFinite(extent) || extent > 8) {
      const normalizedKnots = [
        { x: 0, y: 0 },
        ...normalized.segments.map(({ end }) => end),
      ];
      const ranges = normalized.segments.map((_, index) => ({
        endIndex: index + 1,
        startIndex: index,
      }));
      const natural = fitNaturalC2BezierRanges(normalizedKnots, ranges);
      if (natural.length === normalized.segments.length) {
        projected = {
          ...normalized,
          segments: natural.map(({ control1, control2, end }) => ({
            control1,
            control2,
            end,
          })),
          splineContinuity: 'c2',
        };
      }
    }
  }
  return {
    ...projected,
    height: projected.height * scale,
    segments: projected.segments.map(({ control1, control2, end }) => ({
      control1: { x: control1.x * scale, y: control1.y * scale },
      control2: { x: control2.x * scale, y: control2.y * scale },
      end: { x: end.x * scale, y: end.y * scale },
    })),
    width: projected.width * scale,
  };
}
