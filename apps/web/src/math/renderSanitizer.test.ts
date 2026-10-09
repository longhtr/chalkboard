/** Supplies hostile markup/source to prove element, attribute, URL, CSS, command, and marker sanitization. */
import { describe, expect, it } from 'vitest';

import { sanitizeMathForStaticRender } from './renderSanitizer';

describe('static math sanitization', () => {
  it('keeps href bodies while removing navigation targets', () => {
    expect(
      sanitizeMathForStaticRender(
        String.raw`before \href{https://example.com}{x+1} after`,
      ),
    ).toBe('before x+1 after');
  });

  it('removes raw class, identifier, data, and style payloads', () => {
    for (const command of [
      'class',
      'cssId',
      'htmlClass',
      'htmlData',
      'htmlId',
      'htmlStyle',
      'style',
    ]) {
      expect(
        sanitizeMathForStaticRender(
          `before \\${command}{position:fixed;inset:0}{x+1} after`,
        ),
      ).toBe('before x+1 after');
    }
  });

  it('does not reinterpret an escaped command as presentation markup', () => {
    expect(
      sanitizeMathForStaticRender(String.raw`before \\style{red}{x} after`),
    ).toBe(String.raw`before \\style{red}{x} after`);
  });

  it('removes nested href commands recursively', () => {
    expect(
      sanitizeMathForStaticRender(
        String.raw`\href{outer}{a+\href{inner}{\frac{b}{c}}}`,
      ),
    ).toBe(String.raw`a+\frac{b}{c}`);
  });

  it('parses escaped and nested braces in targets and bodies', () => {
    expect(
      sanitizeMathForStaticRender(
        String.raw`\href{https://x.test/\{a\}/{q}}{\text{a \{b\}}+c}`,
      ),
    ).toBe(String.raw`\text{a \{b\}}+c`);
  });

  it('preserves malformed intermediate commands without throwing', () => {
    expect(sanitizeMathForStaticRender(String.raw`x+\href{unfinished`)).toBe(
      String.raw`x+\href{unfinished`,
    );
    expect(
      sanitizeMathForStaticRender(String.raw`x+\href{target}{unfinished`),
    ).toBe(String.raw`x+\href{target}{unfinished`);
  });
});
