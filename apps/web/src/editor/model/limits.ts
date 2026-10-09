/**
 * Central editor cardinality and numeric bounds. Admission helpers return a
 * user-facing reason rather than partially applying an oversized operation.
 */
import { DEFAULT_EQUATION_LINE_SPACING } from '@chalkboard/shared';

export const MAX_BOARD_ELEMENTS = 10_000;
export const MAX_BOARD_BYTES = 16 * 1024 * 1024;
export const MAX_OBJECT_CLIPBOARD_CHARACTERS = 16 * 1024 * 1024;

export const MIN_TEXT_SIZE = 12;
export const MAX_TEXT_SIZE = 200;
export const DEFAULT_TEXT_SIZE = 30;
export const MIN_LINE_SPACING = 0.8;
export const MAX_LINE_SPACING = 5;
export const DEFAULT_LINE_SPACING = DEFAULT_EQUATION_LINE_SPACING;

export const MIN_GRID_SPACING = 8;
export const MAX_GRID_SPACING = 100;
export const MIN_GRID_DOT_SIZE = 0.5;
export const MAX_GRID_DOT_SIZE = 3;

export const BOARD_ELEMENT_LIMIT_MESSAGE =
  `This board is limited to ${MAX_BOARD_ELEMENTS.toLocaleString('en-US')} objects. ` +
  'Delete objects before adding more.';
export const OBJECT_CLIPBOARD_LIMIT_MESSAGE =
  'The selected objects are too large to copy as one clipboard operation.';

/**
 * Existing over-limit data remains reducible, but no operation may retain or
 * increase an over-limit count. Ordinary boards must stay within the limit.
 */
export function boardElementChangeFits(
  currentCount: number,
  nextCount: number,
): boolean {
  return (
    Number.isSafeInteger(currentCount) &&
    currentCount >= 0 &&
    Number.isSafeInteger(nextCount) &&
    nextCount >= 0 &&
    (nextCount <= MAX_BOARD_ELEMENTS ||
      (currentCount > MAX_BOARD_ELEMENTS && nextCount < currentCount))
  );
}

/** Reports whether adding a nonnegative count keeps an ordinary board in bounds. */
export function boardElementAdditionFits(
  currentCount: number,
  addedCount: number,
): boolean {
  return (
    Number.isSafeInteger(currentCount) &&
    currentCount >= 0 &&
    Number.isSafeInteger(addedCount) &&
    addedCount >= 0 &&
    currentCount <= MAX_BOARD_ELEMENTS - addedCount
  );
}
