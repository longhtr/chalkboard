/**
 * Parser and canonical source language for interleaved prose and mathematics.
 * It recognizes escaped delimiters, editor-only markers, styles, line breaks,
 * and incomplete intermediate input without requiring rendered DOM.
 */
import { isEscaped, matchingBrace } from './latexParsing';

interface TextSegment {
  kind: 'text';
  source: string;
}

interface MathSegment {
  closeEnd: number;
  contentEnd: number;
  contentStart: number;
  index: number;
  kind: 'math';
  latex: string;
  openStart: number;
}

type MixedTextSegment = TextSegment | MathSegment;

/** Invisible editor sentinel representing a canonical mixed-source line break. */
export const MATHLIVE_LINE_BREAK = '\u2063';
/** Invisible editor sentinel representing a literal prose dollar sign. */
export const MATHLIVE_LITERAL_DOLLAR = '\u2064';
/** Invisible editor sentinel representing a literal prose backslash. */
export const MATHLIVE_LITERAL_BACKSLASH = '\u2065';
/** Invisible editor sentinel that begins a bold prose run. */
export const MATHLIVE_BOLD_ON = '\u2066';
/** Invisible editor sentinel that ends a bold prose run. */
export const MATHLIVE_BOLD_OFF = '\u2067';
/** Invisible editor sentinel that begins an italic prose run. */
export const MATHLIVE_ITALIC_ON = '\u2068';
/** Invisible editor sentinel that ends an italic prose run. */
export const MATHLIVE_ITALIC_OFF = '\u2069';

/** Removes one complete outer math delimiter pair without changing its body. */
export function mathDelimiterBody(value: string): string | null {
  if (value.startsWith('$$') && value.endsWith('$$')) {
    return value.slice(2, -2);
  }
  if (value.startsWith('$') && value.endsWith('$')) {
    return value.slice(1, -1);
  }
  return null;
}

const textStyleMarkers = new Set([
  MATHLIVE_BOLD_ON,
  MATHLIVE_BOLD_OFF,
  MATHLIVE_ITALIC_ON,
  MATHLIVE_ITALIC_OFF,
]);

const textColors = ['#1f2937', '#e03131', '#1971c2', '#2f9e44', '#7048e8'];
// Keep markers intrinsically zero-width so they cannot flash as glyphs before
// MathLive's shadow DOM decoration runs.
const textColorMarkers = ['\u200b', '\u200c', '\u2060', '\u2061', '\u2062'];
const colorByMarker = new Map(
  textColorMarkers.map((marker, index) => [
    marker,
    textColors[index] ?? textColors[0] ?? '#1f2937',
  ]),
);
const markerByColor = new Map(
  textColors.map((color, index) => [
    color,
    textColorMarkers[index] ?? textColorMarkers[0] ?? '\u200b',
  ]),
);

/** Decodes an internal color marker to its CSS color value. */
export function textColorForMarker(marker: string): string | undefined {
  return colorByMarker.get(marker);
}

/** Reports whether a character is an internally registered color marker. */
export function isTextColorMarker(value: string): boolean {
  return colorByMarker.has(value);
}

/** Reports whether a character is a bold/italic internal sentinel. */
export function isTextStyleMarker(value: string): boolean {
  return textStyleMarkers.has(value);
}

/** Converts canonical text-color commands into single-character editor markers. */
export function expandTextColors(source: string, baseColor: string): string {
  const transform = (value: string, inheritedColor: string): string => {
    let result = '';
    let cursor = 0;
    while (cursor < value.length) {
      const command = value.indexOf('\\textcolor{', cursor);
      if (command < 0) return result + value.slice(cursor);
      result += value.slice(cursor, command);
      const colorOpen = command + '\\textcolor'.length;
      const colorClose = matchingBrace(value, colorOpen);
      if (colorClose < 0 || value[colorClose + 1] !== '{') {
        result += value.slice(command, command + 10);
        cursor = command + 10;
        continue;
      }
      const bodyOpen = colorClose + 1;
      const bodyClose = matchingBrace(value, bodyOpen);
      if (bodyClose < 0) {
        result += value.slice(command);
        return result;
      }
      if (bodyClose === bodyOpen + 1) {
        cursor = bodyClose + 1;
        continue;
      }
      const color = value.slice(colorOpen + 1, colorClose);
      const colorMarker = markerByColor.get(color);
      const inheritedMarker = markerByColor.get(inheritedColor);
      if (colorMarker === undefined || inheritedMarker === undefined) {
        result += value.slice(command, bodyClose + 1);
      } else {
        result += `${colorMarker}${transform(
          value.slice(bodyOpen + 1, bodyClose),
          color,
        )}${inheritedMarker}`;
      }
      cursor = bodyClose + 1;
    }
    return result;
  };
  return transform(source, baseColor);
}

function collapseTextColors(source: string, baseColor: string): string {
  let activeColor = baseColor;
  let run = '';
  let result = '';
  const flush = () => {
    if (run === '') return;
    result +=
      activeColor === baseColor ? run : `\\textcolor{${activeColor}}{${run}}`;
    run = '';
  };
  for (const character of source) {
    const color = textColorForMarker(character);
    if (color === undefined) {
      run += character;
    } else {
      flush();
      activeColor = color;
    }
  }
  flush();
  return result;
}

/** Converts editor color markers back to minimal canonical text-color commands. */
export function normalizeTextColors(source: string, baseColor: string): string {
  return collapseTextColors(expandTextColors(source, baseColor), baseColor);
}

/** Removes one color wrapper spanning the complete mixed source, when present. */
export function unwrapWholeTextColor(
  source: string,
): { color: string; source: string } | null {
  if (!source.startsWith('\\textcolor{')) return null;
  const colorOpen = '\\textcolor'.length;
  const colorClose = matchingBrace(source, colorOpen);
  if (colorClose < 0 || source[colorClose + 1] !== '{') return null;
  const bodyOpen = colorClose + 1;
  const bodyClose = matchingBrace(source, bodyOpen);
  if (bodyClose !== source.length - 1) return null;
  const color = source.slice(colorOpen + 1, colorClose);
  if (color === '') return null;
  return { color, source: source.slice(bodyOpen + 1, bodyClose) };
}

/** Converts canonical bold/italic prose commands into editor sentinels. */
export function expandTextStyles(source: string): string {
  const transform = (
    value: string,
    inheritedStyle: { bold: boolean; italic: boolean },
  ): string => {
    let result = '';
    let cursor = 0;
    const protectedMathRanges = mathSegments(value);
    while (cursor < value.length) {
      const next = [
        { command: '\\textbf', style: 'bold' as const },
        { command: '\\textit', style: 'italic' as const },
      ]
        .map((entry) => ({
          ...entry,
          index: value.indexOf(`${entry.command}{`, cursor),
        }))
        .filter(
          ({ index }) =>
            index >= 0 &&
            !protectedMathRanges.some(
              (segment) =>
                index >= segment.openStart && index < segment.closeEnd,
            ),
        )
        .sort((left, right) => left.index - right.index)[0];
      if (next === undefined) return result + value.slice(cursor);
      result += value.slice(cursor, next.index);
      const bodyOpen = next.index + next.command.length;
      const bodyClose = matchingBrace(value, bodyOpen);
      if (bodyClose < 0) return result + value.slice(next.index);
      const bold = next.style === 'bold' ? true : inheritedStyle.bold;
      const italic = next.style === 'italic' ? true : inheritedStyle.italic;
      const on = next.style === 'bold' ? MATHLIVE_BOLD_ON : MATHLIVE_ITALIC_ON;
      const restore =
        next.style === 'bold'
          ? inheritedStyle.bold
            ? MATHLIVE_BOLD_ON
            : MATHLIVE_BOLD_OFF
          : inheritedStyle.italic
            ? MATHLIVE_ITALIC_ON
            : MATHLIVE_ITALIC_OFF;
      result += `${on}${transform(value.slice(bodyOpen + 1, bodyClose), {
        bold,
        italic,
      })}${restore}`;
      cursor = bodyClose + 1;
    }
    return result;
  };
  return transform(source, { bold: false, italic: false });
}

/** Converts editor style sentinels back to minimal canonical prose commands. */
export function normalizeTextStyles(source: string): string {
  let bold = false;
  let italic = false;
  const expanded = expandTextStyles(source);

  const normalizeTextSegment = (text: string) => {
    let run = '';
    let runBold = bold;
    let runItalic = italic;
    let result = '';
    const flush = () => {
      if (run === '') return;
      result += runBold
        ? runItalic
          ? `\\textbf{\\textit{${run}}}`
          : `\\textbf{${run}}`
        : runItalic
          ? `\\textit{${run}}`
          : run;
      run = '';
    };

    for (const character of text) {
      const nextBold: boolean =
        character === MATHLIVE_BOLD_ON
          ? true
          : character === MATHLIVE_BOLD_OFF
            ? false
            : bold;
      const nextItalic: boolean =
        character === MATHLIVE_ITALIC_ON
          ? true
          : character === MATHLIVE_ITALIC_OFF
            ? false
            : italic;
      if (isTextStyleMarker(character)) {
        flush();
        bold = nextBold;
        italic = nextItalic;
        runBold = bold;
        runItalic = italic;
        continue;
      }
      if (run === '') {
        runBold = bold;
        runItalic = italic;
      }
      run += character;
    }
    flush();
    return result;
  };

  return parseMixedText(expanded)
    .map((segment) =>
      segment.kind === 'text'
        ? normalizeTextSegment(segment.source)
        : expanded.slice(segment.openStart, segment.closeEnd),
    )
    .join('');
}

function stripTextFormattingCommands(source: string): string {
  const commands = ['\\textbf', '\\textit'];
  let result = '';
  let cursor = 0;
  while (cursor < source.length) {
    const next = commands
      .map((command) => ({
        command,
        index: source.indexOf(`${command}{`, cursor),
      }))
      .filter(({ index }) => index >= 0)
      .sort((left, right) => left.index - right.index)[0];
    if (next === undefined) return result + source.slice(cursor);
    result += source.slice(cursor, next.index);
    const bodyOpen = next.index + next.command.length;
    const bodyClose = matchingBrace(source, bodyOpen);
    if (bodyClose < 0) return result + source.slice(next.index);
    result += stripTextFormattingCommands(
      source.slice(bodyOpen + 1, bodyClose),
    );
    cursor = bodyClose + 1;
  }
  return result;
}

/** Removes prose color commands while retaining their visible content. */
export function stripTextColors(source: string): string {
  const stripCommands = (value: string): string => {
    let result = '';
    let cursor = 0;
    while (cursor < value.length) {
      const command = value.indexOf('\\textcolor{', cursor);
      if (command < 0) return result + value.slice(cursor);
      result += value.slice(cursor, command);
      const colorOpen = command + '\\textcolor'.length;
      const colorClose = matchingBrace(value, colorOpen);
      if (colorClose < 0 || value[colorClose + 1] !== '{') {
        result += value.slice(command, command + 10);
        cursor = command + 10;
        continue;
      }
      const bodyOpen = colorClose + 1;
      const bodyClose = matchingBrace(value, bodyOpen);
      if (bodyClose < 0) return result + value.slice(command);
      result += stripCommands(value.slice(bodyOpen + 1, bodyClose));
      cursor = bodyClose + 1;
    }
    return result;
  };

  return stripTextFormattingCommands(
    [...stripCommands(expandTextColors(source, '#1f2937'))]
      .filter(
        (character) =>
          !isTextColorMarker(character) && !isTextStyleMarker(character),
      )
      .join(''),
  )
    .replaceAll(MATHLIVE_LITERAL_BACKSLASH, '\\')
    .replaceAll('\\$', '$');
}

function toMathLiveMultilineSource(source: string): string {
  return source.replaceAll('\n', MATHLIVE_LINE_BREAK);
}

/** Encodes canonical mixed source into the one-field MathLive editor representation. */
export function toMathLiveEditorSource(source: string): string {
  return parseMixedText(source)
    .map((segment) =>
      segment.kind === 'text'
        ? toMathLiveMultilineSource(
            normalizeMathLiveTextSource(segment.source),
          ).replaceAll('\\$', MATHLIVE_LITERAL_DOLLAR)
        : `$${segment.latex}$`,
    )
    .join('');
}

/** Decodes MathLive line-break sentinels into canonical newline characters. */
export function fromMathLiveMultilineSource(source: string): string {
  return source
    .replaceAll(MATHLIVE_LINE_BREAK, '\n')
    .replaceAll(MATHLIVE_LITERAL_DOLLAR, '\\$');
}

/**
 * MathLive may normalize adjacent rows into one math run as focus leaves the
 * field without emitting another input event. Keep the last published row
 * structure when the commit contains the same content with fewer line breaks.
 */
export function preservePublishedLineBreaks(
  publishedSource: string,
  committedSource: string,
): string {
  const publishedBreaks = [...publishedSource].filter(
    (character) => character === '\n',
  ).length;
  const committedBreaks = [...committedSource].filter(
    (character) => character === '\n',
  ).length;
  if (publishedBreaks === 0 || committedBreaks >= publishedBreaks) {
    return committedSource;
  }

  const flattenedContent = (source: string) =>
    source.replaceAll('\n', '').replaceAll('$', '');
  return flattenedContent(publishedSource) === flattenedContent(committedSource)
    ? publishedSource
    : committedSource;
}

/**
 * Line breaks belong to the mixed-text editor, not to a nested LaTeX atom.
 * MathLive can serialize an Enter pressed from a script or command argument as
 * `\\text{\n}`. Move those breaks immediately after the surrounding math
 * segment so they remain visible and editable rows.
 */
export function liftMathLineBreaks(source: string): string {
  const segments = mathSegments(source);
  if (segments.every(({ latex }) => !latex.includes('\n'))) return source;

  let cursor = 0;
  let result = '';
  for (const segment of segments) {
    result += source.slice(cursor, segment.contentStart);
    const breaks = [...segment.latex].filter(
      (character) => character === '\n',
    ).length;
    result += segment.latex.replaceAll('\n', '');
    result += source.slice(segment.contentEnd, segment.closeEnd);
    result += '\n'.repeat(breaks);
    cursor = segment.closeEnd;
  }
  return result + source.slice(cursor);
}

/** Normalizes one live field value into bounded canonical mixed source. */
export function canonicalizeMathLiveEditorValue(
  editorValue: string,
  options: { wrapUndelimitedMath: boolean },
): string {
  const decoded = fromMathLiveMultilineSource(editorValue);
  if (
    options.wrapUndelimitedMath &&
    decoded.trim() !== '' &&
    mathSegments(decoded).length === 0
  ) {
    return liftMathLineBreaks(`$${decoded}$`);
  }
  return liftMathLineBreaks(decoded);
}

interface MixedSourceFromEditorOptions {
  baseColor: string;
  emptyMathRegion: boolean;
  hasExplicitMath: boolean;
  mode: 'latex' | 'math' | 'text';
  retainsMathOnlySource: boolean;
}

/**
 * Cross the MathLive/persisted-source boundary in one place. This is the only
 * conversion that should be used for input, history, persistence, and commit.
 */
export function mixedSourceFromMathLiveEditor(
  editorValue: string,
  options: MixedSourceFromEditorOptions,
): string {
  const valueWithoutPlaceholders = editorValue.replaceAll(
    '\\placeholder{}',
    '',
  );
  const value = canonicalizeMathLiveEditorValue(valueWithoutPlaceholders, {
    wrapUndelimitedMath:
      !options.retainsMathOnlySource &&
      options.hasExplicitMath &&
      valueWithoutPlaceholders.includes(MATHLIVE_LINE_BREAK),
  });

  let normalized: string;
  if (options.retainsMathOnlySource) {
    normalized = `$${value.trim() || ' '}$`;
  } else if (options.emptyMathRegion && options.mode === 'math') {
    normalized = normalizeMathLiveSource(value);
  } else if (
    options.hasExplicitMath &&
    value.trim() !== '' &&
    mathSegments(value).length === 0
  ) {
    normalized = `$${value.trim()}$`;
  } else {
    normalized = normalizeMathLiveSource(value);
  }

  return normalizeTextStyles(
    normalizeTextColors(normalized, options.baseColor),
  );
}

function findClosingDelimiter(
  source: string,
  delimiter: '$' | '$$',
  start: number,
): number {
  let braceDepth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (isEscaped(source, index)) continue;
    if (character === '{') {
      braceDepth += 1;
      continue;
    }
    if (character === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (character !== '$' || braceDepth > 0) continue;
    if (delimiter === '$$') {
      if (source[index + 1] === '$') return index;
      continue;
    }
    return index;
  }
  return -1;
}

/** Splits canonical mixed source into ordered prose, math, and line-break segments. */
export function parseMixedText(source: string): MixedTextSegment[] {
  const segments: MixedTextSegment[] = [];
  let textStart = 0;
  let cursor = 0;
  let mathIndex = 0;

  while (cursor < source.length) {
    if (source[cursor] !== '$' || isEscaped(source, cursor)) {
      cursor += 1;
      continue;
    }

    const delimiter: '$' | '$$' = source[cursor + 1] === '$' ? '$$' : '$';
    const contentStart = cursor + delimiter.length;
    const closeStart = findClosingDelimiter(source, delimiter, contentStart);
    if (closeStart < 0) {
      cursor += delimiter.length;
      continue;
    }

    if (cursor > textStart) {
      segments.push({ kind: 'text', source: source.slice(textStart, cursor) });
    }
    segments.push({
      closeEnd: closeStart + delimiter.length,
      contentEnd: closeStart,
      contentStart,
      index: mathIndex,
      kind: 'math',
      latex: source.slice(contentStart, closeStart),
      openStart: cursor,
    });
    mathIndex += 1;
    cursor = closeStart + delimiter.length;
    textStart = cursor;
  }

  if (textStart < source.length || segments.length === 0) {
    segments.push({ kind: 'text', source: source.slice(textStart) });
  }
  return segments;
}

/** Returns only delimited math segments with their source offsets. */
export function mathSegments(source: string): MathSegment[] {
  return parseMixedText(source).filter(
    (segment): segment is MathSegment => segment.kind === 'math',
  );
}

function isEmptyMathLatex(source: string): boolean {
  let value = source;
  let previous: string;
  do {
    previous = value;
    value = value
      .replaceAll('\\placeholder{}', '')
      .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{\s*\}/g, '')
      .replace(
        /\\(?:quad|qquad|enspace|thinspace|medspace|thickspace|negthinspace)\b/g,
        '',
      )
      .replace(/\\hspace\*?\{[^{}]*\}/g, '')
      .replace(/\\[,;:! ]/g, '')
      .replaceAll('~', '')
      .replace(/\{\s*\}/g, '')
      .replace(/\s+/g, '');
  } while (value !== previous);
  return value === '';
}

/** Reports whether mixed source has no visible prose or math content. */
export function isEmptyMixedSource(source: string): boolean {
  return parseMixedText(stripTextColors(source)).every((segment) =>
    segment.kind === 'math'
      ? isEmptyMathLatex(segment.latex)
      : segment.source.trim() === '',
  );
}

/** Replaces one known math segment with normalized LaTeX. */
export function replaceMathSegment(
  source: string,
  segment: MathSegment,
  latex: string,
): string {
  if (latex.trim() === '') {
    return source.slice(0, segment.openStart) + source.slice(segment.closeEnd);
  }
  return (
    source.slice(0, segment.contentStart) +
    latex +
    source.slice(segment.contentEnd)
  );
}

/** Updates one math segment while preserving its original delimiter width. */
export function updateMathSegment(
  source: string,
  segment: MathSegment,
  latex: string,
): string {
  return (
    source.slice(0, segment.contentStart) +
    latex +
    source.slice(segment.contentEnd)
  );
}

function normalizeMathLiveTextSource(source: string): string {
  return source
    .replace(/\\lbrack/g, '[')
    .replace(/\\rbrack/g, ']')
    .replace(/\\textbraceleft\s?/g, '{')
    .replace(/\\textbraceright\s?/g, '}')
    .replace(/\\textasciicircum\s?/g, '^')
    .replace(/\\textasciitilde\s?/g, '~')
    .replace(/\\textbackslash\s?/g, '\\')
    .replace(/\\([!#%&_])/g, '$1');
}

/** Removes MathLive-only artifacts and returns canonical mixed source. */
export function normalizeMathLiveSource(source: string): string {
  let result = '';
  let pendingMath = '';
  const flushMath = () => {
    if (pendingMath === '') return;
    result += `$${pendingMath}$`;
    pendingMath = '';
  };

  for (const segment of parseMixedText(source)) {
    if (segment.kind === 'text') {
      flushMath();
      result += normalizeMathLiveTextSource(segment.source);
      continue;
    }
    const latex = segment.latex.trim().replace(/^\\displaystyle\s*/, '');
    const normalizedLatex = latex === '' ? ' ' : latex;
    const needsControlWordSeparator =
      /\\[A-Za-z]+\*?$/.test(pendingMath) && /^[A-Za-z]/.test(normalizedLatex);
    pendingMath += `${needsControlWordSeparator ? ' ' : ''}${normalizedLatex}`;
  }
  flushMath();
  return result;
}

/** Upgrades legacy undelimited equation source to the current mixed format. */
export function migrateLegacyMathSource(source: string): string {
  if (source === '' || mathSegments(source).length > 0) return source;
  return `$${source}$`;
}
