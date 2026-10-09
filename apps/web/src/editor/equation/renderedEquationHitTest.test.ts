/** Builds rendered equation DOM to prove glyph hit testing, line constraints, and missing-DOM fallback. */
import { afterEach, describe, expect, it } from 'vitest';

import { hitTestRenderedEquation } from './renderedEquationHitTest';

const renderedEquation = (id: string, label: string) => {
  const element = document.createElement('div');
  element.dataset.mixedTextId = id;
  element.setAttribute('aria-label', label);
  element.getBoundingClientRect = () =>
    ({
      bottom: 70,
      height: 40,
      left: 20,
      right: 140,
      top: 30,
      width: 120,
      x: 20,
      y: 30,
      toJSON: () => undefined,
    }) as DOMRect;
  document.body.append(element);
  return element;
};

describe('rendered equation hit testing', () => {
  afterEach(() => document.body.replaceChildren());

  it('uses the measured one-line box when transient text geometry is absent', () => {
    renderedEquation('one-line', 'Existing text');

    expect(hitTestRenderedEquation('one-line', { x: 80, y: 50 }, 0)).toBe(true);
    expect(hitTestRenderedEquation('one-line', { x: 180, y: 50 }, 0)).toBe(
      false,
    );
  });

  it('does not fill intentional whitespace inside multiline blocks', () => {
    renderedEquation('multiline', 'First row\nSecond row');

    expect(hitTestRenderedEquation('multiline', { x: 80, y: 50 }, 0)).toBe(
      false,
    );
    expect(
      hitTestRenderedEquation('multiline', { x: 80, y: 50 }, 0, {
        allowMultilineContainerFallback: true,
      }),
    ).toBe(true);
  });

  it('rejects missing rendered elements', () => {
    expect(hitTestRenderedEquation('missing', { x: 0, y: 0 }, 8)).toBe(false);
  });
});
