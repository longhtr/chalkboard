/**
 * Duplicating a cloud board from the library. The copy has to be genuinely
 * independent: its own board, its own assets, and content that survives the
 * source being trashed. A viewer must be able to take one too, because they
 * could already reach the same result through local storage in two steps.
 */
import { expect, test } from '@playwright/test';

import {
  acceptBoardInvitation,
  expectCloudReady,
  registerCloudAccount,
  uniqueEmail,
} from './helpers/cloudAccount';

/**
 * Returns the cloud list specifically. The dialog also holds the device
 * section, whose entries carry their own Rename and Duplicate.
 */
async function openCloudBoards(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Open boards' }).click();
  const dialog = page.getByRole('dialog', { name: 'Boards' });
  const cloud = dialog.getByRole('list', { name: 'On the cloud' });
  await expect(cloud).toBeVisible();
  return { cloud, dialog };
}

test('duplicates a cloud board into an independent copy', async ({
  browser,
}) => {
  const context = await browser.newContext();
  await registerCloudAccount(context.request, {
    displayName: 'Duplicate Owner',
    email: uniqueEmail('duplicate-owner'),
    password: 'duplicate owner password',
  });
  const page = await context.newPage();

  // Seeded locally and pushed up, which is the reliable way to get a cloud
  // board that actually holds an asset for the duplicate to carry.
  await page.addInitScript(() => {
    localStorage.setItem('chalkboard:local-title', 'Duplication source');
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          height: 80,
          id: 'duplicated-image',
          name: 'duplicated.png',
          opacity: 1,
          rotation: 0,
          source:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          strokeColor: 'transparent',
          strokeWidth: 0,
          type: 'image',
          width: 80,
          x: 120,
          y: -40,
        },
      ]),
    );
  });
  await page.goto('/');
  await expect(page.getByRole('img', { name: 'duplicated.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Copy to cloud' }).click();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/u);
  await expectCloudReady(page);

  const opened = await openCloudBoards(page);
  await opened.cloud.getByRole('button', { name: 'Duplicate' }).click();
  await expect(
    opened.dialog.getByText('Duplicated Duplication source.'),
  ).toBeVisible();

  const copy = opened.cloud.getByRole('button', {
    name: 'Open cloud board Duplication source copy',
  });
  await expect(copy).toBeVisible();
  await copy.click();
  await expectCloudReady(page);
  // The copy carries its own asset rather than a pointer into the original.
  await expect(page.getByRole('img', { name: 'duplicated.png' })).toBeVisible();

  await context.close();
});

test('lets a viewer duplicate a board it may not edit', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  await registerCloudAccount(ownerContext.request, {
    displayName: 'Share Owner',
    email: uniqueEmail('duplicate-share-owner'),
    password: 'share owner password',
  });
  const created = await ownerContext.request.post('/api/boards', {
    data: { title: 'Shared for duplication' },
  });
  expect(created.ok()).toBe(true);
  const board = requiredBoardId(await created.json());

  const viewerContext = await browser.newContext();
  const viewerEmail = uniqueEmail('duplicate-viewer');
  await registerCloudAccount(viewerContext.request, {
    displayName: 'Duplicate Viewer',
    email: viewerEmail,
    password: 'viewer password',
  });
  const shared = await ownerContext.request.post(
    `/api/boards/${board}/members`,
    { data: { email: viewerEmail, role: 'viewer' } },
  );
  expect(shared.status()).toBe(201);
  await acceptBoardInvitation(viewerContext.request, board);

  const viewerPage = await viewerContext.newPage();
  await viewerPage.goto('/');
  const library = await openCloudBoards(viewerPage);
  // Renaming belongs to the owner; taking a copy does not.
  await expect(
    library.cloud.getByRole('button', { name: 'Rename' }),
  ).toHaveCount(0);
  await library.cloud.getByRole('button', { name: 'Duplicate' }).click();
  await expect(
    library.dialog.getByText('Duplicated Shared for duplication.'),
  ).toBeVisible();

  const copy = library.cloud.getByRole('button', {
    name: 'Open cloud board Shared for duplication copy',
  });
  await expect(copy).toBeVisible();
  await copy.click();
  // The copy is the viewer's own, so it is editable where the original was not.
  await expect(viewerPage.getByText('View only')).toHaveCount(0);

  await ownerContext.close();
  await viewerContext.close();
});

function requiredBoardId(value: unknown): string {
  const board = (value as { board?: { id?: unknown } }).board;
  if (typeof board?.id !== 'string') throw new Error('Expected a board id');
  return board.id;
}
