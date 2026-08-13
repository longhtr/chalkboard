/** Normalizes titles identically before local persistence, cloud updates, and file export. */
import {
  MAX_BOARD_TITLE_LENGTH,
  truncateBoardTitle,
  unicodeScalarLength,
} from '@chalkboard/shared';

export { MAX_BOARD_TITLE_LENGTH, truncateBoardTitle };

/** Visible fallback used whenever trimming leaves no title characters. */
export const DEFAULT_BOARD_TITLE = 'Untitled board';

/** Trims, Unicode-safely truncates, and supplies the nonempty fallback title. */
export function normalizedBoardTitle(title: string): string {
  const normalized = truncateBoardTitle(title.trim());
  return normalized === '' ? DEFAULT_BOARD_TITLE : normalized;
}

/** Builds a recognizable duplicate title without exceeding the scalar limit. */
export function copiedBoardTitle(title: string): string {
  const source = normalizedBoardTitle(title);
  const suffix = ' copy';
  if (unicodeScalarLength(source) + suffix.length <= MAX_BOARD_TITLE_LENGTH) {
    return `${source}${suffix}`;
  }
  const prefix = 'Copy of ';
  return `${prefix}${Array.from(source)
    .slice(0, MAX_BOARD_TITLE_LENGTH - prefix.length)
    .join('')}`;
}
