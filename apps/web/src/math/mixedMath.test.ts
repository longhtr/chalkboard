/** Exhaustive canonical mixed-source cases for parsing, escaping, styles, markers, line breaks, and malformed input. */
import { describe, expect, it } from 'vitest';

import { requiredTestValue } from '../test/assertions';
import {
  canonicalizeMathLiveEditorValue,
  expandTextColors,
  expandTextStyles,
  fromMathLiveMultilineSource,
  isEmptyMixedSource,
  liftMathLineBreaks,
  mathDelimiterBody,
  mathSegments,
  migrateLegacyMathSource,
  mixedSourceFromMathLiveEditor,
  normalizeMathLiveSource,
  normalizeTextColors,
  normalizeTextStyles,
  parseMixedText,
  preservePublishedLineBreaks,
  replaceMathSegment,
  stripTextColors,
  textColorForMarker,
  toMathLiveEditorSource,
  unwrapWholeTextColor,
  updateMathSegment,
  MATHLIVE_BARE_DOLLAR,
  MATHLIVE_BOLD_OFF,
  MATHLIVE_BOLD_ON,
  MATHLIVE_ITALIC_OFF,
  MATHLIVE_ITALIC_ON,
  MATHLIVE_LINE_BREAK,
  MATHLIVE_LITERAL_BACKSLASH,
  MATHLIVE_LITERAL_BRACE_LEFT,
  MATHLIVE_LITERAL_BRACE_RIGHT,
  MATHLIVE_LITERAL_DOLLAR,
  MATHLIVE_LITERAL_PERCENT,
  stripReservedSentinels,
} from './mixedMath';
import { editorClipboardInsertions } from './editorClipboard';

describe('mixed math source', () => {
  it('separates text and math while normalizing legacy double delimiters', () => {
    expect(
      parseMixedText('before $x+1$ between $$\\frac{a}{b}$$ after').map(
        (segment) =>
          segment.kind === 'text'
            ? ['text', segment.source]
            : ['math', segment.latex],
      ),
    ).toEqual([
      ['text', 'before '],
      ['math', 'x+1'],
      ['text', ' between '],
      ['math', '\\frac{a}{b}'],
      ['text', ' after'],
    ]);
  });

  it('leaves escaped and unmatched dollar signs as text', () => {
    expect(mathSegments(String.raw`cost: \$5 and $unfinished`)).toEqual([]);
  });

  it('does not close math delimiters on dollars inside grouped arguments', () => {
    const source = String.raw`$x+\text{price $5}+y$ after`;
    expect(mathSegments(source).map(({ latex }) => latex)).toEqual([
      String.raw`x+\text{price $5}+y`,
    ]);
    expect(normalizeMathLiveSource(source)).toBe(source);
  });

  it('returns only the body of a complete outer delimiter pair', () => {
    expect(mathDelimiterBody('$x+1$')).toBe('x+1');
    expect(mathDelimiterBody('$$x+1$$')).toBe('x+1');
    expect(mathDelimiterBody('plain text')).toBeNull();
  });

  it('parses and canonicalizes adjacent inline math regions', () => {
    expect(mathSegments('$a$$+1$$b$').map(({ latex }) => latex)).toEqual([
      'a',
      '+1',
      'b',
    ]);
    expect(normalizeMathLiveSource('$a$$+1$$b$')).toBe('$a+1b$');
    expect(normalizeMathLiveSource('$\\alpha$$beta$')).toBe('$\\alpha beta$');
  });

  it('updates or removes only the selected math region', () => {
    const source = 'a $x$ b $y$ c';
    const [first, second] = mathSegments(source);
    if (first === undefined || second === undefined) {
      throw new Error('Expected two parsed math regions');
    }

    expect(updateMathSegment(source, second, 'z+1')).toBe('a $x$ b $z+1$ c');
    expect(replaceMathSegment(source, first, '')).toBe('a  b $y$ c');
  });

  it('renders MathLive bracket commands as plain-text brackets', () => {
    const source = String.raw`Atkin \lbrack2\rbrack and Knopp \lbrack4\rbrack`;
    expect(toMathLiveEditorSource(source)).toBe('Atkin [2] and Knopp [4]');
    expect(normalizeMathLiveSource(source)).toBe('Atkin [2] and Knopp [4]');
  });

  it('normalizes every math run to single delimiters', () => {
    expect(normalizeMathLiveSource('text $ \\displaystyle x^2 $ end')).toBe(
      'text $x^2$ end',
    );
    expect(normalizeMathLiveSource('text $x$ end')).toBe('text $x$ end');
  });

  it('lifts editor line breaks out of nested LaTeX arguments', () => {
    expect(
      liftMathLineBreaks(
        '$\\sum_{i=0}^{\\text{7\n}}i$\n$\\frac{a\n}{b}$ after',
      ),
    ).toBe('$\\sum_{i=0}^{\\text{7}}i$\n\n$\\frac{a}{b}$\n after');
    expect(liftMathLineBreaks('before $x+1$\nafter')).toBe(
      'before $x+1$\nafter',
    );
  });

  it('uses one canonical conversion for change, history, persistence, and commit', () => {
    const options = {
      baseColor: '#1f2937',
      emptyMathRegion: false,
      hasExplicitMath: true,
      mode: 'math' as const,
      retainsMathOnlySource: true,
    };
    expect(
      mixedSourceFromMathLiveEditor(String.raw`\frac{a}{b}`, options),
    ).toBe(String.raw`$\frac{a}{b}$`);
    expect(
      mixedSourceFromMathLiveEditor('abc', {
        ...options,
        retainsMathOnlySource: false,
      }),
    ).toBe('$abc$');
    expect(
      mixedSourceFromMathLiveEditor('before $x+1$ after', {
        ...options,
        mode: 'text',
        retainsMathOnlySource: false,
      }),
    ).toBe('before $x+1$ after');
    expect(
      mixedSourceFromMathLiveEditor(
        String.raw`\textbf{before }$ x^2 $\textbf{ after}`,
        { ...options, mode: 'text', retainsMathOnlySource: false },
      ),
    ).toBe(String.raw`\textbf{before }$x^2$\textbf{ after}`);
    expect(
      mixedSourceFromMathLiveEditor(
        `\\sqrt{x${String.fromCodePoint(0x2063)}}`,
        { ...options, retainsMathOnlySource: false },
      ),
    ).toBe('$\\sqrt{x}$\n');
  });

  it('removes placeholders and collapses internal formatting markers', () => {
    const editorValue = `\\placeholder{}${String.fromCodePoint(0x2066)}bold${String.fromCodePoint(0x2067)}`;
    expect(
      mixedSourceFromMathLiveEditor(editorValue, {
        baseColor: '#1f2937',
        emptyMathRegion: false,
        hasExplicitMath: false,
        mode: 'text',
        retainsMathOnlySource: false,
      }),
    ).toBe(String.raw`\textbf{bold}`);
  });

  it('canonicalizes nested editor newlines for delimited and math-only values', () => {
    expect(
      canonicalizeMathLiveEditorValue(
        `$\\sum_{i=0}^{\\text{7${String.fromCodePoint(0x2063)}}}i$`,
        { wrapUndelimitedMath: false },
      ),
    ).toBe('$\\sum_{i=0}^{\\text{7}}i$\n');
    expect(
      canonicalizeMathLiveEditorValue(
        `\\sqrt{x\\text{${String.fromCodePoint(0x2063)}}}`,
        { wrapUndelimitedMath: true },
      ),
    ).toBe('$\\sqrt{x\\text{}}$\n');
  });

  it('preserves published rows if focus normalization silently flattens them', () => {
    expect(
      preservePublishedLineBreaks('First\nSecond\nThird', 'FirstSecondThird'),
    ).toBe('First\nSecond\nThird');
    expect(preservePublishedLineBreaks('$a$\n$b$\n$c$', '$abc$')).toBe(
      '$a$\n$b$\n$c$',
    );
    expect(preservePublishedLineBreaks('First\nSecond', 'FirstSecond!')).toBe(
      'FirstSecond!',
    );
    expect(
      preservePublishedLineBreaks('First\nSecond', 'First\nSecond\nThird'),
    ).toBe('First\nSecond\nThird');
  });

  it('recognizes blocks with no visible content', () => {
    for (const source of [
      '',
      '   \n ',
      '$ $',
      '$\\placeholder{}$',
      String.raw`\textbf{}`,
      String.raw`\textcolor{#1f2937}{}`,
      String.raw`$\text{}\quad\,$`,
    ]) {
      expect(isEmptyMixedSource(source), source).toBe(true);
    }
    expect(isEmptyMixedSource('$x$')).toBe(false);
    expect(isEmptyMixedSource('.')).toBe(false);
    expect(isEmptyMixedSource(String.raw`$\frac{}{}$`)).toBe(false);
  });

  it('keeps an auto-paired empty math region matched', () => {
    expect(normalizeMathLiveSource('text $  $')).toBe('text $ $');
    expect(mathSegments(normalizeMathLiveSource('text $  $'))).toHaveLength(1);
  });

  it('decodes MathLive text-mode punctuation without touching math', () => {
    expect(
      normalizeMathLiveSource(
        String.raw`Hello\! \textbraceleft x\_y\textbraceright $a\!b$`,
      ),
    ).toBe(String.raw`Hello! {x_y}$a\!b$`);
  });

  it('drops empty color metadata even when the element uses a custom base color', () => {
    const source = String.raw`before\textcolor{#1f2937}{} $x$ after`;
    expect(expandTextColors(source, '#565b66')).toBe('before $x$ after');
    expect(normalizeTextColors(source, '#565b66')).toBe('before $x$ after');
  });

  it('round-trips inline colors without exposing formatting commands', () => {
    const source = String.raw`before \textcolor{#1971c2}{blue $x^2$} after`;
    const expanded = expandTextColors(source, '#1f2937');
    expect(expanded).not.toContain('\\textcolor');
    expect(normalizeTextColors(expanded, '#1f2937')).toBe(source);
    expect(stripTextColors(source)).toBe('before blue $x^2$ after');
  });

  it('round-trips nested regular, bold, italic, and combined text styles', () => {
    const source = String.raw`plain \textbf{bold \textit{both} bold} \textit{italic} end`;
    const expanded = expandTextStyles(source);
    expect(expanded).not.toContain('\\textbf');
    expect(expanded).not.toContain('\\textit');
    expect(normalizeTextStyles(expanded)).toBe(
      String.raw`plain \textbf{bold }\textbf{\textit{both}}\textbf{ bold} \textit{italic} end`,
    );
  });

  it('migrates legacy text-style wrappers that span math', () => {
    const source = String.raw`\textbf{before $x^2$ \textit{after}}`;
    expect(normalizeTextStyles(source)).toBe(
      String.raw`\textbf{before }$x^2$\textbf{ }\textbf{\textit{after}}`,
    );
  });

  it('keeps text styles out of math crossed by a styled selection', () => {
    const boldOn = String.fromCodePoint(0x2066);
    const boldOff = String.fromCodePoint(0x2067);
    const italicOn = String.fromCodePoint(0x2068);
    const italicOff = String.fromCodePoint(0x2069);
    const normalized = normalizeTextStyles(
      `${boldOn}${italicOn}before $x^2$ after${italicOff}${boldOff}`,
    );
    expect(normalized).toBe(
      String.raw`\textbf{\textit{before }}$x^2$\textbf{\textit{ after}}`,
    );
    expect(normalizeTextStyles(normalized)).toBe(normalized);
    expect(mathSegments(normalized).map(({ latex }) => latex)).toEqual(['x^2']);
  });

  it('preserves combined text color and italic styling', () => {
    const source = String.raw`plain \textcolor{#1971c2}{blue \textit{italic}} end`;
    const expanded = expandTextStyles(expandTextColors(source, '#1f2937'));
    const normalized = normalizeTextStyles(
      normalizeTextColors(expanded, '#1f2937'),
    );
    expect(normalized).toContain('\\textcolor{#1971c2}');
    expect(normalized).toContain('\\textit{');
    expect(stripTextColors(normalized)).toBe('plain blue italic end');
  });

  it('does not treat math-mode text commands as mixed-text styling', () => {
    const source = String.raw`plain $\textit{math text}$ end`;
    expect(expandTextStyles(source)).toBe(source);
    expect(normalizeTextStyles(source)).toBe(source);
  });

  it('hides bold and italic formatting commands and markers from plain text', () => {
    const source = String.raw`plain \textbf{bold \textit{and italic}} end`;
    expect(stripTextColors(source)).toBe('plain bold and italic end');
    expect(stripTextColors(expandTextStyles(source))).toBe(
      'plain bold and italic end',
    );
  });

  it('unwraps a color that covers the complete block', () => {
    expect(
      unwrapWholeTextColor(String.raw`\textcolor{#1f2937}{block 1}`),
    ).toEqual({ color: '#1f2937', source: 'block 1' });
    expect(
      unwrapWholeTextColor(String.raw`x\textcolor{#1f2937}{block 1}`),
    ).toBeNull();
  });

  it('preserves arbitrary colors while hiding their formatting commands', () => {
    const source = String.raw`A\textcolor{#f59f00}{custom}Z`;
    // A colour outside the starting palettes has to expand to markers like any
    // other. Leaving the command for MathLive is what made the editable field
    // escape it and show the reader `\textcolor{#f59f00}{custom}` as prose.
    const expanded = expandTextColors(source, '#1f2937');
    expect(expanded).not.toContain('\\textcolor');
    expect(expanded).toMatch(/^A.custom.Z$/u);
    expect(normalizeTextColors(source, '#1f2937')).toBe(source);
    expect(stripTextColors(source)).toBe('AcustomZ');
    expect(stripTextColors(expanded)).toBe('AcustomZ');
  });

  it('expands every distinct color to a distinct marker', () => {
    const colors = Array.from(
      { length: 64 },
      (_entry, index) => `#${(0x100000 + index * 977).toString(16)}`,
    );
    const markers = colors.map((color) => {
      const expanded = expandTextColors(
        `\\textcolor{${color}}{x}`,
        '#1f2937',
      ).replace(/x.*$/su, '');
      expect(expanded).not.toContain('\\textcolor');
      return expanded;
    });
    expect(new Set(markers).size).toBe(colors.length);
    for (const [index, marker] of markers.entries()) {
      expect([...marker]).toHaveLength(1);
      expect(textColorForMarker(marker)).toBe(colors[index]);
    }
  });

  it('round-trips 1,000 generated canonical mixed documents', () => {
    let state = 0x51a7e;
    const random = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 4_294_967_296;
    };
    const text = [
      'plain',
      String.raw`cost \$5`,
      String.raw`path\part`,
      String.raw`\textbf{bold}`,
      String.raw`\textit{italic}`,
      '\n',
    ];
    const math = [
      'x+1',
      String.raw`\frac{a}{b}`,
      String.raw`\sqrt{x^2}`,
      String.raw`\sum_{i=0}^{n}i`,
      String.raw`\text{price $5}+y`,
    ];

    for (let iteration = 0; iteration < 1_000; iteration += 1) {
      const parts: string[] = [];
      const expectedMath: string[] = [];
      const count = 1 + Math.floor(random() * 8);
      let lastWasMath = false;
      for (let index = 0; index < count; index += 1) {
        if (!lastWasMath && random() < 0.45) {
          const latex = math[Math.floor(random() * math.length)] ?? 'x';
          parts.push(`$${latex}$`);
          expectedMath.push(latex);
          lastWasMath = true;
        } else {
          parts.push(text[Math.floor(random() * text.length)] ?? 'plain');
          lastWasMath = false;
        }
      }
      const source = parts.join('');
      expect(mathSegments(source).map(({ latex }) => latex)).toEqual(
        expectedMath,
      );
      expect(fromMathLiveMultilineSource(toMathLiveEditorSource(source))).toBe(
        source,
      );
      const normalized = normalizeMathLiveSource(source);
      expect(normalizeMathLiveSource(normalized)).toBe(normalized);

      const parsed = parseMixedText(source);
      const generatedMath = mathSegments(source);
      const mathOnly =
        generatedMath.length === 1 &&
        parsed.every(
          (segment) => segment.kind === 'math' || segment.source.trim() === '',
        );
      const expanded = expandTextStyles(expandTextColors(source, '#1f2937'));
      const editorValue = mathOnly
        ? requiredTestValue(
            mathSegments(expanded)[0],
            'expanded math-only segment',
          ).latex
        : toMathLiveEditorSource(expanded);
      const persisted = mixedSourceFromMathLiveEditor(editorValue, {
        baseColor: '#1f2937',
        emptyMathRegion: false,
        hasExplicitMath: generatedMath.length > 0,
        mode: mathOnly ? 'math' : 'text',
        retainsMathOnlySource: mathOnly,
      });
      const expandedPersisted = expandTextStyles(
        expandTextColors(persisted, '#1f2937'),
      );
      const reopenedValue = mathOnly
        ? requiredTestValue(
            mathSegments(expandedPersisted)[0],
            'persisted math-only segment',
          ).latex
        : toMathLiveEditorSource(expandedPersisted);
      expect(
        mixedSourceFromMathLiveEditor(reopenedValue, {
          baseColor: '#1f2937',
          emptyMathRegion: false,
          hasExplicitMath: mathSegments(persisted).length > 0,
          mode: mathOnly ? 'math' : 'text',
          retainsMathOnlySource: mathOnly,
        }),
      ).toBe(persisted);
    }
  });

  it('wraps legacy equation-only values in display delimiters', () => {
    expect(migrateLegacyMathSource('x^2')).toBe('$x^2$');
    expect(migrateLegacyMathSource('text $x$')).toBe('text $x$');
  });
});

describe('reserved sentinel characters in text from outside', () => {
  it('drops every reserved code point without touching writing', () => {
    // A Scotland flag is a base flag plus tag characters; the tags block is
    // part of the color-marker pool.
    const flag =
      '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}';
    expect(stripReservedSentinels(flag)).toBe('\u{1F3F4}');

    // A CJK ideographic variation sequence.
    expect(stripReservedSentinels('葛\u{E0100}')).toBe('葛');

    // Every sentinel this module writes into a field.
    const sentinels = [
      MATHLIVE_LINE_BREAK,
      MATHLIVE_LITERAL_DOLLAR,
      MATHLIVE_LITERAL_BACKSLASH,
      MATHLIVE_BOLD_ON,
      MATHLIVE_BOLD_OFF,
      MATHLIVE_ITALIC_ON,
      MATHLIVE_ITALIC_OFF,
      MATHLIVE_LITERAL_BRACE_LEFT,
      MATHLIVE_LITERAL_BRACE_RIGHT,
      MATHLIVE_LITERAL_PERCENT,
      MATHLIVE_BARE_DOLLAR,
    ].join('');
    expect(stripReservedSentinels(`a${sentinels}b`)).toBe('ab');

    // Ordinary writing, including the characters that only look dangerous.
    const writing = 'Set {x, y}: 50% of $5 \\ b — “quoted” 数学 ✓';
    expect(stripReservedSentinels(writing)).toBe(writing);
  });

  it('removes them from pasted text before it reaches the field', () => {
    const { insertions } = editorClipboardInsertions(
      `a${MATHLIVE_LINE_BREAK}b\u{E0100}c`,
      'text',
    );
    expect(insertions.map((entry) => entry.value).join('')).toBe('abc');
  });
});
