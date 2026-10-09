/** Covers text/math selection extraction and safe insertion of plain text, LaTeX, multiline, and marker input. */
import { describe, expect, it } from 'vitest';

import {
  clipboardTextFromMathLiveSelection,
  editorClipboardInsertions,
} from './editorClipboard';
import {
  MATHLIVE_LINE_BREAK,
  MATHLIVE_LITERAL_BACKSLASH,
  MATHLIVE_LITERAL_DOLLAR,
} from './mixedMath';

describe('editor clipboard boundary', () => {
  it('exports normalized multiline mixed content without internal markers', () => {
    expect(
      clipboardTextFromMathLiveSelection(
        `Cost ${MATHLIVE_LITERAL_DOLLAR}5${MATHLIVE_LINE_BREAK}path${MATHLIVE_LITERAL_BACKSLASH}file $x+1$\\placeholder{}`,
      ),
    ).toBe('Cost $5\npath\\file $x+1$');
  });

  it('prepares text paste with literal slash, dollar, and line-break markers', () => {
    expect(editorClipboardInsertions('Price $5\r\npath\\file', 'text')).toEqual(
      {
        insertions: [
          {
            lineBreakBefore: false,
            value: `Price ${MATHLIVE_LITERAL_DOLLAR}5`,
          },
          {
            lineBreakBefore: true,
            value: `path${MATHLIVE_LITERAL_BACKSLASH}file`,
          },
        ],
        multiline: true,
      },
    );
  });

  it('unwraps whole-line math delimiters only in math mode', () => {
    expect(editorClipboardInsertions('$$x+1$$\n $y$ ', 'math')).toEqual({
      insertions: [
        { lineBreakBefore: false, value: 'x+1' },
        { lineBreakBefore: true, value: 'y' },
      ],
      multiline: true,
    });
  });
});
