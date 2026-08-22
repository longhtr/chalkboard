/**
 * Pure inspector edits for selected elements. Every function preserves the
 * original array and element identities when the requested state already holds.
 */
import {
  enforceBezierContinuity,
  type BoardElement,
  type ElementStyle,
  type LineArrowheads,
  type PathKind,
  type ShapeElement,
  type SplineContinuity,
} from '@chalkboard/shared';

function changedProperties<Target extends object>(
  value: Target,
  change: Partial<Target>,
): boolean {
  return Object.entries(change).some(
    ([key, next]) => value[key as keyof Target] !== next,
  );
}

/** Applies visual style only to targeted elements whose values differ. */
export function updateElementStyles(
  elements: readonly BoardElement[],
  targetIds: ReadonlySet<string>,
  change: Partial<ElementStyle>,
): BoardElement[] | null {
  let changed = false;
  const updated = elements.map((element) => {
    if (!targetIds.has(element.id) || !changedProperties(element, change)) {
      return element;
    }
    changed = true;
    return { ...element, ...change };
  });
  return changed ? updated : null;
}

/** Applies shape kind, corner radius, or fill settings only to targeted modern shapes. */
export function updateShapeProperties(
  elements: readonly BoardElement[],
  targetIds: ReadonlySet<string>,
  change: Partial<
    Pick<
      ShapeElement,
      'cornerRadius' | 'fillSpacing' | 'fillStyle' | 'shapeKind'
    >
  >,
): BoardElement[] | null {
  let changed = false;
  const updated = elements.map((element) => {
    if (
      element.type !== 'shape' ||
      !targetIds.has(element.id) ||
      !changedProperties(element, change)
    ) {
      return element;
    }
    changed = true;
    return { ...element, ...change };
  });
  return changed ? updated : null;
}

/** Converts targeted line paths and removes Bézier-only continuity when leaving curves. */
export function updateLinePathKind(
  elements: readonly BoardElement[],
  targetIds: ReadonlySet<string>,
  pathKind: PathKind,
  continuity: SplineContinuity,
): BoardElement[] | null {
  let changed = false;
  const updated = elements.map((element) => {
    if (
      element.type !== 'line' ||
      !targetIds.has(element.id) ||
      element.pathKind === pathKind
    ) {
      return element;
    }
    changed = true;
    if (pathKind === 'bezier') {
      return enforceBezierContinuity({ ...element, pathKind }, continuity);
    }
    const { splineContinuity: removedContinuity, ...line } = element;
    void removedContinuity;
    return { ...line, pathKind };
  });
  return changed ? updated : null;
}

/** Reprojects targeted Bézier controls onto the requested continuity. */
export function updateBezierContinuity(
  elements: readonly BoardElement[],
  targetIds: ReadonlySet<string>,
  continuity: SplineContinuity,
): BoardElement[] | null {
  let changed = false;
  const updated = elements.map((element) => {
    if (
      element.type !== 'line' ||
      element.pathKind !== 'bezier' ||
      !targetIds.has(element.id) ||
      element.splineContinuity === continuity
    ) {
      return element;
    }
    changed = true;
    return enforceBezierContinuity(element, continuity);
  });
  return changed ? updated : null;
}

/**
 * Applies endpoint decoration to targeted paths whose value differs. Freehand
 * strokes carry arrowheads on the same terms as lines; their direction comes
 * from the sampled tangent rather than a control point.
 */
/**
 * Sets the rendered corner rounding on selected orthogonal paths. Other path
 * kinds are skipped rather than carrying a radius nothing would draw.
 */
export function updateOrthogonalCornerRadius(
  elements: readonly BoardElement[],
  targetIds: ReadonlySet<string>,
  cornerRadius: number,
): BoardElement[] | null {
  let changed = false;
  const updated = elements.map((element) => {
    if (
      element.type !== 'line' ||
      element.pathKind !== 'orthogonal' ||
      !targetIds.has(element.id) ||
      (element.cornerRadius ?? 0) === cornerRadius
    ) {
      return element;
    }
    changed = true;
    return { ...element, cornerRadius };
  });
  return changed ? updated : null;
}

export function updateLineArrowheads(
  elements: readonly BoardElement[],
  targetIds: ReadonlySet<string>,
  arrowheads: LineArrowheads,
): BoardElement[] | null {
  let changed = false;
  const updated = elements.map((element) => {
    if (
      (element.type !== 'line' && element.type !== 'freehand') ||
      !targetIds.has(element.id) ||
      element.arrowheads === arrowheads
    ) {
      return element;
    }
    changed = true;
    return { ...element, arrowheads };
  });
  return changed ? updated : null;
}
