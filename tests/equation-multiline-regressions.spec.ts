/** Small retained browser regressions for previously failing multiline insertion, deletion, and navigation paths. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import { canvasBounds, finishEditing } from './helpers/equationEditor';

test('edits the clicked line of a multiline mixed block', async ({ page }) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);

  await page.mouse.click(bounds.x + 420, bounds.y + 220);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('First line');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second line');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Third line');
  await finishEditing(page);

  const initialSource = 'First line\nSecond line\nThird line';
  const rendered = page.getByRole('group', { name: initialSource });
  const secondLine = rendered
    .locator('.ML__text')
    .filter({ hasText: /^Second line$/ });
  const secondLineBounds = await secondLine.boundingBox();
  assertValue(secondLineBounds, 'second line bounds');
  await page.mouse.click(
    secondLineBounds.x + secondLineBounds.width - 1,
    secondLineBounds.y + secondLineBounds.height / 2,
  );
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.mouse.click(
    secondLineBounds.x + secondLineBounds.width - 1,
    secondLineBounds.y + secondLineBounds.height / 2,
  );
  await page.keyboard.type('!');
  await finishEditing(page);

  const afterSecond = page.getByRole('group', {
    name: 'First line\nSecond line!\nThird line',
  });
  await expect(afterSecond).toBeVisible();

  const firstLine = afterSecond
    .locator('.ML__text')
    .filter({ hasText: /^First line$/ });
  const firstLineBounds = await firstLine.boundingBox();
  assertValue(firstLineBounds, 'first line bounds');
  await page.mouse.click(
    firstLineBounds.x + firstLineBounds.width - 1,
    firstLineBounds.y + firstLineBounds.height / 2,
  );
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.mouse.click(
    firstLineBounds.x + firstLineBounds.width - 1,
    firstLineBounds.y + firstLineBounds.height / 2,
  );
  await page.keyboard.type('?');
  await finishEditing(page);

  await expect(
    page.getByRole('group', {
      name: 'First line?\nSecond line!\nThird line',
    }),
  ).toBeVisible();
});
