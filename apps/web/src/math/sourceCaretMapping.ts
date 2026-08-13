/** Converts caret positions between canonical mixed source and its rendered plain-text projection. */
import { mathSegments } from './mixedMath';

/** Correspondence between one MathLive field offset and canonical source offset. */
export interface SerializedCaretBoundary {
  fieldOffset: number;
  left: string;
  right: string;
}

interface SemanticToken {
  end: number;
  id: string;
  start: number;
}

interface MappedBoundary extends SerializedCaretBoundary {
  sourceEnd: number;
  sourceStart: number;
}

const STRUCTURAL_COMMANDS = new Set([
  'begin',
  'dfrac',
  'end',
  'frac',
  'left',
  'mathit',
  'mathbf',
  'mathrm',
  'operatorname',
  'overline',
  'overset',
  'right',
  'sqrt',
  'style',
  'text',
  'textbf',
  'textcolor',
  'textit',
  'tfrac',
  'underbrace',
  'underline',
  'underset',
]);

const TEXT_COMMAND_GLYPHS: Readonly<Record<string, string>> = {
  lbrack: '[',
  rbrack: ']',
  textasciicircum: '^',
  textasciitilde: '~',
  textbackslash: '\\',
  textbraceleft: '{',
  textbraceright: '}',
};

function semanticTokens(source: string): SemanticToken[] {
  const math = mathSegments(source);
  const tokens: SemanticToken[] = [];
  let mathIndex = 0;
  let index = 0;
  while (index < source.length) {
    const segment = math[mathIndex];
    if (segment !== undefined && index >= segment.closeEnd) {
      mathIndex += 1;
      continue;
    }
    const inMath =
      segment !== undefined &&
      index >= segment.contentStart &&
      index < segment.contentEnd;
    if (
      segment !== undefined &&
      index < segment.contentStart &&
      index >= segment.openStart
    ) {
      index = segment.contentStart;
      continue;
    }
    if (source[index] === '\\') {
      const match = source.slice(index).match(/^\\([A-Za-z]+\*?|.)/u);
      if (match !== null) {
        const raw = match[0];
        const command = match[1] ?? '';
        const end = index + raw.length;
        if (!STRUCTURAL_COMMANDS.has(command.replace(/\*$/u, ''))) {
          const glyph = !inMath ? TEXT_COMMAND_GLYPHS[command] : undefined;
          tokens.push({
            end,
            id: `${inMath ? 'm' : 't'}:${glyph ?? raw}`,
            start: index,
          });
        }
        index = end;
        continue;
      }
    }
    const character = source[index] ?? '';
    const codePointLength = character.codePointAt(0)! > 0xffff ? 2 : 1;
    const end = index + codePointLength;
    if (
      character !== '$' &&
      character !== '{' &&
      character !== '}' &&
      character !== '^' &&
      character !== '_' &&
      character !== '&' &&
      !(inMath && /\s/u.test(character))
    ) {
      tokens.push({
        end,
        id: `${inMath ? 'm' : 't'}:${source.slice(index, end)}`,
        start: index,
      });
    }
    index = end;
  }
  return tokens;
}

/**
 * Last mapping, reused while the same table is asked about again.
 *
 * Mapping tokenizes both sides of every offset, so it costs on the order of the
 * document length squared, and the two directions are asked for separately for
 * one caret move. The table is rebuilt whenever the document changes, so its
 * identity together with the source identifies the result.
 */
let lastMapping: {
  boundaries: readonly SerializedCaretBoundary[];
  mapped: MappedBoundary[];
  source: string;
} | null = null;

function mapBoundaries(
  source: string,
  boundaries: readonly SerializedCaretBoundary[],
): MappedBoundary[] {
  if (
    lastMapping !== null &&
    lastMapping.source === source &&
    lastMapping.boundaries === boundaries
  ) {
    return lastMapping.mapped;
  }
  const full = semanticTokens(source);
  const mapped = boundaries.map((boundary) => {
    const left = semanticTokens(boundary.left);
    let fullIndex = 0;
    let sourceEnd = 0;
    for (const token of left) {
      while (fullIndex < full.length && full[fullIndex]?.id !== token.id) {
        fullIndex += 1;
      }
      const match = full[fullIndex];
      if (match === undefined) break;
      sourceEnd = match.end;
      fullIndex += 1;
    }

    const right = semanticTokens(boundary.right);
    fullIndex = full.length - 1;
    let sourceStart = source.length;
    for (let index = right.length - 1; index >= 0; index -= 1) {
      const token = right[index];
      while (fullIndex >= 0 && full[fullIndex]?.id !== token?.id) {
        fullIndex -= 1;
      }
      const match = full[fullIndex];
      if (match === undefined) break;
      sourceStart = match.start;
      fullIndex -= 1;
    }
    if (sourceEnd > sourceStart) {
      const midpoint = Math.round((sourceEnd + sourceStart) / 2);
      sourceEnd = midpoint;
      sourceStart = midpoint;
    }
    return { ...boundary, sourceEnd, sourceStart };
  });
  lastMapping = { boundaries, mapped, source };
  return mapped;
}

function representativeOffset(
  boundaries: readonly MappedBoundary[],
  index: number,
): number {
  const boundary = boundaries[index];
  if (boundary === undefined) return 0;
  let first = index;
  let last = index;
  while (
    first > 0 &&
    boundaries[first - 1]?.sourceEnd === boundary.sourceEnd &&
    boundaries[first - 1]?.sourceStart === boundary.sourceStart
  ) {
    first -= 1;
  }
  while (
    last + 1 < boundaries.length &&
    boundaries[last + 1]?.sourceEnd === boundary.sourceEnd &&
    boundaries[last + 1]?.sourceStart === boundary.sourceStart
  ) {
    last += 1;
  }
  const ratio = first === last ? 0.5 : (index - first) / (last - first);
  return Math.round(
    boundary.sourceEnd + (boundary.sourceStart - boundary.sourceEnd) * ratio,
  );
}

/** Maps a field offset to the nearest canonical source boundary. */
export function sourceOffsetForFieldOffset(
  source: string,
  boundaries: readonly SerializedCaretBoundary[],
  fieldOffset: number,
): number {
  const mapped = mapBoundaries(source, boundaries);
  if (mapped.length === 0) return 0;
  let nearest = 0;
  for (let index = 1; index < mapped.length; index += 1) {
    if (
      Math.abs((mapped[index]?.fieldOffset ?? 0) - fieldOffset) <
      Math.abs((mapped[nearest]?.fieldOffset ?? 0) - fieldOffset)
    ) {
      nearest = index;
    }
  }
  return representativeOffset(mapped, nearest);
}

/** Maps a canonical source offset to the nearest MathLive field boundary. */
export function fieldOffsetForSourceOffset(
  source: string,
  boundaries: readonly SerializedCaretBoundary[],
  sourceOffset: number,
): number {
  const mapped = mapBoundaries(source, boundaries);
  if (mapped.length === 0) return 0;
  const clamped = Math.max(0, Math.min(source.length, sourceOffset));
  let nearest = 0;
  for (let index = 1; index < mapped.length; index += 1) {
    const distance = Math.abs(representativeOffset(mapped, index) - clamped);
    const nearestDistance = Math.abs(
      representativeOffset(mapped, nearest) - clamped,
    );
    if (
      distance < nearestDistance ||
      (distance === nearestDistance && index > nearest)
    ) {
      nearest = index;
    }
  }
  return mapped[nearest]?.fieldOffset ?? 0;
}
