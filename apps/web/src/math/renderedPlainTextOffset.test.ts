/** Builds nested rendered DOM to prove point-to-text offset, nearest character, line, and empty fallback. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MATHLIVE_LINE_BREAK } from './mixedMath';
import { renderedPlainTextOffset } from './renderedPlainTextOffset';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});

describe('renderedPlainTextOffset', () => {
  it('maps multiline rendered boundaries back to plain source offsets', () => {
    const container = document.createElement('div');
    const first = document.createElement('span');
    const lineBreak = document.createElement('span');
    const second = document.createElement('span');
    first.textContent = 'abc';
    lineBreak.textContent = MATHLIVE_LINE_BREAK;
    second.textContent = 'def';
    for (const element of [first, lineBreak, second]) {
      element.getBoundingClientRect = () => ({ height: 20, y: 40 }) as DOMRect;
      container.append(element);
    }
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: Range) {
        const base = this.startContainer === first.firstChild ? 10 : 100;
        const left = base + this.startOffset * 10;
        return { left, right: left + 10 } as DOMRect;
      },
    });

    expect(
      renderedPlainTextOffset(container, 'abc\ndef', { x: 121, y: 50 }),
    ).toBe(6);
  });

  it('does not infer source offsets for mathematics', () => {
    const container = document.createElement('div');
    container.textContent = 'x';
    expect(
      renderedPlainTextOffset(container, '$x$', { x: 1, y: 1 }),
    ).toBeNull();
  });
});
