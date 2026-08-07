/**
 * Narrow MathLive shadow-DOM adapter for assertions impossible through public
 * controls. Product actions remain visible keyboard/pointer interactions.
 */
import { expect, type Locator } from '@playwright/test';

type PagePoint = { x: number; y: number };

export interface ActiveCaretStyle {
  animationDuration: string;
  animationIterationCount: string;
  animationName: string;
  opacity: string;
  visibility: string;
}

export function activeMathFieldCaretStyle(
  mathField: Locator,
): Promise<ActiveCaretStyle | null> {
  return mathField.evaluate((field) => {
    const caret = field.shadowRoot?.querySelector(
      '.ML__caret, .ML__text-caret, .ML__latex-caret',
    );
    if (caret === null || caret === undefined) return null;
    const style = getComputedStyle(caret, '::after');
    return {
      animationDuration: style.animationDuration,
      animationIterationCount: style.animationIterationCount,
      animationName: style.animationName,
      opacity: style.opacity,
      visibility: style.visibility,
    };
  });
}

export async function activeMathFieldGlyphPoint(
  mathField: Locator,
  selector: string,
  value: string,
  horizontal: 'center' | 'leading' = 'center',
): Promise<PagePoint> {
  await expect
    .poll(() =>
      mathField.evaluate(
        (field, { glyphSelector, glyphValue }) =>
          [...(field.shadowRoot?.querySelectorAll(glyphSelector) ?? [])].some(
            (element) =>
              element.textContent === glyphValue &&
              element.getBoundingClientRect().width > 0,
          ),
        { glyphSelector: selector, glyphValue: value },
      ),
    )
    .toBe(true);

  const point = await mathField.evaluate(
    (field, { glyphSelector, glyphValue, horizontalPosition }) => {
      const glyph = [
        ...(field.shadowRoot?.querySelectorAll(glyphSelector) ?? []),
      ].find((element) => element.textContent === glyphValue);
      if (!(glyph instanceof HTMLElement)) return null;
      const bounds = glyph.getBoundingClientRect();
      return {
        x:
          bounds.x +
          (horizontalPosition === 'leading'
            ? Math.min(1, bounds.width / 4)
            : bounds.width / 2),
        y: bounds.y + bounds.height / 2,
      };
    },
    {
      glyphSelector: selector,
      glyphValue: value,
      horizontalPosition: horizontal,
    },
  );
  expect(point).not.toBeNull();
  if (point === null) throw new Error('The active MathLive glyph disappeared.');
  return point;
}

export async function activeMathFieldTextBoundaryPoint(
  mathField: Locator,
  line: string,
  offset: number,
): Promise<PagePoint> {
  const locatePoint = (
    field: HTMLElement,
    target: { line: string; offset: number },
  ) => {
    const base = field.shadowRoot?.querySelector('.ML__base');
    if (!(base instanceof HTMLElement)) return null;
    const lines: Text[][] = [[]];
    const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node !== null) {
      if (node instanceof Text) {
        if (node.data === '\u2063') lines.push([]);
        else lines.at(-1)?.push(node);
      }
      node = walker.nextNode();
    }
    const textNodes = lines.find(
      (candidate) => candidate.map(({ data }) => data).join('') === target.line,
    );
    if (textNodes === undefined) return null;
    let remainingOffset = target.offset;
    for (const textNode of textNodes) {
      if (remainingOffset < textNode.length) {
        const range = document.createRange();
        range.setStart(textNode, remainingOffset);
        range.setEnd(textNode, remainingOffset + 1);
        const bounds = range.getBoundingClientRect();
        if (bounds.width <= 0) return null;
        return {
          x: bounds.x + Math.min(1, bounds.width / 4),
          y: bounds.y + bounds.height / 2,
        };
      }
      remainingOffset -= textNode.length;
    }
    return null;
  };
  await expect
    .poll(() => mathField.evaluate(locatePoint, { line, offset }))
    .not.toBeNull();
  const point = await mathField.evaluate(locatePoint, { line, offset });
  if (point === null)
    throw new Error('The active MathLive text boundary disappeared.');
  return point;
}

export async function clickMathFieldAtPagePoint(
  mathField: Locator,
  point: PagePoint,
): Promise<void> {
  const bounds = await mathField.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds === null)
    throw new Error('The active MathLive field disappeared.');
  await mathField.click({
    position: { x: point.x - bounds.x, y: point.y - bounds.y },
  });
}
