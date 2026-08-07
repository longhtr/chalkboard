/** Creates, opens, and identifies local boards through the visible board-library interface. */
import { expect, type Page } from '@playwright/test';

export async function openNewBoardTab(page: Page): Promise<Page> {
  await page.getByRole('button', { name: 'Open board menu' }).click();
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'New board' }).click();
  const newBoardPage = await popup;
  await newBoardPage.waitForURL(/\/local\/[0-9a-f-]{36}$/iu);
  await expect(
    newBoardPage.getByRole('application', {
      name: 'Chalkboard drawing canvas',
    }),
  ).toBeVisible();
  return newBoardPage;
}
