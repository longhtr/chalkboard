/**
 * Hostile-data boundary for persisted board elements. Readers validate shape,
 * finite geometry, limits, and legacy fields before constructing current typed
 * records; writers emit only the current stable representation.
 */
import {
  isEquationElement,
  MAX_FREEHAND_POINTS,
  MIN_SHAPE_FILL_SPACING,
  MIN_TRAPEZOID_TOP_EDGE_RATIO,
  type BezierSegment,
  type BoardElement,
  type EquationElement,
  type LineArrowheads,
  type LineElement,
  type PathKind,
  type Point,
  type ShapeElement,
  type SplineContinuity,
} from '@chalkboard/shared';

import {
  isEmptyMixedSource,
  migrateLegacyMathSource,
  normalizeMathLiveSource,
  unwrapWholeTextColor,
} from '../../math/mixedMath';
import {
  DEFAULT_LINE_SPACING,
  MAX_LINE_SPACING,
  MIN_LINE_SPACING,
} from './limits';
/** Maximum encoded compatibility snapshot accepted from a URL fragment. */
export const MAX_SHARED_BOARD_CHARACTERS = 100_000;
const CLOUD_ASSET_SOURCE =
  /^\/api\/boards\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Moves a whole-equation text-color wrapper into the element stroke color. */
export function hoistWholeTextColor(
  element: EquationElement,
  source: string,
): EquationElement {
  const unwrapped = unwrapWholeTextColor(source);
  return unwrapped === null
    ? { ...element, source }
    : { ...element, source: unwrapped.source, strokeColor: unwrapped.color };
}

function validPoint(point: unknown): point is Point {
  if (typeof point !== 'object' || point === null) return false;
  const candidate = point as Record<string, unknown>;
  return (
    typeof candidate.x === 'number' &&
    Number.isFinite(candidate.x) &&
    typeof candidate.y === 'number' &&
    Number.isFinite(candidate.y)
  );
}

/** Validates all persisted fields and bounded nested geometry for one element. */
export function isStoredBoardElement(value: unknown): value is BoardElement {
  if (typeof value !== 'object' || value === null) return false;
  const element = value as Record<string, unknown>;
  const type = element.type;
  const baseIsValid =
    typeof element.id === 'string' &&
    typeof element.createdBy === 'string' &&
    typeof element.strokeColor === 'string' &&
    (element.strokeColorDark === undefined ||
      typeof element.strokeColorDark === 'string') &&
    typeof element.backgroundColor === 'string' &&
    (element.backgroundColorDark === undefined ||
      typeof element.backgroundColorDark === 'string') &&
    [
      element.rotation,
      element.x,
      element.y,
      element.width,
      element.height,
      element.strokeWidth,
      element.opacity,
    ].every(
      (number) => typeof number === 'number' && Number.isFinite(number),
    ) &&
    (element.strokeStyle === undefined ||
      ['solid', 'dashed', 'dotted'].includes(String(element.strokeStyle)));
  if (!baseIsValid) return false;

  if (type === 'image') {
    return (
      typeof element.name === 'string' &&
      typeof element.source === 'string' &&
      (/^data:image\/(?:avif|gif|jpeg|png|svg\+xml|webp);base64,/i.test(
        element.source,
      ) ||
        CLOUD_ASSET_SOURCE.test(element.source))
    );
  }
  if (type === 'equation') {
    return (
      (typeof element.source === 'string' ||
        typeof element.latex === 'string') &&
      typeof element.fontSize === 'number' &&
      Number.isFinite(element.fontSize) &&
      element.fontSize > 0 &&
      (element.sourceFontSize === undefined ||
        (typeof element.sourceFontSize === 'number' &&
          Number.isFinite(element.sourceFontSize) &&
          element.sourceFontSize > 0))
    );
  }
  if (type === 'line') {
    return (
      (element.arrowheads === undefined ||
        ['none', 'end', 'both'].includes(String(element.arrowheads))) &&
      (element.endArrow === undefined ||
        typeof element.endArrow === 'boolean') &&
      (element.pathKind === undefined ||
        ['straight', 'bezier', 'orthogonal', 'arc', 's-curve'].includes(
          String(element.pathKind),
        )) &&
      (element.splineContinuity === undefined ||
        (element.pathKind === 'bezier' &&
          ['c0', 'c1', 'c2'].includes(String(element.splineContinuity)))) &&
      (element.control1 === undefined || validPoint(element.control1)) &&
      (element.control2 === undefined || validPoint(element.control2)) &&
      (element.segments === undefined ||
        (Array.isArray(element.segments) &&
          element.segments.every((segment) => {
            if (typeof segment !== 'object' || segment === null) return false;
            const candidate = segment as Record<string, unknown>;
            return (
              validPoint(candidate.control1) &&
              validPoint(candidate.control2) &&
              validPoint(candidate.end)
            );
          })))
    );
  }
  if (type === 'arrow') return true;
  if (type === 'freehand') {
    return (
      (element.arrowheads === undefined ||
        ['none', 'end', 'both'].includes(String(element.arrowheads))) &&
      Array.isArray(element.points) &&
      element.points.length >= 2 &&
      element.points.length <= MAX_FREEHAND_POINTS &&
      element.points.every(validPoint)
    );
  }
  if (type === 'shape') {
    return (
      [
        'rectangle',
        'triangle',
        'ellipse',
        'diamond',
        'pentagon',
        'hexagon',
        'parallelogram',
        'trapezoid',
        'star',
      ].includes(String(element.shapeKind)) &&
      typeof element.cornerRadius === 'number' &&
      Number.isFinite(element.cornerRadius) &&
      element.cornerRadius >= 0 &&
      (element.fillStyle === undefined ||
        ['cross-hatch', 'hachure', 'solid'].includes(
          String(element.fillStyle),
        )) &&
      // Bounded below but not above, like `cornerRadius`: rendering clamps to
      // the selectable range, so a board written against wider bounds keeps its
      // shapes instead of having them dropped when those bounds move.
      (element.fillSpacing === undefined ||
        (typeof element.fillSpacing === 'number' &&
          Number.isFinite(element.fillSpacing) &&
          element.fillSpacing >= MIN_SHAPE_FILL_SPACING)) &&
      (element.trapezoidTopLeft === undefined ||
        (typeof element.trapezoidTopLeft === 'number' &&
          Number.isFinite(element.trapezoidTopLeft) &&
          element.trapezoidTopLeft >= 0 &&
          element.trapezoidTopLeft <= 1)) &&
      (element.trapezoidTopRight === undefined ||
        (typeof element.trapezoidTopRight === 'number' &&
          Number.isFinite(element.trapezoidTopRight) &&
          element.trapezoidTopRight >= 0 &&
          element.trapezoidTopRight <= 1)) &&
      (typeof element.trapezoidTopLeft !== 'number' ||
        typeof element.trapezoidTopRight !== 'number' ||
        element.trapezoidTopRight - element.trapezoidTopLeft >=
          MIN_TRAPEZOID_TOP_EDGE_RATIO)
    );
  }
  return type === 'rectangle';
}

function migrateStoredLine(element: LineElement): LineElement {
  // Validation accepts historical fields that are intentionally absent from
  // the current line contract; this migration is their only typed boundary.
  const stored = element as unknown as Omit<LineElement, 'pathKind'> & {
    control1?: Point;
    control2?: Point;
    endArrow?: boolean;
    pathKind?: PathKind | 'arc' | 's-curve';
    segments?: BezierSegment[];
    splineContinuity?: SplineContinuity;
  };
  const arrowheads: LineArrowheads = ['none', 'end', 'both'].includes(
    String(stored.arrowheads),
  )
    ? (stored.arrowheads ?? 'none')
    : stored.endArrow === true
      ? 'end'
      : 'none';
  const normalizedStored = { ...stored };
  delete normalizedStored.endArrow;
  const straightSegment: BezierSegment = {
    control1: stored.control1 ?? {
      x: stored.width / 3,
      y: stored.height / 3,
    },
    control2: stored.control2 ?? {
      x: (stored.width * 2) / 3,
      y: (stored.height * 2) / 3,
    },
    end: { x: stored.width, y: stored.height },
  };
  if (stored.pathKind === 'bezier' || stored.pathKind === 'orthogonal') {
    return {
      ...normalizedStored,
      arrowheads,
      pathKind: stored.pathKind,
      segments:
        stored.segments !== undefined && stored.segments.length > 0
          ? stored.segments
          : [straightSegment],
      ...(stored.pathKind === 'bezier'
        ? { splineContinuity: stored.splineContinuity ?? 'c0' }
        : {}),
      type: 'line',
    };
  }
  if (stored.pathKind !== 'arc' && stored.pathKind !== 's-curve') {
    return {
      ...normalizedStored,
      arrowheads,
      pathKind: 'straight',
      segments: stored.segments ?? [straightSegment],
      type: 'line',
    };
  }

  const length = Math.hypot(stored.width, stored.height);
  const normal =
    length === 0
      ? { x: 0, y: 0 }
      : { x: -stored.height / length, y: stored.width / length };
  const bend = Math.min(100, length * 0.35);
  let segment: BezierSegment;
  if (stored.pathKind === 'arc') {
    const quadraticControl = {
      x: stored.width / 2 + normal.x * bend,
      y: stored.height / 2 + normal.y * bend,
    };
    segment = {
      control1: {
        x: (quadraticControl.x * 2) / 3,
        y: (quadraticControl.y * 2) / 3,
      },
      control2: {
        x: stored.width + ((quadraticControl.x - stored.width) * 2) / 3,
        y: stored.height + ((quadraticControl.y - stored.height) * 2) / 3,
      },
      end: { x: stored.width, y: stored.height },
    };
  } else {
    segment = {
      control1: {
        x: stored.width / 3 + normal.x * bend,
        y: stored.height / 3 + normal.y * bend,
      },
      control2: {
        x: (stored.width * 2) / 3 - normal.x * bend,
        y: (stored.height * 2) / 3 - normal.y * bend,
      },
      end: { x: stored.width, y: stored.height },
    };
  }
  return {
    ...normalizedStored,
    arrowheads,
    pathKind: 'bezier',
    segments: [segment],
    splineContinuity: 'c0',
    type: 'line',
  };
}

/**
 * Parses, migrates, normalizes, and deduplicates a stored element array. The
 * count is deliberately not bounded here: `boardElementChangeFits` keeps an
 * over-limit board loadable so it can still be reduced, and truncating on load
 * would destroy the data that recovery path exists to save.
 */
export function parseStoredElements(value: string | null): BoardElement[] {
  try {
    if (value === null) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const elements = parsed.filter(isStoredBoardElement).map((element) => {
      if (element.type === 'rectangle') {
        return {
          ...element,
          cornerRadius: 0,
          shapeKind: 'rectangle',
          strokeStyle: element.strokeStyle ?? 'solid',
          type: 'shape',
        } satisfies ShapeElement;
      }
      if (element.type === 'shape') {
        return { ...element, strokeStyle: element.strokeStyle ?? 'solid' };
      }
      if (element.type === 'line') {
        return migrateStoredLine({
          ...element,
          strokeStyle: element.strokeStyle ?? 'solid',
        });
      }
      if (element.type === 'freehand') {
        return { ...element, strokeStyle: element.strokeStyle ?? 'solid' };
      }
      if (!isEquationElement(element)) return element;
      const stored = element as EquationElement & {
        inputMode?: unknown;
        latex?: unknown;
        source?: unknown;
      };
      const { inputMode: legacyInputMode, ...globalModeElement } = stored;
      void legacyInputMode;
      const storedLineSpacing = stored.lineSpacing;
      const normalizedLineSpacing =
        typeof storedLineSpacing === 'number' &&
        Number.isFinite(storedLineSpacing) &&
        storedLineSpacing >= MIN_LINE_SPACING &&
        storedLineSpacing <= MAX_LINE_SPACING
          ? storedLineSpacing
          : DEFAULT_LINE_SPACING;
      if (typeof stored.source === 'string') {
        const source = normalizeMathLiveSource(stored.source);
        return hoistWholeTextColor(
          {
            ...globalModeElement,
            lineSpacing: normalizedLineSpacing,
            source,
          } as EquationElement,
          source,
        );
      }
      const { latex, ...legacy } = globalModeElement;
      return {
        ...legacy,
        lineSpacing: normalizedLineSpacing,
        source: migrateLegacyMathSource(typeof latex === 'string' ? latex : ''),
      } as EquationElement;
    });
    const claimedIds = new Set<string>();
    return elements.filter((element) => {
      if (isEquationElement(element) && isEmptyMixedSource(element.source)) {
        return false;
      }
      // Repeated identifiers arrive from hand-edited storage and shared snapshot
      // links. React keys and every id-keyed lookup assume uniqueness, so the
      // first occurrence keeps the id and later copies are dropped.
      if (claimedIds.has(element.id)) return false;
      claimedIds.add(element.id);
      return true;
    });
  } catch {
    return [];
  }
}

/** Encodes a bounded board into the editable URL-fragment compatibility format. */
export function encodeBoardSnapshot(elements: BoardElement[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(elements));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  if (encoded.length > MAX_SHARED_BOARD_CHARACTERS) {
    throw new Error(
      'This board is too large for a snapshot link. Use Export board instead.',
    );
  }
  return encoded;
}

/** Decodes a URL-fragment snapshot or returns null for malformed/oversized input. */
export function decodeBoardSnapshot(value: string): BoardElement[] | null {
  try {
    if (value.length > MAX_SHARED_BOARD_CHARACTERS) return null;
    const padded = value.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const serialized = new TextDecoder().decode(bytes);
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every(isStoredBoardElement)) return null;
    return parseStoredElements(serialized);
  } catch {
    return null;
  }
}
