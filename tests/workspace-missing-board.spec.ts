/**
 * A URL naming a board that no longer exists explains itself.
 *
 * Startup replaced such a URL with whichever board could be opened and said
 * nothing, so the reader was left looking at different work than the link asked
 * for, with no way to tell that had happened.
 */
import { expect, test } from '@playwright/test';

const MISSING = '11111111-2222-4333-8444-555555555555';

test('explains a local board URL that no longer exists', async ({ page }) => {
  await page.goto(`/local/${MISSING}`);
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();

  const notice = page.getByText(/That board is unavailable\./u);
  await expect(notice).toBeVisible();

  // Same one notice shape as every other status, in the same corner.
  await expect(page.locator('.status-stack .operation-status')).toHaveCount(1);

  await page
    .locator('.operation-status')
    .getByRole('button', { name: 'Dismiss' })
    .click();
  await expect(notice).toHaveCount(0);
});

test('says nothing when the opened local board exists', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await page.waitForURL(/\/local\/[0-9a-f-]{36}$/iu);
  const current = page.url();

  await page.goto(current);
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await expect(page.getByText(/That board is unavailable\./u)).toHaveCount(0);
});

test('reopens the board the account last had open', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await page.waitForURL(/\/local\/[0-9a-f-]{36}$/iu);
  const opened = page.url();
  const boardId = opened.split('/').at(-1) ?? '';
  expect(boardId).not.toBe('');

  // Record it the way the application does once an account has it open.
  await page.evaluate((id) => {
    localStorage.setItem(
      'chalkboard:last-cloud-board',
      JSON.stringify({
        boards: { 'account-1': [{ id, kind: 'local' }] },
        lastAccountId: 'account-1',
      }),
    );
    // Point the plain last-board hint elsewhere so only the account memory can
    // produce this board.
    localStorage.setItem(
      'chalkboard:last-local-board',
      '99999999-8888-4777-8666-555555555555',
    );
  }, boardId);

  // A URL naming no board reopens the remembered one.
  await page.goto('/');
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await expect.poll(() => page.url()).toBe(opened);
});
