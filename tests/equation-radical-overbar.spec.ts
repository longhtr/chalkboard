/**
 * A radical's overbar stays attached in active and saved mixed text blocks.
 * A preserved decorative space used to lift the rule by a whole line height.
 */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import {
  canvasBounds,
  createEmptyMathRegion,
  finishEditing,
} from './helpers/equationEditor';

async function overbarOffsetFromSign(page: import('@playwright/test').Page) {
  return page.locator('math-field').evaluate((node) => {
    const root = node.shadowRoot;
    const line = root?.querySelector('.ML__sqrt-line');
    const sign = root?.querySelector('.ML__sqrt-sign');
    if (!(line instanceof HTMLElement) || !(sign instanceof HTMLElement)) {
      return null;
    }
    const lineRect = line.getBoundingClientRect();
    const signRect = sign.getBoundingClientRect();
    return {
      // Distance from the top of the radical glyph down to the bar.
      fromSignTop: Math.round(lineRect.top - signRect.top),
      // The bar must span the radicand, not collapse to nothing.
      width: Math.round(lineRect.width),
      // The decorative pseudo must not generate a line box.
      afterHeight: getComputedStyle(line, '::after').height,
    };
  });
}

test('keeps the radical overbar on the radical while editing', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'canvas bounds');

  await createEmptyMathRegion(page, bounds.x + 300, bounds.y + 200);
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('\\sqrt');
  await page.keyboard.press('Space');
  await page.keyboard.type('x');

  await expect.poll(() => overbarOffsetFromSign(page)).not.toBeNull();
  const measured = await overbarOffsetFromSign(page);
  assertValue(measured, 'overbar geometry');

  expect(measured.afterHeight).toBe('0px');
  expect(measured.width).toBeGreaterThan(0);
  // The bar belongs just below the top of the glyph. The defect placed it a
  // whole line above, which is a large negative offset.
  expect(measured.fromSignTop).toBeGreaterThanOrEqual(0);
  expect(measured.fromSignTop).toBeLessThanOrEqual(12);
});

test('keeps an indexed radical overbar on the radical while editing', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'canvas bounds');

  await createEmptyMathRegion(page, bounds.x + 300, bounds.y + 200);
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('\\sqrt[n]');
  await page.keyboard.press('Space');
  await page.keyboard.type('x+1');

  await expect.poll(() => overbarOffsetFromSign(page)).not.toBeNull();
  const measured = await overbarOffsetFromSign(page);
  assertValue(measured, 'overbar geometry');

  expect(measured.afterHeight).toBe('0px');
  expect(measured.width).toBeGreaterThan(0);
  expect(measured.fromSignTop).toBeGreaterThanOrEqual(0);
  expect(measured.fromSignTop).toBeLessThanOrEqual(12);
});

for (const font of ['excalifont', 'classic']) {
  test(`keeps saved radicals attached with the ${font} font`, async ({
    page,
  }) => {
    await page.addInitScript(
      (choice) => localStorage.setItem('chalkboard:font', choice),
      font,
    );
    await page.goto('/local');
    const { bounds } = await canvasBounds(page);
    assertValue(bounds, 'canvas bounds');
    await createEmptyMathRegion(page, bounds.x + 350, bounds.y + 200);
    const field = page.locator('math-field');
    const expression = String.raw`\sqrt{x}+\sqrt[n]{y}+\sqrt{\sqrt{z}}+\sqrt{\frac{a}{b}}`;
    await field.evaluate((node, text) => {
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: {
          getData: (format: string) => (format === 'text/plain' ? text : ''),
        },
      });
      node.dispatchEvent(paste);
    }, expression);
    // MathLive publishes pasted source before its next render updates the DOM.
    await expect(field.locator('.ML__sqrt-line')).toHaveCount(5);
    const activeOffsets = await field.evaluate((node) =>
      [...(node.shadowRoot?.querySelectorAll('.ML__sqrt-line') ?? [])].map(
        (bar) => {
          const sign = bar
            .closest('.ML__vlist-t')
            ?.parentElement?.querySelector(':scope > .ML__sqrt-sign');
          if (!(sign instanceof HTMLElement))
            throw new Error('Active radical sign is missing');
          return (
            bar.getBoundingClientRect().top - sign.getBoundingClientRect().top
          );
        },
      ),
    );
    expect(activeOffsets).toHaveLength(5);
    await finishEditing(page);
    const lines = page.locator('.math-element .ML__sqrt-line');
    await expect(lines).toHaveCount(5);
    const measurements = await lines.evaluateAll((bars) =>
      bars.map((bar) => {
        // The sign and the radicand's vlist share one parent, including nested roots.
        const sign = bar
          .closest('.ML__vlist-t')
          ?.parentElement?.querySelector(':scope > .ML__sqrt-sign');
        if (!(sign instanceof HTMLElement))
          throw new Error('Radical sign is missing');
        return {
          offset:
            bar.getBoundingClientRect().top - sign.getBoundingClientRect().top,
          width: bar.getBoundingClientRect().width,
          afterHeight: getComputedStyle(bar, '::after').height,
        };
      }),
    );
    for (const [index, measured] of measurements.entries()) {
      expect(measured.afterHeight).toBe('0px');
      expect(measured.width).toBeGreaterThan(0);
      expect(measured.offset).toBeCloseTo(activeOffsets[index]!, 0);
      if (index < 2) {
        expect(measured.offset).toBeGreaterThanOrEqual(-1);
        expect(measured.offset).toBeLessThanOrEqual(12);
      }
    }
  });
}
