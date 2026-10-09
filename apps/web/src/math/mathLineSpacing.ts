/** Converts persisted line-spacing ratios into the active/static CSS metrics used by MathLive layouts. */
import { DEFAULT_EQUATION_LINE_SPACING } from '@chalkboard/shared';

/**
 * Maps the block line-height control to MathLive's relative array row spacing.
 *
 * The default line height maps to 1, which is LaTeX's own default, so array
 * rows are as tight here as they are there. A floor was tried and removed: it
 * loosened every array to work around row collisions that belong to the array
 * layout itself, and did nothing for the delimiter misalignment beside them.
 */
export function mathArrayStretch(lineSpacing?: number): number {
  return (
    (lineSpacing ?? DEFAULT_EQUATION_LINE_SPACING) /
    DEFAULT_EQUATION_LINE_SPACING
  );
}
