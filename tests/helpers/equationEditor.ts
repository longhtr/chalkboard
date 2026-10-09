/** High-level visible actions and assertions for opening, editing, and reading one equation. */
import { expect, type Locator, type Page } from '@playwright/test';

export async function canvasBounds(page: Page) {
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  return { bounds, canvas };
}

export async function createEmptyMathRegion(
  page: Page,
  x: number,
  y: number,
  options: { touch?: boolean } = {},
) {
  if (options.touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);

  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();
  await expect(page.locator('.inline-math-editor')).toHaveClass(/is-ready/);
  if ((await page.locator('.mixed-text-tool-mode').textContent()) === 'T') {
    await page.keyboard.press('Control+m');
  }
}

export async function finishEditing(page: Page) {
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(page.locator('math-field')).toHaveCount(0);
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
}

export async function activeMathLatex(mathField: Locator, index = 0) {
  return mathField.evaluate((field, mathIndex) => {
    const matches = [...field.value.matchAll(/\${1,2}([\s\S]*?)\${1,2}/g)];
    if (matches.length === 0 && field.mode === 'math' && mathIndex === 0) {
      return field.value.trim().replaceAll('\\placeholder{}', '');
    }
    return (matches[mathIndex]?.[1] ?? '')
      .trim()
      .replace(/^\\displaystyle\s*/, '')
      .replaceAll('\\placeholder{}', '');
  }, index);
}
