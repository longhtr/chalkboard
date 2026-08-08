/** Uses a real browser-process restart to prove local boards, images, titles, and recovery remain durable. */
import { rm } from 'node:fs/promises';

import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { assertValue } from './helpers/assertions';
import { crashChromiumBrowser } from './helpers/browserProcess';
import { openNewBoardTab } from './helpers/localBoards';
import { temporaryDirectory } from './helpers/temporaryDirectory';

const readStoredLocalBoardState = (page: Page, boardUrl: string) =>
  page.evaluate(
    (url) =>
      new Promise<{ count: number; elements: string; pending: boolean }>(
        (resolve, reject) => {
          const boardId = new URL(url).pathname.split('/').at(-1) ?? '';
          const request = indexedDB.open('chalkboard-local');
          request.addEventListener('error', () => reject(request.error));
          request.addEventListener('success', () => {
            const database = request.result;
            const record = database
              .transaction('boards', 'readonly')
              .objectStore('boards')
              .get(`local:${boardId}`);
            record.addEventListener('error', () => reject(record.error));
            record.addEventListener('success', () => {
              database.close();
              const elements = Array.isArray(record.result?.elements)
                ? record.result.elements
                : [];
              resolve({
                count: elements.length,
                elements: JSON.stringify(elements),
                pending:
                  localStorage.getItem(
                    `chalkboard:pending-local-document:${boardId}`,
                  ) !== null,
              });
            });
          });
        },
      ),
    boardUrl,
  );

test('restores multiple local boards and image blobs after a browser-process restart', async ({
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error('Web base URL is required');
  const profileDirectory = await temporaryDirectory('local-restart-');
  let context: BrowserContext | null = null;

  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      baseURL,
      headless: true,
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('/local');
    await expect(
      page.getByRole('application', { name: 'Chalkboard drawing canvas' }),
    ).toBeVisible();
    const imageBoardUrl = page.url();
    await page
      .getByRole('textbox', { name: 'Board title' })
      .fill('Restart image board');
    await page.getByRole('button', { name: 'Import image / SVG' }).click();
    await page.getByLabel('Choose image or SVG file').setInputFiles({
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
      mimeType: 'image/png',
      name: 'restart-pixel.png',
    });
    await expect(
      page.getByRole('img', { name: 'restart-pixel.png' }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<number>((resolve, reject) => {
              const request = indexedDB.open('chalkboard-local');
              request.addEventListener('error', () => reject(request.error));
              request.addEventListener('success', () => {
                const database = request.result;
                const transaction = database.transaction('images', 'readonly');
                const images = transaction.objectStore('images').getAll();
                transaction.addEventListener('error', () =>
                  reject(transaction.error),
                );
                transaction.addEventListener('complete', () => {
                  database.close();
                  resolve(images.result.length);
                });
              });
            }),
        ),
      )
      .toBe(1);

    const shapePage = await openNewBoardTab(page);
    await expect(page).toHaveURL(imageBoardUrl);
    const shapeBoardUrl = shapePage.url();
    await shapePage
      .getByRole('textbox', { name: 'Board title' })
      .fill('Restart shape board');
    const canvas = shapePage.getByRole('application', {
      name: 'Chalkboard drawing canvas',
    });
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error('Local canvas is not measurable');
    await shapePage.getByRole('button', { name: 'Shape tool' }).click();
    await shapePage.mouse.move(bounds.x + 360, bounds.y + 260);
    await shapePage.mouse.down();
    await shapePage.mouse.move(bounds.x + 470, bounds.y + 340);
    await shapePage.mouse.up();
    await expect(shapePage.getByText('Canvas contains 1 object')).toBeVisible();
    await expect
      .poll(() =>
        shapePage.evaluate(() => {
          const boardId = window.location.pathname.split('/').at(-1) ?? '';
          const elements = JSON.parse(
            localStorage.getItem(`chalkboard:local-document:${boardId}`) ??
              '[]',
          ) as unknown[];
          return elements.length;
        }),
      )
      .toBe(1);

    await context.close();
    context = null;

    context = await chromium.launchPersistentContext(profileDirectory, {
      baseURL,
      headless: true,
    });
    const recoveredPage = context.pages()[0] ?? (await context.newPage());
    await recoveredPage.goto(shapeBoardUrl);
    await expect(
      recoveredPage.getByRole('textbox', { name: 'Board title' }),
    ).toHaveValue('Restart shape board');
    await expect(
      recoveredPage.getByText('Canvas contains 1 object'),
    ).toBeVisible();

    await recoveredPage
      .getByRole('button', { name: 'Open board menu' })
      .click();
    await recoveredPage.getByRole('button', { name: 'Open boards' }).click();
    const library = recoveredPage.getByRole('dialog', { name: 'Boards' });
    await expect(
      library.getByRole('button', { name: 'Open Restart image board' }),
    ).toBeVisible();
    await expect(
      library.getByRole('button', { name: 'Open Restart shape board' }),
    ).toBeVisible();
    await library
      .getByRole('button', { name: 'Open Restart image board' })
      .click();
    await expect(recoveredPage).toHaveURL(imageBoardUrl);
    await expect(
      recoveredPage.getByRole('img', { name: 'restart-pixel.png' }),
    ).toBeVisible();
    await expect(
      recoveredPage.getByText('Canvas contains 1 object'),
    ).toBeVisible();

    await recoveredPage
      .getByRole('button', { name: 'Open board menu' })
      .click();
    await recoveredPage.getByRole('button', { name: 'Open boards' }).click();
    const originalEntry = recoveredPage
      .getByRole('button', { name: 'Open Restart image board' })
      .locator('..');
    await originalEntry.getByRole('button', { name: 'Duplicate' }).click();
    await expect(recoveredPage).not.toHaveURL(imageBoardUrl);
    const duplicateBoardUrl = recoveredPage.url();
    await expect(
      recoveredPage.getByRole('textbox', { name: 'Board title' }),
    ).toHaveValue('Restart image board copy');
    await expect(
      recoveredPage.getByRole('img', { name: 'restart-pixel.png' }),
    ).toBeVisible();

    await recoveredPage
      .getByRole('button', { name: 'Open board menu' })
      .click();
    await recoveredPage.getByRole('button', { name: 'Open boards' }).click();
    const reopenedLibrary = recoveredPage.getByRole('dialog', {
      name: 'Boards',
    });
    const sourceEntry = reopenedLibrary
      .getByRole('button', {
        name: 'Open Restart image board',
        exact: true,
      })
      .locator('..');
    await sourceEntry.getByRole('button', { name: 'Trash' }).click();
    await reopenedLibrary
      .getByRole('button', { name: 'Device trash (1)' })
      .click();
    const trash = reopenedLibrary.getByRole('list', { name: 'Device trash' });
    await trash.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(trash).toHaveCount(0);
    await recoveredPage.getByRole('button', { name: 'Close boards' }).click();

    await recoveredPage.reload();
    await expect(recoveredPage).toHaveURL(duplicateBoardUrl);
    await expect(
      recoveredPage.getByRole('img', { name: 'restart-pixel.png' }),
    ).toBeVisible();
    await expect
      .poll(() =>
        recoveredPage.evaluate(
          () =>
            new Promise<number>((resolve, reject) => {
              const request = indexedDB.open('chalkboard-local');
              request.addEventListener('error', () => reject(request.error));
              request.addEventListener('success', () => {
                const database = request.result;
                const transaction = database.transaction('images', 'readonly');
                const images = transaction.objectStore('images').getAll();
                transaction.addEventListener('error', () =>
                  reject(transaction.error),
                );
                transaction.addEventListener('complete', () => {
                  database.close();
                  resolve(images.result.length);
                });
              });
            }),
        ),
      )
      .toBe(1);
  } finally {
    await context?.close();
    await rm(profileDirectory, { force: true, recursive: true });
  }
});

async function exerciseFailedReplacementRestart(
  baseURL: string,
  testInfo: TestInfo,
  { abrupt }: { abrupt: boolean },
): Promise<void> {
  const profileDirectory = await temporaryDirectory('pending-restart-');
  let context: BrowserContext | null = null;

  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      baseURL,
      headless: true,
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.addInitScript(() => {
      const nativePut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        value: unknown,
        key?: IDBValidKey,
      ) {
        const failWrites = (
          window as typeof window & { __failLocalBoardWrites?: boolean }
        ).__failLocalBoardWrites;
        if (
          failWrites === true &&
          this.name === 'boards' &&
          typeof (value as { id?: unknown }).id === 'string' &&
          ((value as { id: string }).id.startsWith('local:') ||
            (value as { id: string }).id === 'local')
        ) {
          throw new DOMException(
            'Storage quota exceeded',
            'QuotaExceededError',
          );
        }
        return key === undefined
          ? nativePut.call(this, value)
          : nativePut.call(this, value, key);
      };
    });
    await page.goto('/local');
    await expect(page).toHaveURL(/\/local\/[0-9a-f-]{36}$/iu);
    const boardUrl = page.url();
    const canvas = page.getByRole('application', {
      name: 'Chalkboard drawing canvas',
    });
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error('Local canvas is not measurable');
    await page.getByRole('button', { name: 'Shape tool' }).click();
    const drawShape = async (offset: number) => {
      const startX = bounds.x + bounds.width / 2 - 180 + offset;
      const startY = bounds.y + bounds.height / 2 - 80 + offset / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 80, startY + 60);
      await page.mouse.up();
    };
    const durableState = () => readStoredLocalBoardState(page, boardUrl);
    const durableCount = async () => (await durableState()).count;

    await drawShape(0);
    await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
    await expect.poll(durableCount).toBe(1);
    const previousComplete = (await durableState()).elements;
    await page.evaluate(() => {
      (
        window as typeof window & { __failLocalBoardWrites?: boolean }
      ).__failLocalBoardWrites = true;
    });
    await drawShape(140);
    await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const boardId = location.pathname.split('/').at(-1) ?? '';
          const pending = localStorage.getItem(
            `chalkboard:pending-local-document:${boardId}`,
          );
          if (pending === null) return 0;
          const parsed: unknown = JSON.parse(pending);
          if (!Array.isArray(parsed)) {
            throw new Error('Pending local document is not an element array');
          }
          return parsed.length;
        }),
      )
      .toBe(2);
    await expect(page.getByText('Browser storage is full')).toBeVisible();
    await expect.poll(durableCount).toBe(1);
    const pendingComplete = await page.evaluate(() => {
      const boardId = location.pathname.split('/').at(-1) ?? '';
      return localStorage.getItem(
        `chalkboard:pending-local-document:${boardId}`,
      );
    });
    assertValue(pendingComplete, 'pending complete board record');
    expect(pendingComplete).not.toBe(previousComplete);

    if (abrupt) await crashChromiumBrowser(context, page);
    else await context.close();
    context = null;
    context = await chromium.launchPersistentContext(profileDirectory, {
      baseURL,
      headless: true,
    });
    const recoveredPage = context.pages()[0] ?? (await context.newPage());
    await recoveredPage.goto(boardUrl);
    const recoveredState = () =>
      readStoredLocalBoardState(recoveredPage, boardUrl);
    await expect
      .poll(async () => {
        const recovered = await recoveredState();
        return !recovered.pending &&
          (recovered.count === 1 || recovered.count === 2)
          ? recovered.count
          : 0;
      })
      .not.toBe(0);
    const recovered = await recoveredState();
    if (abrupt) {
      expect([previousComplete, pendingComplete]).toContain(recovered.elements);
    } else {
      expect(recovered.elements).toBe(pendingComplete);
    }
    await expect(
      recoveredPage.getByText(
        `Canvas contains ${recovered.count} object${recovered.count === 1 ? '' : 's'}`,
      ),
    ).toBeVisible();
    await expect(
      recoveredPage.getByText('Browser storage is full'),
    ).toHaveCount(0);
    await recoveredPage.screenshot({
      path: testInfo.outputPath('browser-kill-recovered-state.png'),
    });
  } finally {
    await context?.close();
    await rm(profileDirectory, { force: true, recursive: true });
  }
}

test('recovers a failed replacement after a browser-process restart', async ({
  baseURL,
}, testInfo) => {
  if (baseURL === undefined) throw new Error('Web base URL is required');
  await exerciseFailedReplacementRestart(baseURL, testInfo, { abrupt: false });
});

test('restores a complete durable boundary after an abrupt browser-process kill', async ({
  baseURL,
}, testInfo) => {
  if (baseURL === undefined) throw new Error('Web base URL is required');
  await exerciseFailedReplacementRestart(baseURL, testInfo, { abrupt: true });
});
