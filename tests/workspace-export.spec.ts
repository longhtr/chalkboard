/** PNG, portable SVG, and editable archive export content, bounds, fonts, assets, progress, and cancellation. */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import { parseBoardArchive } from '../apps/web/src/editor/portability/boardArchive';

test('exports a validated deterministic editable board archive', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 30,
          height: 50,
          id: 'editable-export-equation',
          lineSpacing: 1.2,
          opacity: 1,
          rotation: 0,
          source: String.raw`Editable $x^2+1$`,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 220,
          x: -110,
          y: -25,
        },
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          height: 80,
          id: 'editable-export-image',
          name: 'editable-pixel.png',
          opacity: 1,
          rotation: 0,
          source:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          strokeColor: 'transparent',
          strokeWidth: 0,
          type: 'image',
          width: 80,
          x: 150,
          y: -40,
        },
      ]),
    );
    localStorage.setItem('chalkboard:local-title', 'Editable export');
  });
  await page.goto('/local');
  const originalBoardUrl = page.url();
  await expect(
    page.locator('[data-mixed-text-id="editable-export-equation"]'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open board menu' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export board' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Editable export.chalkboard');
  const path = await download.path();
  assertValue(path, 'path');
  const archive = await parseBoardArchive(
    new Uint8Array(await readFile(path)),
    {
      inspectImage: async () => ({ pixelHeight: 1, pixelWidth: 1 }),
    },
  );
  expect(archive).toMatchObject({
    font: 'excalifont',
    title: 'Editable export',
  });
  expect(archive.elements).toEqual([
    expect.objectContaining({
      id: 'editable-export-equation',
      source: String.raw`Editable $x^2+1$`,
      type: 'equation',
    }),
    expect.objectContaining({
      id: 'editable-export-image',
      name: 'editable-pixel.png',
      type: 'image',
    }),
  ]);
  await expect(page.locator('.operation-status')).toHaveCount(0);

  await page.getByRole('button', { name: 'Open board menu' }).click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import board' }).click();
  const chooser = await chooserPromise;
  const validationWorkerPromise = page.waitForEvent('worker');
  await chooser.setFiles(path);
  const validationWorker = await validationWorkerPromise;
  expect(validationWorker.url()).toContain('boardArchiveWorker');
  await expect(page).not.toHaveURL(originalBoardUrl);
  await expect(page.getByRole('textbox', { name: 'Board title' })).toHaveValue(
    'Editable export',
  );
  await expect(
    page.locator('[data-mixed-text-id="editable-export-equation"]'),
  ).toHaveCount(0);
  await expect(page.locator('[data-mixed-text-id]')).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const boardId = window.location.pathname.split('/').at(-1) ?? '';
        const elements = JSON.parse(
          localStorage.getItem(`chalkboard:local-document:${boardId}`) ?? '[]',
        ) as { id?: string }[];
        return elements.some(({ id }) => id === 'editable-export-image');
      }),
    )
    .toBe(false);
  await expect(
    page.getByRole('img', { name: 'editable-pixel.png' }),
  ).toBeVisible();
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();

  const importedBoardUrl = page.url();
  await page.getByRole('button', { name: 'Open board menu' }).click();
  const hostileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import board' }).click();
  const hostileChooser = await hostileChooserPromise;
  await hostileChooser.setFiles({
    buffer: Buffer.from([1, 2, 3]),
    mimeType: 'application/vnd.chalkboard.board+zip',
    name: 'hostile.chalkboard',
  });
  await expect(page.getByRole('alert')).toContainText(
    'ZIP archive is truncated',
  );
  await expect(page).toHaveURL(importedBoardUrl);
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
});

test('exports portable SVG and high-resolution PNG board images', async ({
  page,
}) => {
  const requestedAssets: string[] = [];
  page.on('request', (request) => requestedAssets.push(request.url()));
  await page.addInitScript(() => {
    const base = {
      backgroundColor: 'transparent',
      createdBy: 'local',
      opacity: 1,
      rotation: 0,
      strokeColor: '#1f2937',
      strokeStyle: 'solid',
      strokeWidth: 2,
    };
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          ...base,
          cornerRadius: 10,
          height: 90,
          id: 'export-shape',
          shapeKind: 'rectangle',
          type: 'shape',
          width: 150,
          x: -180,
          y: -80,
        },
        {
          ...base,
          fontSize: 25,
          height: 40,
          id: 'export-equation',
          lineSpacing: 1.2,
          source: String.raw`Area is $\style{position:fixed;background:url(https://attacker.invalid/pixel)}{A=\pi r^2}$.`,
          type: 'equation',
          width: 240,
          x: 20,
          y: 40,
        },
      ]),
    );
  });
  await page.goto('/');
  const exportEquation = page.locator('[data-mixed-text-id="export-equation"]');
  await expect(exportEquation).toBeVisible();
  await expect(exportEquation).toContainText(/Area is.*A.*=.*r/u);
  await expect(exportEquation.locator('[style*="position"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Export image' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export image' });
  await expect(dialog).toBeVisible();
  const topPadding = dialog.getByRole('spinbutton', {
    name: 'Top export padding',
  });
  await topPadding.click();
  await page.keyboard.press('Backspace');
  await expect(topPadding).toHaveValue('');
  await page.keyboard.type('10');
  await dialog
    .getByRole('spinbutton', { name: 'Right export padding' })
    .fill('20');
  await dialog
    .getByRole('spinbutton', { name: 'Bottom export padding' })
    .fill('30');
  await dialog
    .getByRole('spinbutton', { name: 'Left export padding' })
    .fill('40');
  await dialog.getByText('SVG', { exact: true }).click();
  await dialog
    .getByRole('checkbox', { name: 'Include board background' })
    .uncheck();
  const svgDownloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export SVG' }).click();
  const svgDownload = await svgDownloadPromise;
  expect(svgDownload.suggestedFilename()).toBe('Untitled-board.svg');
  const svgPath = await svgDownload.path();
  if (svgPath === null) throw new Error('Expected an SVG download path');
  const svg = await readFile(svgPath, 'utf8');
  expect(svg).toContain('<foreignObject');
  expect(svg).toContain('<rect');
  expect(svg).toContain('viewBox="-221 -91 ');
  expect(svg).toContain('data:font/woff2;base64,');
  const embeddedFontDigests = [
    ...svg.matchAll(/@font-face\{[^}]*base64,([A-Za-z0-9+/=]+)\)/g),
  ].map((match) =>
    createHash('sha256')
      .update(Buffer.from(match[1] ?? '', 'base64'))
      .digest('hex'),
  );
  const fontDirectory = 'apps/web/src/vendor/excalifont/fonts';
  const expectedFontDigests = await Promise.all(
    (await readdir(fontDirectory))
      .filter((name) => name.endsWith('.woff2'))
      .map(async (name) =>
        createHash('sha256')
          .update(await readFile(`${fontDirectory}/${name}`))
          .digest('hex'),
      ),
  );
  expect(embeddedFontDigests.sort()).toEqual(expectedFontDigests.sort());
  expect(svg).not.toContain('fill="#f8f7f3"');
  expect(svg).not.toContain('/assets/KaTeX_');
  expect(svg).not.toContain('attacker.invalid');

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Export image' }).click();
  const pngDialog = page.getByRole('dialog', { name: 'Export image' });
  await pngDialog.getByText('PNG', { exact: true }).click();
  await pngDialog
    .getByRole('combobox', { name: 'PNG resolution' })
    .selectOption('3');
  const pngDownloadPromise = page.waitForEvent('download');
  await pngDialog.getByRole('button', { name: 'Export PNG' }).click();
  const pngDownload = await pngDownloadPromise;
  expect(pngDownload.suggestedFilename()).toBe('Untitled-board.png');
  const pngPath = await pngDownload.path();
  assertValue(pngPath, 'PNG download path');
  const png = await readFile(pngPath);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(requestedAssets.some((url) => url.includes('mathjaxEngine'))).toBe(
    false,
  );
});
