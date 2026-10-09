/** Converts caret positions between canonical mixed source and its rendered plain-text projection. */
import {
  isReservedSentinel,
  MATHLIVE_SENTINEL_SPELLINGS,
  mathSegments,
} from './mixedMath';

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
  /** False when the position was skipped for cost and must be interpolated. */
  measured: boolean;
  sourceEnd: number;
  sourceStart: number;
}

/**
 * Roughly how many characters the search may tokenize for one document.
 *
 * Searching reads the whole prefix at every position, so the work grows with
 * the square of the length and a long block spent seconds rebuilding its table
 * between keystrokes. Past this budget positions are sampled and the rest are
 * interpolated: the caret lands close rather than exactly, which is a far
 * smaller loss than an editor that stops responding. Ordinary blocks are orders
 * of magnitude below it and are always measured exactly.
 */
const SEARCH_BUDGET = 400_000;

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

/**
 * Characters that group or delimit rather than say anything, and so carry no
 * token on either side of the mapping.
 *
 * A command naming one of them is the same writing spelled longer, so it must
 * be passed over too. `mixedDocument` escapes a brace only inside a styled run,
 * so one brace can arrive as `\textbraceleft` and its neighbour as `{`, and
 * counting the first while skipping the second pulled every later position in a
 * styled block out of step.
 */
const STRUCTURAL_CHARACTERS = new Set(['$', '{', '}', '^', '_', '&']);

/**
 * A field serialization respelled the way canonical source writes it.
 *
 * The two describe the same document in different languages: a row is a
 * newline in one and a sentinel in the other, a literal dollar is an escape in
 * one and a sentinel in the other, and a styled run is a command in one and a
 * pair of sentinels in the other. Tokenizing a serialization as it arrives gave
 * the same writing a different identity from the source, and because the
 * matcher aligns by identity, one such difference sent a boundary into an
 * unrelated part of the document and dragged the rest after it.
 *
 * The vocabulary belongs to `mixedMath`, which owns both the sentinels and the
 * decoder, so this asks that module rather than restating the correspondence.
 * A sentinel added there is carried here without this file changing, which is
 * the property that was missing when rows silently stopped aligning.
 *
 * Only serializations are respelled. Canonical source is tokenized as written,
 * because its token offsets address the real document and decoding a sentinel
 * can change a length -- a literal dollar occupies one character as a sentinel
 * and two as an escape -- which would move every offset after it.
 */
function alignableSerialization(value: string): string {
  let text = '';
  for (const character of value) {
    const spelling = MATHLIVE_SENTINEL_SPELLINGS.get(character);
    if (spelling !== undefined) text += spelling;
    else if (!isReservedSentinel(character)) text += character;
  }
  return text;
}

/**
 * The respelling, plus where each original index landed in it.
 *
 * The index is what lets a prefix of the serialization be located in the
 * respelled text without respelling the prefix too. Rewriting can change a
 * length -- a literal dollar is one character as a sentinel and two as an
 * escape, and a style sentinel becomes nothing -- so the two run on different
 * rulers and a boundary needs the second one.
 *
 * Only the whole value is respelled this way. `alignableSerialization` repeats
 * the rewrite without the index, because the search path runs once per position
 * and would otherwise build an array the length of the document each time.
 */
function respell(value: string): { indexInText: number[]; text: string } {
  const indexInText: number[] = new Array<number>(value.length + 1);
  let text = '';
  let index = 0;
  for (const character of value) {
    for (let unit = 0; unit < character.length; unit += 1) {
      indexInText[index + unit] = text.length;
    }
    index += character.length;
    const spelling = MATHLIVE_SENTINEL_SPELLINGS.get(character);
    if (spelling !== undefined) text += spelling;
    else if (!isReservedSentinel(character)) text += character;
    // A reserved character with no spelling stands for formatting rather than
    // writing, and its canonical command is structural, so neither side of the
    // mapping should see a token for it.
  }
  indexInText[index] = text.length;
  return { indexInText, text };
}

const COMMAND_AT = /\\([A-Za-z]+\*?|[\s\S])/uy;

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
      // Sticky rather than a match against the remainder: slicing copied every
      // character after the command, so a document of commands cost a pass per
      // command and tokenizing alone grew with the square of its length.
      COMMAND_AT.lastIndex = index;
      const match = COMMAND_AT.exec(source);
      if (match !== null) {
        const raw = match[0];
        const command = match[1] ?? '';
        const end = index + raw.length;
        const glyph = !inMath ? TEXT_COMMAND_GLYPHS[command] : undefined;
        if (
          !STRUCTURAL_COMMANDS.has(command.replace(/\*$/u, '')) &&
          !(glyph !== undefined && STRUCTURAL_CHARACTERS.has(glyph))
        ) {
          tokens.push({
            end,
            id: `${inMath ? 'm' : 't'}:${glyph ?? raw}`,
            start: index,
          });
        }
        // A control word swallows one space after it, which is how LaTeX reads
        // it and how the editor value is built. Counting that space as writing
        // left a styled block one position out of step from its first escape
        // onwards.
        index =
          /^[A-Za-z]/u.test(command) && source[end] === ' ' ? end + 1 : end;
        continue;
      }
    }
    const character = source[index] ?? '';
    const codePointLength = character.codePointAt(0)! > 0xffff ? 2 : 1;
    const end = index + codePointLength;
    if (
      !STRUCTURAL_CHARACTERS.has(character) &&
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
  offsets: number[];
  source: string;
} | null = null;

function mapBoundaries(
  source: string,
  boundaries: readonly SerializedCaretBoundary[],
): number[] {
  if (
    lastMapping !== null &&
    lastMapping.source === source &&
    lastMapping.boundaries === boundaries
  ) {
    return lastMapping.offsets;
  }
  const full = semanticTokens(source);
  const mapped =
    alignedMatches(source, boundaries, full) ??
    searchedMatches(source, boundaries, full);
  const offsets = representativeOffsets(mapped, source.length);
  lastMapping = { boundaries, offsets, source };
  return offsets;
}

/** Number of tokens ending at or before an index, by binary search. */
function tokensBefore(tokens: readonly SemanticToken[], index: number): number {
  let low = 0;
  let high = tokens.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (tokens[middle]!.end <= index) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Number of tokens starting at or after an index, by binary search. */
function tokensAfter(tokens: readonly SemanticToken[], index: number): number {
  let low = 0;
  let high = tokens.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (tokens[middle]!.start < index) low = middle + 1;
    else high = middle;
  }
  return tokens.length - low;
}

/**
 * Matches every boundary at once, when both spellings agree about the document.
 *
 * Searching for each boundary separately costs a pass over the document per
 * position, so a page-long block spent most of a second rebuilding its table
 * and the editor stopped between keystrokes. Agreement makes that search
 * unnecessary: the n-th token of the serialization is the n-th token of the
 * source, so counting how many tokens a prefix holds answers the same question
 * by arithmetic, and one pass over the document serves every position.
 *
 * Returns `null` when the two disagree, or when the field describes its
 * prefixes in some way other than by cutting its own value, so that a document
 * this cannot account for still gets the search rather than a wrong answer.
 */
function alignedMatches(
  source: string,
  boundaries: readonly SerializedCaretBoundary[],
  full: readonly SemanticToken[],
): MappedBoundary[] | null {
  const last = boundaries[boundaries.length - 1];
  if (last === undefined || last.right !== '') return null;
  const value = last.left;
  const { indexInText, text } = respell(value);
  const serialized = semanticTokens(text);
  if (serialized.length !== full.length) return null;
  for (let index = 0; index < full.length; index += 1) {
    if (serialized[index]!.id !== full[index]!.id) return null;
  }

  const mapped: MappedBoundary[] = [];
  for (const boundary of boundaries) {
    const leftEnd = boundary.left.length;
    const rightStart = value.length - boundary.right.length;
    if (
      leftEnd > value.length ||
      rightStart < 0 ||
      !value.startsWith(boundary.left) ||
      !value.endsWith(boundary.right)
    ) {
      return null;
    }
    const before = tokensBefore(serialized, indexInText[leftEnd]!);
    const after =
      full.length - tokensAfter(serialized, indexInText[rightStart]!);
    // The two halves should meet. Where they do not, the caret sits inside an
    // atom one half claims and the other splits, and the position lies between
    // the two claims rather than at either.
    const consumed =
      before === after ? before : Math.round((before + after) / 2);
    mapped.push({
      ...boundary,
      measured: true,
      sourceEnd: consumed > 0 ? full[consumed - 1]!.end : 0,
      sourceStart:
        consumed < full.length ? full[consumed]!.start : source.length,
    });
  }
  return mapped;
}

/**
 * Matches each boundary by searching the document for the tokens it names.
 *
 * The fallback for documents the two spellings describe differently, where
 * counting would count different things. `representativeOffsets` is what keeps
 * its answers usable when a search goes astray.
 *
 * Only the writing before the caret is searched. What follows it answers the
 * same question -- the suffix begins where the prefix stops -- so tokenizing it
 * as well doubled the work of the slowest path to learn nothing new.
 */
function searchedMatches(
  source: string,
  boundaries: readonly SerializedCaretBoundary[],
  full: readonly SemanticToken[],
): MappedBoundary[] {
  const work = boundaries.length * (source.length + 1);
  const stride = Math.max(1, Math.ceil(work / SEARCH_BUDGET));
  const lastIndex = boundaries.length - 1;
  return boundaries.map((boundary, index) => {
    // The ends anchor the interpolation, so they are always measured.
    if (index % stride !== 0 && index !== lastIndex) {
      return {
        ...boundary,
        measured: false,
        sourceEnd: 0,
        sourceStart: source.length,
      };
    }
    const left = semanticTokens(alignableSerialization(boundary.left));
    let consumed = 0;
    for (const token of left) {
      while (consumed < full.length && full[consumed]!.id !== token.id) {
        consumed += 1;
      }
      if (consumed >= full.length) break;
      consumed += 1;
    }
    return {
      ...boundary,
      measured: true,
      sourceEnd: consumed > 0 ? full[consumed - 1]!.end : 0,
      sourceStart:
        consumed < full.length ? full[consumed]!.start : source.length,
    };
  });
}

/**
 * One canonical source offset per rendered caret position.
 *
 * Token matching cannot be exact, so a matched range must not decide the answer
 * on its own. A rendered prefix is not a source prefix: MathLive normalizes
 * partial serializations, aliasing commands (`\differentialD` serializes as
 * `\mathrm{d}`) and closing math early so an atom that is math in the whole
 * document is text in the cut (`\text{z}` leaks its `z` past the delimiter).
 * Either shifts token identity, and because the matcher answers each boundary
 * on its own, one shifted boundary used to resolve into an unrelated region of
 * the document and drag every later answer with it.
 *
 * So the properties callers depend on are established here rather than assumed
 * from the match: offsets rise with the positions they describe, and distinct
 * positions get distinct offsets wherever the document has room. The second is
 * what makes a position reachable at all, because the inverse resolves a source
 * offset to a single nearest entry and an entry sharing its offset with an
 * earlier one can never be that entry.
 */
function representativeOffsets(
  mapped: readonly MappedBoundary[],
  sourceLength: number,
): number[] {
  const count = mapped.length;
  if (count === 0) return [];

  // Every later position starts at or after this one, so the smallest suffix
  // start seen from the right bounds this position from above. A minimum is
  // unmoved by a single overlarge match, which is the shape a mismatch takes.
  const upperBound: number[] = new Array<number>(count);
  let running = sourceLength;
  for (let index = count - 1; index >= 0; index -= 1) {
    running = Math.min(running, mapped[index]!.sourceStart);
    upperBound[index] = running;
  }

  // A skipped position has nothing to contradict, and a measured one whose
  // prefix ends past what its own suffix and every later suffix allow cannot be
  // describing this place. Both are rebuilt from their neighbours instead of
  // believed, which is what keeps one bad match from moving the caret into a
  // different row of the document.
  const contradicted = mapped.map(
    (boundary, index) =>
      !boundary.measured || boundary.sourceEnd > upperBound[index]!,
  );

  // Consecutive positions that matched the same span are spread across it, the
  // first sitting where its prefix ended and the last where its suffix begins.
  // They are separate places -- a caret before a fraction and one inside its
  // numerator serialize identically -- and collapsing them onto one offset is
  // what made all but one of them impossible to reach.
  const estimates: (number | null)[] = new Array<number | null>(count).fill(
    null,
  );
  for (let start = 0; start < count;) {
    if (contradicted[start]) {
      start += 1;
      continue;
    }
    const low = mapped[start]!.sourceEnd;
    const high = upperBound[start]!;
    let end = start;
    while (
      end + 1 < count &&
      !contradicted[end + 1] &&
      mapped[end + 1]!.sourceEnd === low &&
      upperBound[end + 1] === high
    ) {
      end += 1;
    }
    const runLength = end - start + 1;
    for (let step = 0; step < runLength; step += 1) {
      const ratio = runLength === 1 ? 0.5 : step / (runLength - 1);
      estimates[start + step] = Math.round(low + (high - low) * ratio);
    }
    start = end + 1;
  }

  for (let index = 0; index < count; index += 1) {
    if (estimates[index] !== null) continue;
    let previous = index - 1;
    while (previous >= 0 && estimates[previous] === null) previous -= 1;
    let next = index + 1;
    while (next < count && estimates[next] === null) next += 1;
    const before = previous >= 0 ? estimates[previous]! : 0;
    const after = next < count ? estimates[next]! : sourceLength;
    const span = next - previous;
    estimates[index] = Math.round(
      before +
        ((after - before) * (index - previous)) / (span === 0 ? 1 : span),
    );
  }

  const offsets = estimates.map((estimate) =>
    Math.max(0, Math.min(sourceLength, estimate!)),
  );
  for (let index = 1; index < count; index += 1) {
    offsets[index] = Math.max(offsets[index]!, offsets[index - 1]!);
  }
  // Collisions are opened downwards first. A later position is pinned by the
  // prefix it matched, while the earlier one of a colliding pair is the one
  // with room behind it, so moving that one keeps both nearer to the place
  // they actually describe.
  for (let index = count - 2; index >= 0; index -= 1) {
    if (offsets[index]! >= offsets[index + 1]!) {
      offsets[index] = Math.max(0, offsets[index + 1]! - 1);
    }
  }
  for (let index = 1; index < count; index += 1) {
    if (offsets[index]! <= offsets[index - 1]!) {
      offsets[index] = Math.min(sourceLength, offsets[index - 1]! + 1);
    }
  }
  // A document can hold fewer offsets than it has positions, and then no
  // assignment separates them all. Staying inside the document matters more
  // than separation, so any collision left here is one the source genuinely
  // cannot express.
  return offsets;
}

/** Where a serialization and canonical source stop describing the same writing. */
export interface AlignmentDivergence {
  index: number;
  serialization: string | null;
  source: string | null;
}

/**
 * The first token identity a serialization and canonical source disagree on,
 * or `null` while they describe the same writing throughout.
 *
 * This is the assumption everything above rests on, made checkable. The mapping
 * cannot verify it while running -- disagreement is indistinguishable from
 * writing it has not reached yet -- so nothing noticed when a row stopped
 * agreeing and a third of an ordinary derivation's caret positions became
 * impossible to reach. Its tests compare the two spellings of a document
 * through this, so a new sentinel, a new command, or a new version of MathLive
 * fails at the sentence that stopped being true rather than as a caret landing
 * somewhere strange months later.
 */
export function alignmentDivergence(
  source: string,
  serialization: string,
): AlignmentDivergence | null {
  const sourceIds = semanticTokens(source).map((token) => token.id);
  const serializedIds = semanticTokens(
    alignableSerialization(serialization),
  ).map((token) => token.id);
  const length = Math.max(sourceIds.length, serializedIds.length);
  for (let index = 0; index < length; index += 1) {
    if (sourceIds[index] !== serializedIds[index]) {
      return {
        index,
        serialization: serializedIds[index] ?? null,
        source: sourceIds[index] ?? null,
      };
    }
  }
  return null;
}

/** Maps a field offset to the nearest canonical source boundary. */
export function sourceOffsetForFieldOffset(
  source: string,
  boundaries: readonly SerializedCaretBoundary[],
  fieldOffset: number,
): number {
  const offsets = mapBoundaries(source, boundaries);
  if (offsets.length === 0) return 0;
  let nearest = 0;
  for (let index = 1; index < offsets.length; index += 1) {
    if (
      Math.abs((boundaries[index]?.fieldOffset ?? 0) - fieldOffset) <
      Math.abs((boundaries[nearest]?.fieldOffset ?? 0) - fieldOffset)
    ) {
      nearest = index;
    }
  }
  return offsets[nearest] ?? 0;
}

/** Maps a canonical source offset to the nearest MathLive field boundary. */
export function fieldOffsetForSourceOffset(
  source: string,
  boundaries: readonly SerializedCaretBoundary[],
  sourceOffset: number,
): number {
  const offsets = mapBoundaries(source, boundaries);
  if (offsets.length === 0) return 0;
  const clamped = Math.max(0, Math.min(source.length, sourceOffset));
  let nearest = 0;
  for (let index = 1; index < offsets.length; index += 1) {
    const distance = Math.abs(offsets[index]! - clamped);
    const nearestDistance = Math.abs(offsets[nearest]! - clamped);
    if (
      distance < nearestDistance ||
      (distance === nearestDistance && index > nearest)
    ) {
      nearest = index;
    }
  }
  return boundaries[nearest]?.fieldOffset ?? 0;
}
