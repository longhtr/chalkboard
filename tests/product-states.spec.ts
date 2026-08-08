/** Visible empty, loading, offline, read-only, incompatible, storage-failure, and recovery states. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';

test('ignores a remembered cloud board when no account session exists', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chalkboard:last-cloud-board',
      JSON.stringify({
        id: 'deleted-cloud-board',
        role: 'owner',
        title: 'Deleted cloud board',
      }),
    );
  });

  await page.goto('/');

  await expect(page).toHaveURL(/\/local\/[0-9a-f-]+$/u);
  await expect(page.getByRole('button', { name: 'Share' })).toHaveCount(0);
  await expect(page.getByText(/Sign in to open this cloud board/u)).toHaveCount(
    0,
  );
});

test('keeps local editing available when localStorage is blocked', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked by browser policy', 'SecurityError');
      },
    });
  });
  await page.goto('/local');

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  await expect(canvas).toBeVisible();
  await expect(page.getByText('Local storage needs attention')).toHaveCount(0);

  await page.getByRole('button', { name: 'Shape tool' }).click();
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.move(bounds.x + 360, bounds.y + 220);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 470, bounds.y + 300);
  await page.mouse.up();

  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
});

test('presents an unobstructed empty canvas for the first action', async ({
  page,
}) => {
  await page.goto('/local');
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  await expect(page.locator('#workspace-empty-state')).toHaveCount(0);

  await page.getByRole('button', { name: 'Shape tool' }).click();
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.move(bounds.x + 420, bounds.y + 220);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 520, bounds.y + 300);
  await page.mouse.up();

  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
});

test('announces an empty reference search with recovery guidance', async ({
  page,
}) => {
  await page.goto('/local');
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Math / LaTeX cheatsheet' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'MathLive / LaTeX cheatsheet',
  });
  await dialog
    .getByRole('searchbox', { name: 'Search MathLive / LaTeX cheatsheet' })
    .fill('definitely-no-such-command');
  await expect(dialog.getByRole('status')).toHaveText(
    'No matching commands. Try a broader term.',
  );
});

test('keeps primary controls separated and reachable on a narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/local');
  const menu = page.getByRole('button', { name: 'Open board menu' });
  const account = page.getByRole('button', { name: 'Open account' });
  const toolbar = page.getByRole('toolbar', { name: 'Drawing tools' });
  const [menuBounds, accountBounds, toolbarBounds] = await Promise.all([
    menu.boundingBox(),
    account.boundingBox(),
    toolbar.boundingBox(),
  ]);
  assertValue(menuBounds, 'board menu bounds');
  assertValue(accountBounds, 'account control bounds');
  assertValue(toolbarBounds, 'toolbar bounds');
  await expect(page.getByRole('button', { name: 'Share' })).toHaveCount(0);
  expect(menuBounds.x + menuBounds.width).toBeLessThan(accountBounds.x);
  expect(toolbarBounds.y).toBeGreaterThan(700);
  expect(toolbarBounds.x).toBeGreaterThanOrEqual(0);
  expect(toolbarBounds.x + toolbarBounds.width).toBeLessThanOrEqual(390);

  await menu.click();
  await expect(
    page.getByRole('button', { name: 'Export image' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Export image' }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export image' });
  await expect(exportDialog).toBeVisible();
  const dialogBounds = await exportDialog.boundingBox();
  assertValue(dialogBounds, 'dialog bounds');
  if (dialogBounds !== null) {
    expect(dialogBounds.x).toBeGreaterThanOrEqual(0);
    expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(390);
  }
});
