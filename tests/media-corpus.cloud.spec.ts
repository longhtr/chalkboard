/** Uploads/downloads the checked media corpus through authorized PostgreSQL-backed cloud asset routes. */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { registerCloudAccount } from './helpers/cloudAccount';

const RASTER_CORPUS = [
  ['10bit-64x48.avif', 'image/avif'],
  ['animated-64x48.gif', 'image/gif'],
  ['animated-64x48.webp', 'image/webp'],
  ['interlaced-64x48.png', 'image/png'],
  ['lossy-64x48.webp', 'image/webp'],
  ['progressive-64x48.jpg', 'image/jpeg'],
  ['static-64x48.avif', 'image/avif'],
  ['static-64x48.gif', 'image/gif'],
  ['static-64x48.jpg', 'image/jpeg'],
  ['static-64x48.png', 'image/png'],
  ['static-64x48.webp', 'image/webp'],
] as const;

function corpusDataUrl(name: string, mediaType: string): string {
  const path = resolve(process.cwd(), `tests/media/${name}`);
  return `data:${mediaType};base64,${readFileSync(path).toString('base64')}`;
}

async function expectCorpusImages(
  page: Page,
  expectedSource: 'cloud' | 'local',
): Promise<void> {
  for (const [name] of RASTER_CORPUS) {
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
    await expect(image).toHaveAttribute(
      'src',
      expectedSource === 'cloud'
        ? /\/api\/boards\/[0-9a-f-]+\/assets\/[0-9a-f-]+$/u
        : /^data:image\//u,
    );
  }
}

test('copies the raster corpus through durable cloud assets', async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await registerCloudAccount(context.request, {
    displayName: 'Media Corpus',
    email: `media-corpus-${crypto.randomUUID()}@chalkboard.test`,
    password: 'media corpus password',
  });
  const fixtures = RASTER_CORPUS.map(([name, mediaType], index) => ({
    index,
    name,
    source: corpusDataUrl(name, mediaType),
  }));
  await page.addInitScript((images) => {
    localStorage.setItem('chalkboard:local-title', 'Raster corpus');
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify(
        images.map(({ index, name, source }) => ({
          backgroundColor: 'transparent',
          createdBy: 'local',
          height: 48,
          id: `media-corpus-${index}`,
          name,
          opacity: 1,
          rotation: 0,
          source,
          strokeColor: 'transparent',
          strokeWidth: 0,
          type: 'image',
          width: 64,
          x: (index % 4) * 80 - 120,
          y: Math.floor(index / 4) * 64 - 88,
        })),
      ),
    );
  }, fixtures);

  await page.goto('/');
  await expect(page.getByText('Canvas contains 11 objects')).toBeVisible();
  await expectCorpusImages(page, 'local');
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Copy to cloud' }).click();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/u);
  await expect(page.getByText(/^Synced$/u)).toBeVisible();
  await expectCorpusImages(page, 'cloud');

  const freshPage = await context.newPage();
  await freshPage.goto(page.url());
  await expect(freshPage.getByText(/^Synced$/u)).toBeVisible();
  await expectCorpusImages(freshPage, 'cloud');
  await freshPage
    .getByRole('main')
    .screenshot({ path: testInfo.outputPath('cloud-raster-corpus.png') });
  await freshPage.close();
});
