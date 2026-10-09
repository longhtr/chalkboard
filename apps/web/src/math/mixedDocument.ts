/**
 * Converts between canonical mixed source and structured rows/spans used by
 * persistence and Yjs. Normalization merges compatible adjacent spans while
 * preserving math boundaries and explicit line structure.
 */
import {
  CHALKBOARD_SCHEMA_VERSIONS,
  type MixedContentDocument,
  type MixedContentRow,
  type MixedMathSpan,
  type MixedTextAttributes,
  type MixedTextSpan,
} from '@chalkboard/shared';

import { matchingBrace } from './latexParsing';
import { parseMixedText } from './mixedMath';

function sameAttributes(
  span: MixedTextSpan,
  attributes: MixedTextAttributes,
): boolean {
  return (
    span.bold === attributes.bold &&
    span.italic === attributes.italic &&
    span.color === attributes.color
  );
}

/** Parses canonical compatibility source into styled rows and math spans. */
export function mixedDocumentFromSource(
  source: string,
  baseColor: string,
): MixedContentDocument {
  let currentRow: MixedContentRow = { spans: [] };
  const rows: MixedContentRow[] = [currentRow];
  const mathByStart = new Map(
    parseMixedText(source)
      .filter((segment) => segment.kind === 'math')
      .map((segment) => [segment.openStart, segment]),
  );
  const appendText = (text: string, attributes: MixedTextAttributes) => {
    if (text === '') return;
    const previous = currentRow.spans.at(-1);
    if (previous?.kind === 'text' && sameAttributes(previous, attributes)) {
      previous.text += text;
    } else {
      currentRow.spans.push({ kind: 'text', text, ...attributes });
    }
  };
  const appendMath = (span: MixedMathSpan) => currentRow.spans.push(span);
  const nextRow = () => {
    currentRow = { spans: [] };
    rows.push(currentRow);
  };

  const parseRange = (
    start: number,
    end: number,
    attributes: MixedTextAttributes,
  ) => {
    let cursor = start;
    while (cursor < end) {
      const math = mathByStart.get(cursor);
      if (math !== undefined && math.closeEnd <= end) {
        appendMath({ kind: 'math', latex: math.latex });
        cursor = math.closeEnd;
        continue;
      }
      if (source[cursor] === '\n') {
        nextRow();
        cursor += 1;
        continue;
      }

      const styleCommand = source.startsWith('\\textbf{', cursor)
        ? { bold: true, command: '\\textbf' }
        : source.startsWith('\\textit{', cursor)
          ? { command: '\\textit', italic: true }
          : null;
      if (styleCommand !== null) {
        const bodyOpen = cursor + styleCommand.command.length;
        const bodyClose = matchingBrace(source, bodyOpen);
        if (bodyClose >= 0 && bodyClose < end) {
          parseRange(bodyOpen + 1, bodyClose, {
            ...attributes,
            ...('bold' in styleCommand ? { bold: true } : { italic: true }),
          });
          cursor = bodyClose + 1;
          continue;
        }
      }

      if (source.startsWith('\\textcolor{', cursor)) {
        const colorOpen = cursor + '\\textcolor'.length;
        const colorClose = matchingBrace(source, colorOpen);
        const bodyOpen = colorClose + 1;
        if (colorClose >= 0 && source[bodyOpen] === '{' && bodyOpen < end) {
          const bodyClose = matchingBrace(source, bodyOpen);
          if (bodyClose >= 0 && bodyClose < end) {
            parseRange(bodyOpen + 1, bodyClose, {
              ...attributes,
              color: source.slice(colorOpen + 1, colorClose),
            });
            cursor = bodyClose + 1;
            continue;
          }
        }
      }

      const literalCommands = [
        ['\\textbackslash', '\\'],
        ['\\textbraceleft', '{'],
        ['\\textbraceright', '}'],
        ['\\textasciicircum', '^'],
        ['\\textasciitilde', '~'],
      ] as const;
      const literal = literalCommands.find(([command]) =>
        source.startsWith(command, cursor),
      );
      if (literal !== undefined) {
        appendText(literal[1], attributes);
        cursor += literal[0].length;
        if (source[cursor] === ' ') cursor += 1;
        continue;
      }
      if (
        source[cursor] === '\\' &&
        cursor + 1 < end &&
        '$!#%&_'.includes(source[cursor + 1] ?? '')
      ) {
        appendText(source[cursor + 1] ?? '', attributes);
        cursor += 2;
        continue;
      }
      appendText(source[cursor] ?? '', attributes);
      cursor += 1;
    }
  };

  parseRange(0, source.length, {
    bold: false,
    color: baseColor,
    italic: false,
  });
  return { rows, version: CHALKBOARD_SCHEMA_VERSIONS.mixedContent };
}

function styledTextSource(span: MixedTextSpan, baseColor: string): string {
  let source = span.text
    .replaceAll('\\', '\\textbackslash ')
    .replaceAll('$', '\\$');
  if (span.bold || span.italic || span.color !== baseColor) {
    source = source
      .replaceAll('{', '\\textbraceleft ')
      .replaceAll('}', '\\textbraceright ');
  }
  if (span.italic) source = `\\textit{${source}}`;
  if (span.bold) source = `\\textbf{${source}}`;
  if (span.color !== baseColor) {
    source = `\\textcolor{${span.color}}{${source}}`;
  }
  return source;
}

/** Serializes structured rows to canonical compatibility source and base color. */
export function sourceFromMixedDocument(
  document: MixedContentDocument,
  baseColor: string,
): string {
  return document.rows
    .map((row) =>
      row.spans
        .map((span) =>
          span.kind === 'math'
            ? `$${span.latex}$`
            : styledTextSource(span, baseColor),
        )
        .join(''),
    )
    .join('\n');
}
