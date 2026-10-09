/** Proves source/structured round trips, normalization, styles, line breaks, and malformed fallback. */
import { describe, expect, it } from 'vitest';

import { requiredTestValue } from '../test/assertions';
import {
  mixedDocumentFromSource,
  sourceFromMixedDocument,
} from './mixedDocument';

const baseColor = '#1f2937';

describe('structured mixed documents', () => {
  it('separates rows, text runs, and mathematics', () => {
    expect(
      mixedDocumentFromSource('First $x^2$ row\n\nLast', baseColor),
    ).toEqual({
      rows: [
        {
          spans: [
            {
              bold: false,
              color: baseColor,
              italic: false,
              kind: 'text',
              text: 'First ',
            },
            { kind: 'math', latex: 'x^2' },
            {
              bold: false,
              color: baseColor,
              italic: false,
              kind: 'text',
              text: ' row',
            },
          ],
        },
        { spans: [] },
        {
          spans: [
            {
              bold: false,
              color: baseColor,
              italic: false,
              kind: 'text',
              text: 'Last',
            },
          ],
        },
      ],
      version: 1,
    });
  });

  it('turns formatting wrappers crossing math into structured attributes', () => {
    const document = mixedDocumentFromSource(
      String.raw`\textcolor{#f59f00}{\textbf{before $\frac{a}{b}$ \textit{after}}}`,
      baseColor,
    );

    expect(
      requiredTestValue(document.rows[0], 'first mixed row').spans,
    ).toEqual([
      {
        bold: true,
        color: '#f59f00',
        italic: false,
        kind: 'text',
        text: 'before ',
      },
      { kind: 'math', latex: String.raw`\frac{a}{b}` },
      {
        bold: true,
        color: '#f59f00',
        italic: false,
        kind: 'text',
        text: ' ',
      },
      {
        bold: true,
        color: '#f59f00',
        italic: true,
        kind: 'text',
        text: 'after',
      },
    ]);
  });

  it('round-trips literal punctuation, styles, custom colors, and blank rows', () => {
    const source = String.raw`Price \$5 and path\to\file
\textcolor{#f59f00}{\textbf{bold \textit{and italic}}} $x+y$

end`;
    const document = mixedDocumentFromSource(source, baseColor);
    const encoded = sourceFromMixedDocument(document, baseColor);

    expect(mixedDocumentFromSource(encoded, baseColor)).toEqual(document);
    expect(encoded).toContain(String.raw`\textcolor{#f59f00}`);
    expect(encoded).toContain(String.raw`\$5`);
  });

  it('round-trips generated structured documents', () => {
    let state = 0x51a7c0de;
    const random = () => {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
    };
    const colors = [baseColor, '#f59f00', '#1971c2'];
    const characters = ['a', ' ', '$', '\\', '{', '}', '#', 'é', '東'];
    for (let iteration = 0; iteration < 500; iteration += 1) {
      const rows = Array.from({ length: 1 + Math.floor(random() * 4) }, () => ({
        spans: Array.from({ length: Math.floor(random() * 6) }, (_, index) =>
          index % 2 === 1
            ? { kind: 'math' as const, latex: `x_${iteration}_${index}` }
            : {
                bold: random() > 0.5,
                color: requiredTestValue(
                  colors[Math.floor(random() * colors.length)],
                  'random color fixture',
                ),
                italic: random() > 0.5,
                kind: 'text' as const,
                text: Array.from({ length: 1 + Math.floor(random() * 8) }, () =>
                  requiredTestValue(
                    characters[Math.floor(random() * characters.length)],
                    'random character fixture',
                  ),
                ).join(''),
              },
        ),
      }));
      const document = { rows, version: 1 as const };
      expect(
        mixedDocumentFromSource(
          sourceFromMixedDocument(document, baseColor),
          baseColor,
        ),
      ).toEqual(document);
    }
  });

  it('preserves braces inside styled text', () => {
    const document = {
      rows: [
        {
          spans: [
            {
              bold: true,
              color: baseColor,
              italic: false,
              kind: 'text' as const,
              text: 'set {a, b}',
            },
          ],
        },
      ],
      version: 1 as const,
    };

    expect(
      mixedDocumentFromSource(
        sourceFromMixedDocument(document, baseColor),
        baseColor,
      ),
    ).toEqual(document);
  });
});
