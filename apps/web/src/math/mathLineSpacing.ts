/** Converts persisted line-spacing ratios into the active/static CSS metrics used by MathLive layouts. */
import { DEFAULT_EQUATION_LINE_SPACING } from '@chalkboard/shared';

/** Maps the block line-height control to MathLive's relative array row spacing. */
export function mathArrayStretch(lineSpacing?: number): number {
  return (
    (lineSpacing ?? DEFAULT_EQUATION_LINE_SPACING) /
    DEFAULT_EQUATION_LINE_SPACING
  );
}
