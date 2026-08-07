/** Image import, progress, placement, resize, copy, persistence, missing data, and failure presentation. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import * as workspace from './helpers/workspace';

test('imports, sanitizes, selects, resizes, persists, and reloads SVG and raster images', async ({
  page,
}) => {
  await page.goto('/');
  const importButton = page
    .getByRole('toolbar', { name: 'Drawing tools' })
    .getByRole('button', { name: 'Import image / SVG' });
  await expect(importButton).toBeVisible();
  await importButton.click();
  const fileInput = page.getByLabel('Choose image or SVG file');
  await fileInput.setInputFiles({
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" onload="alert(1)"><script>alert(1)</script><rect width="200" height="100" fill="#1971c2"/></svg>',
    ),
    mimeType: 'image/svg+xml',
    name: 'diagram.svg',
  });

  const image = page.getByRole('img', { name: 'diagram.svg' });
  await expect(image).toBeVisible();
  await expect(page.locator('.operation-status')).toHaveCount(0);
  const decodedSvg = await image.evaluate((node) => {
    const encoded = (node as HTMLImageElement).src.split(',')[1] ?? '';
    return atob(encoded);
  });
  expect(decodedSvg).not.toContain('<script');
  expect(decodedSvg).not.toContain('onload=');
  await expect(
    page.getByRole('button', { name: 'Delete selection' }),
  ).toBeEnabled();

  const before = await image.boundingBox();
  assertValue(before, 'before');
  expect(before.width / before.height).toBeCloseTo(2, 1);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  await page.mouse.move(
    before.x + before.width / 2,
    before.y + before.height / 2,
  );
  await expect
    .poll(() => canvas.evaluate((node) => getComputedStyle(node).cursor))
    .toBe('move');

  await page.mouse.move(
    before.x + before.width + 4,
    before.y + before.height + 4,
  );
  await page.mouse.down();
  await page.mouse.move(
    before.x + before.width + 104,
    before.y + before.height + 54,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => {
      const bounds = await image.boundingBox();
      return bounds === null ? 0 : bounds.width;
    })
    .toBeGreaterThan(before.width + 90);
  const resized = await image.boundingBox();
  assertValue(resized, 'resized element bounds');
  if (resized !== null) {
    expect(resized.width / resized.height).toBeCloseTo(2, 1);
  }

  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { type?: string }[];
        return elements[0]?.type;
      }),
    )
    .toBe('image');
  await page.reload();
  await expect(page.getByRole('img', { name: 'diagram.svg' })).toBeVisible();

  await importButton.click();
  await page.getByLabel('Choose image or SVG file').setInputFiles({
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
    mimeType: 'image/png',
    name: 'pixel.png',
  });
  await expect(page.getByRole('img', { name: 'pixel.png' })).toBeVisible();
  await expect(page.locator('.board-image-element')).toHaveCount(2);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.locator('.board-image-element')).toHaveCount(3);
  await expect(page.getByRole('img', { name: 'pixel.png' })).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(page.locator('.board-image-element')).toHaveCount(2);
});

test('recovers image boards from IndexedDB when the localStorage cache exceeds quota', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (
        key.startsWith('chalkboard:local-document') &&
        value.includes('"type":"image"')
      ) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    };
  });
  await page.goto('/');
  const synchronizedPage = await page.context().newPage();
  await synchronizedPage.goto('/');
  await page.getByRole('button', { name: 'Import image / SVG' }).click();
  await page.getByLabel('Choose image or SVG file').setInputFiles({
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
    mimeType: 'image/png',
    name: 'indexed-pixel.png',
  });
  await expect(
    page.getByRole('img', { name: 'indexed-pixel.png' }),
  ).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<{
            boardHasImageReference: boolean;
            imageCount: number;
            localCache: string | null;
            schemaVersion: number;
          }>((resolve, reject) => {
            const request = indexedDB.open('chalkboard-local');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const database = request.result;
              const transaction = database.transaction(
                ['boards', 'images'],
                'readonly',
              );
              const boardId = window.location.pathname.split('/').at(-1) ?? '';
              const boardRequest = transaction
                .objectStore('boards')
                .get(`local:${boardId}`);
              const imagesRequest = transaction.objectStore('images').getAll();
              transaction.onerror = () => reject(transaction.error);
              transaction.oncomplete = () => {
                const board = boardRequest.result as
                  | {
                      elements?: { imageId?: string; source?: string }[];
                      schemaVersion?: number;
                    }
                  | undefined;
                resolve({
                  boardHasImageReference:
                    typeof board?.elements?.[0]?.imageId === 'string' &&
                    board.elements[0]?.source === undefined,
                  imageCount: imagesRequest.result.length,
                  localCache: localStorage.getItem(
                    `chalkboard:local-document:${boardId}`,
                  ),
                  schemaVersion: board?.schemaVersion ?? 0,
                });
                database.close();
              };
            };
          }),
      ),
    )
    .toEqual({
      boardHasImageReference: true,
      imageCount: 1,
      localCache: null,
      schemaVersion: 2,
    });
  await expect(
    synchronizedPage.getByRole('img', { name: 'indexed-pixel.png' }),
  ).toBeVisible();
  await synchronizedPage.close();

  await page.reload();
  await expect(
    page.getByRole('img', { name: 'indexed-pixel.png' }),
  ).toBeVisible();
});

test('synchronizes board changes between browser tabs', async ({ page }) => {
  await page.goto('/');
  const secondPage = await page.context().newPage();
  await secondPage.goto('/');

  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.click(bounds.x + 400, bounds.y + 260);
  await page.keyboard.type('First tab');
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(
    secondPage.getByRole('group', { name: 'First tab', exact: true }),
  ).toBeVisible();

  await workspace.selectMixedTextTool(secondPage);
  const secondCanvas = secondPage.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const secondBounds = await secondCanvas.boundingBox();
  assertValue(secondBounds, 'second element bounds');
  await secondPage.mouse.click(secondBounds.x + 650, secondBounds.y + 400);
  await secondPage.keyboard.type('Second tab');
  await secondPage.getByRole('button', { name: 'Selection tool' }).click();
  await expect(
    page.getByRole('group', { name: 'Second tab', exact: true }),
  ).toBeVisible();
  await secondPage.close();
});

test('isolates concurrent edits made to different boards in two tabs', async ({
  page,
}) => {
  await page.goto('/local');
  await expect(
    page.getByRole('application', { name: 'Chalkboard drawing canvas' }),
  ).toBeVisible();
  const firstBoardUrl = page.url();
  await page
    .getByRole('textbox', { name: 'Board title' })
    .fill('First tab board');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const boardId = window.location.pathname.split('/').at(-1) ?? '';
        return localStorage.getItem(`chalkboard:local-title:${boardId}`);
      }),
    )
    .toBe('First tab board');

  const secondBoardPage = await workspace.openNewBoardTab(page);
  await expect(page).toHaveURL(firstBoardUrl);
  const secondBoardUrl = secondBoardPage.url();
  await secondBoardPage
    .getByRole('textbox', { name: 'Board title' })
    .fill('Second tab board');
  await expect
    .poll(() =>
      secondBoardPage.evaluate(() => {
        const boardId = window.location.pathname.split('/').at(-1) ?? '';
        return localStorage.getItem(`chalkboard:local-title:${boardId}`);
      }),
    )
    .toBe('Second tab board');

  const firstBoardPage = page;

  const addText = async (target: Page, text: string, offset: number) => {
    await workspace.selectMixedTextTool(target);
    const canvas = target.getByRole('application', {
      name: 'Chalkboard drawing canvas',
    });
    const bounds = await canvas.boundingBox();
    assertValue(bounds, 'element bounds');
    await target.mouse.click(
      bounds.x + bounds.width / 2 + offset,
      bounds.y + bounds.height / 2,
    );
    await target.locator('.inline-math-editor.is-ready').waitFor();
    await target.keyboard.type(text);
    await target.getByRole('button', { name: 'Selection tool' }).click();
  };

  await addText(secondBoardPage, 'Second board only', 120);
  await addText(firstBoardPage, 'First board only', -120);
  await expect(
    secondBoardPage.getByRole('group', { name: 'Second board only' }),
  ).toBeVisible();
  await expect(secondBoardPage.getByText('First board only')).toHaveCount(0);
  await expect(
    firstBoardPage.getByRole('group', { name: 'First board only' }),
  ).toBeVisible();
  await expect(firstBoardPage.getByText('Second board only')).toHaveCount(0);

  await Promise.all([secondBoardPage.reload(), firstBoardPage.reload()]);
  await expect(secondBoardPage).toHaveURL(secondBoardUrl);
  await expect(
    secondBoardPage.getByRole('group', { name: 'Second board only' }),
  ).toBeVisible();
  await expect(
    firstBoardPage.getByRole('group', { name: 'First board only' }),
  ).toBeVisible();
  await secondBoardPage.close();
});

test('selection mode box-selects while drag-canvas mode pans', async ({
  page,
}) => {
  await workspace.seedRectangles(page);
  await page.goto('/');
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');

  await page.getByRole('button', { name: 'Drag canvas tool' }).click();
  await page.mouse.move(bounds.x + 700, bounds.y + 500);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 800, bounds.y + 550, { steps: 5 });
  await page.mouse.up();
  await expect(
    page.getByRole('button', { name: 'Drag canvas tool' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Selection tool' }).click();
  await page.mouse.move(bounds.x + 100, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width - 100,
    bounds.y + bounds.height - 100,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(
    page.getByRole('button', { name: 'Delete selection' }),
  ).toBeEnabled();
});
