/** Converts clipboard selections and insertions across canonical mixed source and MathLive offsets/modes. */
import {
  fromMathLiveMultilineSource,
  MATHLIVE_LITERAL_BACKSLASH,
  MATHLIVE_LITERAL_DOLLAR,
  mathDelimiterBody,
  normalizeMathLiveSource,
  parseMixedText,
  stripTextColors,
} from './mixedMath';

/** Converts MathLive selection markup back to canonical mixed-source text. */
export function clipboardTextFromMathLiveSelection(value: string): string {
  const normalized = normalizeMathLiveSource(
    fromMathLiveMultilineSource(value.replaceAll('\\placeholder{}', '')),
  );
  return parseMixedText(stripTextColors(normalized))
    .map((segment) =>
      segment.kind === 'text'
        ? segment.source
            .replaceAll(MATHLIVE_LITERAL_BACKSLASH, '\\')
            .replaceAll('\\$', '$')
        : `$${segment.latex}$`,
    )
    .join('');
}

interface EditorClipboardInsertion {
  lineBreakBefore: boolean;
  value: string;
}

/** Produces plain and MathLive insertion forms for pasted text in the active mode. */
export function editorClipboardInsertions(
  value: string,
  mode: 'math' | 'text',
): { insertions: EditorClipboardInsertion[]; multiline: boolean } {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  return {
    insertions: lines.map((line, index) => {
      if (mode === 'text') {
        return {
          lineBreakBefore: index > 0,
          value: line
            .replaceAll('\\', MATHLIVE_LITERAL_BACKSLASH)
            .replaceAll('$', MATHLIVE_LITERAL_DOLLAR),
        };
      }
      const delimitedBody = mathDelimiterBody(line.trim());
      return {
        lineBreakBefore: index > 0,
        value: delimitedBody ?? line,
      };
    }),
    multiline: lines.length > 1,
  };
}
