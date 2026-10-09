/** Pure materialization of canonical mixed source into one MathLive document. */
import {
  isMathOnlyMixedSource,
  mathSegments,
  toMathLiveEditorSource,
} from './mixedMath';

export interface MathLiveEditorDocument {
  defaultMode: 'math' | 'text';
  hasExplicitMath: boolean;
  retainsMathOnlySource: boolean;
  value: string;
}

/**
 * Derives every source-shape flag and the matching MathLive representation.
 *
 * A terminal blank row needs a math placeholder only while the requested input
 * policy is math. It gives the caret a real math parent after the final row;
 * canonical publication removes the placeholder again.
 */
export function materializeMathLiveEditorDocument(
  expandedSource: string,
  inputMode: 'math' | 'text',
): MathLiveEditorDocument {
  const math = mathSegments(expandedSource);
  const retainsMathOnlySource = isMathOnlyMixedSource(expandedSource);
  return {
    // The canonical language is mixed even when this particular snapshot is
    // one formula. Keeping one text root lets later mode/source transitions add
    // prose and rows without asking MathLive to reinterpret the root parent.
    defaultMode: 'text',
    hasExplicitMath: math.length > 0,
    retainsMathOnlySource,
    value: toMathLiveEditorSource(
      inputMode === 'math' && expandedSource.endsWith('\n')
        ? `${expandedSource}$\\placeholder{}$`
        : expandedSource,
    ),
  };
}
