/** Imports every checked media fixture and verifies accepted decoding, dimensions, persistence, and rejection. */
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const RASTER_CORPUS = [
  '10bit-64x48.avif',
  'animated-64x48.gif',
  'animated-64x48.webp',
  'interlaced-64x48.png',
  'lossy-64x48.webp',
  'progressive-64x48.jpg',
  'static-64x48.avif',
  'static-64x48.gif',
  'static-64x48.jpg',
  'static-64x48.png',
  'static-64x48.webp',
] as const;

const fixturePath = (name: string) =>
  resolve(process.cwd(), `tests/media/${name}`);

test('decodes the maintained raster corpus in the workspace', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const importButton = page
    .getByRole('toolbar', { name: 'Drawing tools' })
    .getByRole('button', { name: 'Import image / SVG' });

  for (const name of RASTER_CORPUS) {
    await importButton.click();
    await page
      .getByLabel('Choose image or SVG file')
      .setInputFiles(fixturePath(name));
    const image = page.getByRole('img', { name });
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate((node) => ({
          height: (node as HTMLImageElement).naturalHeight,
          width: (node as HTMLImageElement).naturalWidth,
        })),
      )
      .toEqual({ height: 48, width: 64 });
    await image.screenshot({ path: testInfo.outputPath(`${name}.png`) });
    await page.keyboard.press('Delete');
    await expect(image).toHaveCount(0);
  }
});
