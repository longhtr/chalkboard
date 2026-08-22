/** Exports and imports one editable board across browser engines to prove format and asset portability. */
import { readFile } from 'node:fs/promises';

import { expect, firefox, test } from '@playwright/test';

import { parseBoardArchive } from '../apps/web/src/editor/portability/boardArchive';

const seedPortableBoard = async (page: import('@playwright/test').Page) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 30,
          height: 44,
          id: 'cross-browser-equation',
          lineSpacing: 1.2,
          opacity: 1,
          rotation: 0,
          source: String.raw`Cross browser $\frac{x}{y}$`,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 240,
          x: -120,
          y: -22,
        },
      ]),
    );
    localStorage.setItem('chalkboard:local-title', 'Cross-browser board');
  });
};

const exportEditable = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Open board menu' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export board' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (path === null) throw new Error('Editable archive download has no path');
  return path;
};

const importEditable = async (
  page: import('@playwright/test').Page,
  path: string,
) => {
  await page.getByRole('button', { name: 'Open board menu' }).click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import board' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(path);
  await expect(page.getByRole('textbox', { name: 'Board title' })).toHaveValue(
    'Cross-browser board',
  );
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
};

test('round-trips an editable board from Chromium through Firefox and back', async ({
  baseURL,
  page,
}) => {
  if (baseURL === undefined) throw new Error('Web base URL is required');
  await seedPortableBoard(page);
  await page.goto('/local');
  await expect(
    page.locator('[data-mixed-text-id="cross-browser-equation"]'),
  ).toBeVisible();
  const chromiumArchive = await exportEditable(page);

  const firefoxBrowser = await firefox.launch({ headless: true });
  const firefoxContext = await firefoxBrowser.newContext({ baseURL });
  try {
    const firefoxPage = await firefoxContext.newPage();
    await firefoxPage.goto('/local');
    await importEditable(firefoxPage, chromiumArchive);
    const firefoxArchive = await exportEditable(firefoxPage);
    const parsed = await parseBoardArchive(
      new Uint8Array(await readFile(firefoxArchive)),
    );
    expect(parsed).toMatchObject({
      font: 'excalifont',
      title: 'Cross-browser board',
    });
    expect(parsed.elements).toEqual([
      expect.objectContaining({
        source: String.raw`Cross browser $\frac{x}{y}$`,
        type: 'equation',
      }),
    ]);

    const beforeImport = page.url();
    await importEditable(page, firefoxArchive);
    await expect(page).not.toHaveURL(beforeImport);
    await expect(page.locator('[data-mixed-text-id]')).toHaveCount(1);
  } finally {
    await firefoxContext.close();
    await firefoxBrowser.close();
  }
});
