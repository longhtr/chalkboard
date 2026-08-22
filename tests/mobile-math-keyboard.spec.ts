/** Phone equation keyboard layout, reachability, insertion, dismissal, and board clearance. */
import { devices, expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';

test('provides a compact task-oriented equation keyboard on phones', async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto('/local');
    await page.getByRole('button', { name: 'Mixed text block tool' }).tap();
    await page
      .getByRole('application', { name: 'Chalkboard drawing canvas' })
      .tap({ position: { x: 195, y: 650 } });

    const keyboard = page.locator('.ML__keyboard.is-visible');
    await expect(keyboard).toBeVisible();
    const activeLayer = () => keyboard.locator('.MLK__layer.is-visible');
    const tabs = activeLayer().locator('.MLK__toolbar > .left > div');
    await expect(tabs).toHaveText(['123', 'abc', 'f(x)', 'αβ']);

    const keyboardBounds = await keyboard.evaluate(() =>
      window.mathVirtualKeyboard.boundingRect.toJSON(),
    );
    expect(keyboardBounds.height).toBeLessThanOrEqual(240);
    expect(
      await keyboard
        .locator('.MLK__plate')
        .evaluate((plate) => plate.scrollWidth),
    ).toBeLessThanOrEqual(
      await keyboard
        .locator('.MLK__plate')
        .evaluate((plate) => plate.clientWidth),
    );
    const fieldBounds = await page.locator('math-field').boundingBox();
    assertValue(fieldBounds, 'mobile equation field bounds');
    expect(fieldBounds.y + fieldBounds.height + 15).toBeLessThanOrEqual(
      keyboardBounds.top,
    );

    await activeLayer().locator('[aria-label="7"]').tap();
    await activeLayer()
      .locator('.MLK__toolbar > .left > div', { hasText: 'f(x)' })
      .tap();
    await activeLayer().locator('[aria-label="Sine"]').tap();
    await activeLayer()
      .locator('.MLK__toolbar > .left > div', { hasText: 'abc' })
      .tap();
    await activeLayer().locator('[aria-label="q"]').tap();
    await activeLayer()
      .locator('.MLK__toolbar > .left > div', { hasText: 'αβ' })
      .tap();
    await activeLayer().locator('[aria-label="alpha"]').tap();

    await expect
      .poll(() =>
        page.locator('math-field').evaluate((field) => {
          return (field as HTMLElement & { value: string }).value;
        }),
      )
      .toMatch(/7.*\\sin.*q.*\\alpha/u);

    const tallerTabHeight = await keyboard.evaluate(
      () => window.mathVirtualKeyboard.boundingRect.height,
    );
    await activeLayer()
      .locator('.MLK__toolbar > .left > div', { hasText: '123' })
      .tap();
    await page.waitForTimeout(1_100);
    await expect(keyboard).toBeVisible();
    await expect
      .poll(() =>
        keyboard.evaluate(() => window.mathVirtualKeyboard.boundingRect.height),
      )
      .toBe(tallerTabHeight);
    await expect(activeLayer()).toHaveAttribute(
      'id',
      'chalkboard-numbers-layer',
    );

    const sourceBeforeUntrustedPointer = await page
      .locator('math-field')
      .evaluate((field) => (field as HTMLElement & { value: string }).value);
    await page.evaluate(() => {
      const field = document.querySelector('math-field');
      if (field === null) throw new Error('Equation field is missing');
      const untrustedElement = document.createElement('button');
      untrustedElement.className = 'chalkboard-line-break-key';
      const pointer = new PointerEvent('pointerdown', {
        bubbles: true,
        composed: true,
      });
      Object.defineProperty(pointer, 'composedPath', {
        value: () => [untrustedElement, field, document.body, document, window],
      });
      field.dispatchEvent(pointer);
    });
    await expect
      .poll(() =>
        page.locator('math-field').evaluate((field) => {
          return (field as HTMLElement & { value: string }).value;
        }),
      )
      .toBe(sourceBeforeUntrustedPointer);

    await activeLayer().locator('.chalkboard-line-break-key').tap();
    await activeLayer()
      .locator('.MLK__toolbar > .left > div', { hasText: 'abc' })
      .tap();
    await activeLayer().locator('[aria-label="LaTeX command"]').tap();
    await activeLayer().locator('[aria-label="q"]').tap();
    await expect
      .poll(() =>
        page.locator('[data-mixed-text-id]').getAttribute('aria-label'),
      )
      .toContain('\n\\q');

    await activeLayer().locator('[data-command*="hideVirtualKeyboard"]').tap();
    await expect(page.locator('.ML__keyboard.is-visible')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
