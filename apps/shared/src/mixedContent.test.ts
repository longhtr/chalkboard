/** Validates structured prose/math documents and rejects malformed rows, spans, styles, and versions. */
import { describe, expect, it } from 'vitest';

import { isMixedContentDocument } from './mixedContent';

describe('isMixedContentDocument', () => {
  it('validates structured rows and spans', () => {
    expect(
      isMixedContentDocument({
        rows: [
          {
            spans: [
              {
                bold: false,
                color: '#1f2937',
                italic: true,
                kind: 'text',
                text: 'value ',
              },
              { kind: 'math', latex: 'x^2' },
            ],
          },
        ],
        version: 1,
      }),
    ).toBe(true);
    expect(isMixedContentDocument({ rows: [], version: 2 })).toBe(false);
    expect(
      isMixedContentDocument({
        rows: [{ spans: [{ kind: 'text', text: 'missing attributes' }] }],
        version: 1,
      }),
    ).toBe(false);
  });
});
