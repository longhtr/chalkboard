/**
 * The editing view can be chosen before a block exists.
 *
 * The control only appeared while a block was open, so the view a new block
 * opened in could not be picked without first making one in the other view.
 */
import { expect, test } from '@playwright/test';
import * as workspace from './helpers/workspace';
import { assertValue } from './helpers/assertions';

test('choose editing view before making a block', async ({ page }) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const group = page.getByRole('group', { name: 'Editing view' });
  await expect(group).toBeVisible();
  await group.getByRole('button', { name: 'Use source editing view' }).click();

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'canvas');
  await page.mouse.click(bounds.x + 360, bounds.y + 240);
  await expect(
    page.getByRole('textbox', { name: 'Block source' }),
  ).toBeVisible();

  // And back again with nothing open.
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await workspace.selectMixedTextTool(page);
  await group
    .getByRole('button', { name: 'Use rendered editing view' })
    .click();
  await page.mouse.click(bounds.x + 620, bounds.y + 400);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await expect(page.locator('math-field')).toBeVisible();
});
