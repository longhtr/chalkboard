/** Source-shape invariants shared by mount, source return, history, and replacement. */
import { describe, expect, it } from 'vitest';

import { MATHLIVE_LINE_BREAK } from './mixedMath';
import { materializeMathLiveEditorDocument } from './editorDocumentModel';

describe('MathLive editor document materialization', () => {
  it('keeps one mixed-document root while classifying formula-only source', () => {
    expect(materializeMathLiveEditorDocument('$x^2$', 'text')).toEqual({
      defaultMode: 'text',
      hasExplicitMath: true,
      retainsMathOnlySource: true,
      value: '$x^2$',
    });
    expect(materializeMathLiveEditorDocument('before $x$', 'math')).toEqual({
      defaultMode: 'text',
      hasExplicitMath: true,
      retainsMathOnlySource: false,
      value: 'before $x$',
    });
    expect(materializeMathLiveEditorDocument('prose', 'math')).toEqual({
      defaultMode: 'text',
      hasExplicitMath: false,
      retainsMathOnlySource: false,
      value: 'prose',
    });
  });

  it('keeps every terminal row and anchors only a math-input blank row', () => {
    expect(materializeMathLiveEditorDocument('$x$\n', 'text')).toEqual({
      defaultMode: 'text',
      hasExplicitMath: true,
      retainsMathOnlySource: false,
      value: `$x$${MATHLIVE_LINE_BREAK}`,
    });
    expect(materializeMathLiveEditorDocument('$x$\n', 'math')).toEqual({
      defaultMode: 'text',
      hasExplicitMath: true,
      retainsMathOnlySource: false,
      value: `$x$${MATHLIVE_LINE_BREAK}$\\placeholder{}$`,
    });
    expect(materializeMathLiveEditorDocument('$x$\n\n', 'math')).toEqual({
      defaultMode: 'text',
      hasExplicitMath: true,
      retainsMathOnlySource: false,
      value: `$x$${MATHLIVE_LINE_BREAK}${MATHLIVE_LINE_BREAK}$\\placeholder{}$`,
    });
  });
});
