/**
 * A radical's overbar must sit on the radical while it is being edited.
 *
 * The rule carries a decorative `::after` whose content is a single space.
 * Outside the editor that space collapses, the pseudo generates no line box,
 * and the rule's baseline is its own box. Inside the field the text run is
 * `white-space: pre` and carries the block's line spacing, so the space became
 * a real line box a full line tall; being the last line box in an inline-block
 * it set the rule's baseline and lifted the bar a line clear of the glyph. The
 * bar reappeared only once the block was rendered.
 */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import { canvasBounds, createEmptyMathRegion } from './helpers/equationEditor';

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
