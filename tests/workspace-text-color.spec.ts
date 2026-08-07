/** Existing selection color, custom palettes, future typing color, mixed spans, undo, and persistence. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import * as workspace from './helpers/workspace';

test('shows explicit mixed-text input mode controls', async ({ page }) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const modes = page.getByRole('group', { name: 'Input mode' });
  const textMode = modes.getByRole('button', {
    name: 'Use text input mode',
  });
  const mathMode = modes.getByRole('button', {
    name: 'Use math input mode',
  });
  await expect(textMode).toHaveAttribute('aria-pressed', 'true');
  await expect(mathMode).toHaveAttribute('aria-pressed', 'false');

  await mathMode.click();
  await expect(mathMode).toHaveAttribute('aria-pressed', 'true');
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  await page.mouse.click(bounds.x + 360, bounds.y + 240);
  await page.locator('.inline-math-editor.is-ready').waitFor();

  await textMode.click();
  await expect(textMode).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('math-field')).toBeFocused();
});

test('applies text color only to future typing', async ({ page }) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');

  await page.mouse.click(bounds.x + 360, bounds.y + 240);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('Alpha');
  await page.getByRole('button', { name: 'Selection tool' }).click();
  const initialAlpha = page.getByRole('group', { name: 'Alpha' });
  const alphaId = await initialAlpha.getAttribute('data-mixed-text-id');
  assertValue(alphaId, 'mixed-text element identity');
  const alpha = page.locator(`[data-mixed-text-id="${alphaId}"]`);
  const alphaBounds = await alpha.boundingBox();
  assertValue(alphaBounds, 'mixed-text block bounds');
  await page.mouse.click(
    alphaBounds.x + alphaBounds.width / 2,
    alphaBounds.y + alphaBounds.height / 2,
  );

  await expect(page.getByText('Text color', { exact: true })).toHaveCount(0);
  await workspace.selectMixedTextTool(page);
  const currentAlphaBounds = await alpha.boundingBox();
  assertValue(currentAlphaBounds, 'current mixed-text block bounds');
  await page.mouse.click(
    currentAlphaBounds.x + currentAlphaBounds.width - 2,
    currentAlphaBounds.y + currentAlphaBounds.height / 2,
  );
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await expect(page.getByText('Text color', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use #e03131 text color' }).click();
  await expect
    .poll(() =>
      alpha
        .locator('.mixed-text-element__content')
        .evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(31, 41, 55)');
  await page.keyboard.type('R');
  const alphaColoredRun = alpha
    .locator('.mixed-text-color-marker + .ML__text')
    .first();
  await expect(alphaColoredRun).toContainText('R');
  await expect
    .poll(() =>
      alphaColoredRun.evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(224, 49, 49)');
  await expect
    .poll(() =>
      alpha
        .locator('.mixed-text-element__content')
        .evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(31, 41, 55)');
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(page.locator('math-field')).toHaveCount(0);

  await workspace.selectMixedTextTool(page);
  await page.mouse.click(bounds.x + 680, bounds.y + 400);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('Beta');
  const beta = page.locator('.math-element').nth(1);
  await expect
    .poll(() =>
      beta
        .locator('.mixed-text-element__content')
        .evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(224, 49, 49)');
  await page.getByRole('button', { name: 'Use #1971c2 text color' }).click();
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('G');
  const betaColoredRun = beta
    .locator('.mixed-text-color-marker + .ML__text')
    .first();
  await expect(betaColoredRun).toContainText('G');
  await expect
    .poll(() =>
      betaColoredRun.evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(25, 113, 194)');
  await page.keyboard.press('Control+z');
  await expect(beta.locator('.mixed-text-color-marker')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(betaColoredRun).toContainText('G');
  await page.getByRole('button', { name: 'Selection tool' }).click();

  await page.reload();
  await expect(
    alpha.locator('.mixed-text-color-marker + .ML__text').first(),
  ).toContainText('R');
  await expect
    .poll(() =>
      alpha
        .locator('.mixed-text-element__content')
        .evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(31, 41, 55)');
  await expect(
    page
      .locator('.math-element')
      .nth(1)
      .locator('.mixed-text-color-marker + .ML__text')
      .first(),
  ).toContainText('G');
});

test('adds persistent custom colors with at most five controls per row', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const palette = page.locator('.swatches');
  await expect(palette.locator('button')).toHaveCount(4);
  await expect
    .poll(() =>
      palette.evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(' ').length,
      ),
    )
    .toBe(5);

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const canvasBounds = await canvas.boundingBox();
  assertValue(canvasBounds, 'drawing canvas bounds');
  await page.mouse.click(canvasBounds.x + 440, canvasBounds.y + 280);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('A');

  await page.getByRole('button', { name: 'Add color' }).click();
  const picker = page.getByRole('dialog', { name: 'Add custom color' });
  await expect(picker).toBeVisible();
  await expect(picker.locator('.hsv-color-control').first()).toHaveCSS(
    'font-size',
    '12px',
  );
  await expect(picker.getByRole('textbox', { name: 'Hex color' })).toHaveCSS(
    'font-size',
    '12px',
  );
  const panelBounds = await page
    .getByRole('complementary', { name: 'Element style' })
    .boundingBox();
  const pickerBounds = await picker.boundingBox();
  assertValue(panelBounds, 'style panel bounds');
  assertValue(pickerBounds, 'picker bounds');
  if (panelBounds !== null && pickerBounds !== null) {
    expect(pickerBounds.x).toBeGreaterThan(panelBounds.x + panelBounds.width);
  }
  await expect(page.locator('input[type="color"]')).toHaveCount(0);
  await expect(picker.locator('.picker-swatch')).toHaveCount(0);
  await picker.getByRole('slider', { name: 'Hue' }).fill('120');
  await picker.getByRole('slider', { name: 'Saturation' }).fill('100');
  await picker.getByRole('slider', { name: 'Value' }).fill('100');
  await expect(picker.getByRole('textbox', { name: 'Hex color' })).toHaveValue(
    '#00ff00',
  );
  await expect(
    picker.getByRole('spinbutton', { name: 'Red value' }),
  ).toHaveValue('0');
  await expect(
    picker.getByRole('spinbutton', { name: 'Green value' }),
  ).toHaveValue('255');
  await expect(
    picker.getByRole('spinbutton', { name: 'Blue value' }),
  ).toHaveValue('0');
  await picker.getByRole('spinbutton', { name: 'Hue value' }).fill('240');
  await picker
    .getByRole('spinbutton', { name: 'Saturation value' })
    .fill('100');
  await picker.getByRole('spinbutton', { name: 'Value value' }).fill('100');
  await expect(picker.getByRole('slider', { name: 'Hue' })).toHaveValue('240');
  await expect(picker.getByRole('textbox', { name: 'Hex color' })).toHaveValue(
    '#0000ff',
  );
  await picker.getByRole('slider', { name: 'Red' }).fill('255');
  await picker.getByRole('spinbutton', { name: 'Green value' }).fill('0');
  await picker.getByRole('spinbutton', { name: 'Blue value' }).fill('0');
  await expect(picker.getByRole('textbox', { name: 'Hex color' })).toHaveValue(
    '#ff0000',
  );
  await expect(
    picker.getByRole('spinbutton', { name: 'Hue value' }),
  ).toHaveValue('0');
  await picker.getByRole('textbox', { name: 'Hex color' }).fill('#f59f00');
  await expect(picker.getByRole('slider', { name: 'Hue' })).toHaveValue('39');
  await expect(
    picker.getByRole('spinbutton', { name: 'Red value' }),
  ).toHaveValue('245');
  await expect(
    picker.getByRole('spinbutton', { name: 'Green value' }),
  ).toHaveValue('159');
  await picker.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(picker).toHaveCount(0);
  const customSwatch = page.getByRole('button', {
    name: 'Use #f59f00 text color',
  });
  await expect(customSwatch).toHaveClass(/is-active/);
  await expect(palette.locator('.swatch')).toHaveCount(4);
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('C');
  await page.getByRole('button', { name: 'Use #e03131 text color' }).click();
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('R');
  await page.getByRole('button', { name: 'Selection tool' }).click();

  const rendered = page.getByRole('group', { name: 'ACR', exact: true });
  const customRun = rendered.locator('[data-mixed-text-native-color]');
  const redRun = rendered.locator('.mixed-text-color-marker + .ML__text');
  await expect(customRun).toHaveCount(1);
  await expect(redRun).toHaveCount(1);
  await expect
    .poll(() =>
      customRun.evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(245, 159, 0)');
  await expect
    .poll(() => redRun.evaluate((element) => getComputedStyle(element).color))
    .toBe('rgb(224, 49, 49)');

  await page.reload();
  await workspace.selectMixedTextTool(page);
  const persistedCustomSwatch = page.getByRole('button', {
    name: 'Use #f59f00 text color',
  });
  await expect(persistedCustomSwatch).toBeVisible();
  await persistedCustomSwatch.hover();
  await page.getByRole('button', { name: 'Remove #f59f00 color' }).click();
  await expect(persistedCustomSwatch).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .getByRole('group', { name: 'ACR', exact: true })
        .locator('[data-mixed-text-native-color]')
        .evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(245, 159, 0)');

  await page.reload();
  await workspace.selectMixedTextTool(page);
  await expect(
    page.getByRole('button', { name: 'Use #f59f00 text color' }),
  ).toHaveCount(0);
});

test('removing the active custom color resets future typing', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  await page.mouse.click(bounds.x + 500, bounds.y + 300);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('A');

  await page.getByRole('button', { name: 'Add color' }).click();
  const picker = page.getByRole('dialog', { name: 'Add custom color' });
  await picker.getByRole('textbox', { name: 'Hex color' }).fill('#f59f00');
  await picker.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('C');

  const customSwatch = page.getByRole('button', {
    name: 'Use #f59f00 text color',
  });
  await customSwatch.hover();
  await page.getByRole('button', { name: 'Remove #f59f00 color' }).click();
  await expect(customSwatch).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Use #1f2937 text color' }),
  ).toHaveClass(/is-active/);
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('B');
  await page.getByRole('button', { name: 'Selection tool' }).click();

  const rendered = page.getByRole('group', { name: 'ACB', exact: true });
  await expect
    .poll(() =>
      rendered
        .locator('.ML__text')
        .filter({ hasText: /^B$/ })
        .evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(31, 41, 55)');
});
