/**
 * Every vertical bar receives the correction appropriate to its glyph face.
 *
 * A bar reaches the page in unrelated shapes: a delimiter element of its own,
 * the pieces of a stacked delimiter, or a plain character MathLive merged into
 * the run beside it, so `F(x)|` arrives as one span holding the bracket and the
 * bar together. Only an element that is nothing but a bar can be corrected, and
 * a written bar was the shape that reached none of the earlier rules.
 *
 * A bar carrying limits, or one closing a pair opened with `\left.`, is an
 * evaluation bound whose height MathLive has already fitted to its expression.
 * An absolute value and a norm use short math-face glyphs that must reach the
 * full painted height of a text-face bar.
 */
import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

const BOUNDS: ReadonlyArray<readonly [string, string]> = [
  ['short evaluation bound', String.raw`\left.F(x)\right|_a^b`],
  ['tall evaluation bound', String.raw`\left.\frac{x^2}{2}\right|_0^1`],
  ['written bar with limits', String.raw`F(x)|_a^b`],
  ['written bar with one limit', String.raw`F(x)|_0`],
];

const SHORT_MATH_BARS: ReadonlyArray<readonly [string, string, number]> = [
  ['written absolute value', String.raw`|a|`, 2],
  ['written bar without limits', String.raw`F(x)|`, 1],
  ['absolute value', String.raw`\left|x\right|`, 2],
  ['norm', String.raw`\lVert x\rVert`, 2],
];

const SIZED_MATH_BARS: ReadonlyArray<readonly [string, string]> = [
  ['tall absolute value', String.raw`\left|\frac{x^2}{2}\right|`],
  ['tall norm', String.raw`\left\lVert\frac{x^2}{2}\right\rVert`],
  ['manually sized norm', String.raw`\bigl\lVert x\bigr\rVert`],
];

async function openSource(
  page: import('@playwright/test').Page,
  source: string,
) {
  await page.addInitScript((value) => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 32,
          height: 120,
          id: 'bar',
          lineSpacing: 1.2,
          opacity: 1,
          rotation: 0,
          source: value,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 400,
          x: -200,
          y: -80,
        },
      ]),
    );
  }, source);
  await page.goto('/');
  const rendered = page.locator('[data-mixed-text-id="bar"]');
  await rendered.waitFor();
  return rendered;
}

async function open(page: import('@playwright/test').Page, latex: string) {
  return openSource(page, `$${latex}$`);
}

for (const [name, latex] of BOUNDS) {
  test(`keeps MathLive's fitted height for a ${name}`, async ({ page }) => {
    const rendered = await open(page, latex);
    const bars = rendered.locator('[data-excalifont-delim="bar"]');
    await expect(bars).toHaveCount(1);
    await expect(
      rendered.locator('[data-excalifont-delim="bar-plain"]'),
    ).toHaveCount(0);
    await expect
      .poll(() => bars.evaluate((node) => getComputedStyle(node).transform))
      .toBe('matrix(1, 0, 0, 1, 0, 0)');
  });
}

for (const [name, latex, count] of SHORT_MATH_BARS) {
  test(`raises a short ${name} to text-bar height`, async ({ page }) => {
    const rendered = await open(page, latex);
    const bars = rendered.locator('[data-excalifont-delim="bar-plain"]');
    await expect(bars).toHaveCount(count);
    await expect(rendered.locator('[data-excalifont-delim="bar"]')).toHaveCount(
      0,
    );
    await expect
      .poll(() =>
        bars.first().evaluate((node) => getComputedStyle(node).transform),
      )
      .toBe('matrix(1, 0, 0, 2.1, 0, 0)');
  });
}

for (const [name, latex] of SIZED_MATH_BARS) {
  test(`does not double an already-sized ${name}`, async ({ page }) => {
    const rendered = await open(page, latex);
    const bars = rendered.locator(
      '.ML__delim-mult[data-excalifont-delim="bar-plain"]',
    );
    await expect(bars).toHaveCount(2);
    await expect
      .poll(() =>
        bars.first().evaluate((node) => getComputedStyle(node).transform),
      )
      .toBe('matrix(1, 0, 0, 1.12, 0, 0)');
  });
}

test('retains the existing full-height text bars', async ({ page }) => {
  const rendered = await openSource(page, '|A|');
  const bars = rendered.locator('.ML__text[data-excalifont-delim="bar-plain"]');
  await expect(bars).toHaveCount(2);
  await expect
    .poll(() =>
      bars.first().evaluate((node) => getComputedStyle(node).transform),
    )
    .toBe('matrix(1, 0, 0, 1.12, 0, 0)');
});

test('uses the same full-height norm bars in the active editor', async ({
  page,
}) => {
  const rendered = await open(page, String.raw`\lVert A \rVert`);
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const bounds = await rendered.boundingBox();
  if (bounds === null) throw new Error('Expected rendered norm bounds');
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  const field = page.locator('math-field');
  await expect(field).toBeFocused();
  await expect
    .poll(() =>
      field.evaluate((host) => {
        const bar = host.shadowRoot?.querySelector<HTMLElement>(
          '[data-excalifont-delim="bar-plain"]',
        );
        return bar === undefined || bar === null
          ? null
          : getComputedStyle(bar).transform;
      }),
    )
    .toBe('matrix(1, 0, 0, 2.1, 0, 0)');
});

test('preserves full-height norm bars in portable image markup', async ({
  page,
}) => {
  await open(page, String.raw`\lVert A \rVert`);
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Export image' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export image' });
  await dialog.getByText('SVG', { exact: true }).click();
  const pendingDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export SVG' }).click();
  const download = await pendingDownload;
  const path = await download.path();
  if (path === null) throw new Error('Expected a portable SVG download');
  const svg = await readFile(path, 'utf8');
  const bars = [...svg.matchAll(/<text[^>]*>∥<\/text>/gu)].map(
    ([markup]) => markup,
  );
  expect(bars).toHaveLength(2);
  for (const bar of bars) {
    expect(bar).toMatch(
      / y="0" transform="translate\(0 -?[\d.]+\) scale\(1 2.1\)"/u,
    );
  }
});

test('leaves delimiters that are not bars alone', async ({ page }) => {
  const rendered = await open(page, String.raw`\left(\frac{x^2}{2}\right)+[y]`);
  await expect(rendered.locator('[data-excalifont-delim]')).toHaveCount(0);
});

test('keeps the written text intact when a run is split', async ({ page }) => {
  const rendered = await open(page, String.raw`F(x)|_a^b`);
  await expect
    .poll(() =>
      rendered.evaluate((root) =>
        (root.querySelector('.ML__latex')?.textContent ?? '').replace(
          /[\s\u200B]/gu,
          '',
        ),
      ),
    )
    .toBe('F(x)∣ab');
});
