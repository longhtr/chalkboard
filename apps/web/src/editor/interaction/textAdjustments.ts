/** Keeps an equation's visual center stable when text size or line spacing changes its bounds. */
import {
  MAX_LINE_SPACING,
  MAX_TEXT_SIZE,
  MIN_LINE_SPACING,
  MIN_TEXT_SIZE,
} from '../model/limits';

/** Applies one bounded tenth-step line-spacing adjustment. */
export function adjustedLineSpacing(
  current: number,
  direction: number,
): number {
  return Math.min(
    MAX_LINE_SPACING,
    Math.max(
      MIN_LINE_SPACING,
      Math.round((current + direction * 0.1) * 10) / 10,
    ),
  );
}

/** Applies one bounded whole-pixel text-size adjustment. */
export function adjustedTextSize(current: number, direction: number): number {
  return Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, current + direction));
}
