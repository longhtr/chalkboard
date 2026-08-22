/** Proves the bar correction rewrites written bars and never MathLive's input surface. */
import { describe, expect, it } from 'vitest';

import { decorateExcalifontLayout } from './excalifontLayout';

function tree(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('bar correction', () => {
  it('splits a written run so each bar can be corrected on its own', () => {
    const root = tree('<span class="ML__text">a|b</span>');
    decorateExcalifontLayout(root);

    expect(
      [...root.querySelectorAll('span')].map((span) => span.textContent),
    ).toEqual(['a', '|', 'b']);
    expect(root.querySelector('[data-excalifont-delim]')?.textContent).toBe(
      '|',
    );
  });

  it('leaves the keyboard sink alone, element identity included', () => {
    // MathLive keeps this contenteditable span in its shadow root to mirror the
    // selection for the browser's own copy, and it is what holds the field's
    // focus. Selecting across a bar puts a bar in it. Splitting it replaced the
    // focused element, and Firefox then moved focus to the document body
    // without firing a blur, so every keystroke afterwards was dropped.
    const root = tree(
      '<span contenteditable="true" class="ML__keyboard-sink">\\a|</span>' +
        '<span class="ML__text">c|d</span>',
    );
    const sink = root.querySelector('.ML__keyboard-sink');
    decorateExcalifontLayout(root);

    expect(root.querySelector('.ML__keyboard-sink')).toBe(sink);
    expect(sink?.textContent).toBe('\\a|');
    expect(sink?.hasAttribute('data-excalifont-delim')).toBe(false);
    // The written run beside it is still corrected, so the guard is a guard and
    // not an accidental early return.
    expect(
      [...root.querySelectorAll('.ML__text')].map((span) => span.textContent),
    ).toEqual(['c', '|', 'd']);
  });

  it('leaves a bar nested inside the sink alone', () => {
    const root = tree(
      '<span contenteditable="true" class="ML__keyboard-sink">' +
        '<span class="ML__text">x|y</span></span>',
    );
    const nested = root.querySelector('.ML__text');
    decorateExcalifontLayout(root);

    expect(root.querySelector('.ML__text')).toBe(nested);
    expect(nested?.textContent).toBe('x|y');
  });
});
