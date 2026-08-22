/** Proves conversion, sanitization, cache bounds/invalidation, fallback, styles, and line rendering. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requiredTestValue } from '../test/assertions';

const convertLatexToMarkup = vi.hoisted(() =>
  vi.fn((source: string, options?: unknown) => {
    void options;
    return `<span>${source}</span>`;
  }),
);

vi.mock('mathlive', () => ({ convertLatexToMarkup }));

import { staticMathMarkup } from './staticMathMarkup';

afterEach(() => convertLatexToMarkup.mockClear());

describe('staticMathMarkup', () => {
  it('reuses markup only when every semantic input matches', () => {
    const first = staticMathMarkup('cache-one $x$', {
      baseColor: '#1f2937',
      isMathOnly: false,
    });
    const second = staticMathMarkup('cache-one $x$', {
      baseColor: '#1f2937',
      isMathOnly: false,
    });
    staticMathMarkup('cache-one $x$', {
      baseColor: '#e03131',
      isMathOnly: false,
    });

    expect(second).toBe(first);
    expect(convertLatexToMarkup).toHaveBeenCalledTimes(2);
  });

  it('uses the stable text-root document for formula-only output', () => {
    staticMathMarkup('$x$', {
      baseColor: '#1f2937',
      isMathOnly: true,
    });

    expect(
      requiredTestValue(
        convertLatexToMarkup.mock.lastCall,
        'formula-only static conversion',
      ),
    ).toEqual(['$x$', expect.objectContaining({ defaultMode: 'text' })]);
  });

  it('keeps line spacing in the cache identity', () => {
    const source = String.raw`$\begin{aligned}a&=b\\c&=d\end{aligned}$`;

    staticMathMarkup(source, {
      baseColor: '#1f2937',
      isMathOnly: true,
      lineSpacing: 1.2,
    });
    staticMathMarkup(source, {
      baseColor: '#1f2937',
      isMathOnly: true,
      lineSpacing: 2.4,
    });

    expect(convertLatexToMarkup).toHaveBeenCalledTimes(2);
    expect(
      requiredTestValue(
        convertLatexToMarkup.mock.calls[0],
        'first static conversion',
      )[1],
    ).toMatchObject({ registers: { arraystretch: 1 } });
    expect(
      requiredTestValue(
        convertLatexToMarkup.mock.calls[1],
        'second static conversion',
      )[1],
    ).toMatchObject({ registers: { arraystretch: 2 } });
  });

  it('evicts least-recently-used entries instead of growing without bound', () => {
    for (let index = 0; index < 520; index += 1) {
      staticMathMarkup(`cache-bound-${index} $z$`, {
        baseColor: '#1f2937',
        isMathOnly: false,
      });
    }
    staticMathMarkup('cache-bound-0 $z$', {
      baseColor: '#1f2937',
      isMathOnly: false,
    });

    expect(convertLatexToMarkup).toHaveBeenCalledTimes(521);
  });

  it('does not retain a single oversized result', () => {
    convertLatexToMarkup.mockReturnValueOnce('x'.repeat(1_000_000));

    staticMathMarkup('cache-oversized $q$', {
      baseColor: '#1f2937',
      isMathOnly: false,
    });
    staticMathMarkup('cache-oversized $q$', {
      baseColor: '#1f2937',
      isMathOnly: false,
    });

    expect(convertLatexToMarkup).toHaveBeenCalledTimes(2);
  });

  it('sanitizes unsafe commands before conversion', () => {
    staticMathMarkup(String.raw`safe $x+\href{https://example.com}{y}$`, {
      baseColor: '#1f2937',
      isMathOnly: false,
    });

    expect(
      requiredTestValue(
        convertLatexToMarkup.mock.lastCall,
        'sanitized static conversion',
      )[0],
    ).not.toContain('\\href');
  });
});
