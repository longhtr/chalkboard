/** Shared stroke-pattern geometry for canvas rendering, SVG export, and controls. */
import type { ElementStyle } from './elementSchema.js';

/** Tightest selectable empty run between adjacent dots or dashes. */
export const MIN_STROKE_DASH_GAP = 1;
/** Widest selectable gap; larger stored values remain loadable and are clamped. */
export const MAX_STROKE_DASH_GAP = 100;

type PatternStyle = Pick<
  ElementStyle,
  'strokeDashGap' | 'strokeStyle' | 'strokeWidth'
>;

/**
 * Returns the world-space empty run between marks.
 *
 * An absent value intentionally reproduces Chalkboard's original patterns, so
 * opening an older board neither changes its appearance nor rewrites it.
 */
export function strokeDashGap(style: PatternStyle): number {
  const originalGap =
    style.strokeStyle === 'dotted'
      ? Math.max(4, style.strokeWidth * 2.5)
      : style.strokeWidth * 3;
  const requested =
    style.strokeDashGap !== undefined && Number.isFinite(style.strokeDashGap)
      ? style.strokeDashGap
      : originalGap;
  return Math.min(
    MAX_STROKE_DASH_GAP,
    Math.max(MIN_STROKE_DASH_GAP, requested),
  );
}

/** Canvas/SVG dash-array runs in world-space units. */
export function strokeDashPattern(style: PatternStyle): readonly number[] {
  if (style.strokeStyle === 'dashed') {
    return [style.strokeWidth * 4, strokeDashGap(style)];
  }
  if (style.strokeStyle === 'dotted') {
    return [1, strokeDashGap(style)];
  }
  return [];
}
