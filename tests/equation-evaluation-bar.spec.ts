/**
 * Every vertical bar is lengthened, an evaluation bound more than the rest.
 *
 * A bar reaches the page in unrelated shapes: a delimiter element of its own,
 * the pieces of a stacked delimiter, or a plain character MathLive merged into
 * the run beside it, so `F(x)|` arrives as one span holding the bracket and the
 * bar together. Only an element that is nothing but a bar can be corrected, and
 * a written bar was the shape that reached none of the earlier rules.
 *
 * A bar carrying limits, or one closing a pair opened with `\left.`, is an
 * evaluation bound. An absolute value and a norm open with a bar of their own.
 */
import { expect, test } from '@playwright/test';

const BOUNDS: ReadonlyArray<readonly [string, string]> = [
  ['short evaluation bound', String.raw`\left.F(x)\right|_a^b`],
  ['tall evaluation bound', String.raw`\left.\frac{x^2}{2}\right|_0^1`],
  ['written bar with limits', String.raw`F(x)|_a^b`],
  ['written bar with one limit', String.raw`F(x)|_0`],
];

const PLAIN: ReadonlyArray<readonly [string, string, number]> = [
  ['written absolute value', String.raw`|a|`, 2],
  ['written bar without limits', String.raw`F(x)|`, 1],
  ['absolute value', String.raw`\left|x\right|`, 2],
  ['tall absolute value', String.raw`\left|\frac{x^2}{2}\right|`, 2],
  ['norm', String.raw`\left\|x\right\|`, 2],
];

async function open(page: import('@playwright/test').Page, latex: string) {
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
          source: `$${value}$`,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 400,
          x: -200,
          y: -80,
        },
      ]),
    );
  }, latex);
  await page.goto('/');
  const rendered = page.locator('[data-mixed-text-id="bar"]');
  await rendered.waitFor();
  return rendered;
}

for (const [name, latex] of BOUNDS) {
  test(`lengthens the bar of a ${name}`, async ({ page }) => {
    const rendered = await open(page, latex);
    const bars = rendered.locator('[data-excalifont-delim="bar"]');
    await expect(bars).toHaveCount(1);
    await expect(
      rendered.locator('[data-excalifont-delim="bar-plain"]'),
    ).toHaveCount(0);
    await expect
      .poll(() => bars.evaluate((node) => getComputedStyle(node).transform))
      .toBe('matrix(1, 0, 0, 1.5, 0, 0)');
  });
}

for (const [name, latex, count] of PLAIN) {
  test(`lengthens a ${name} less`, async ({ page }) => {
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
      .toBe('matrix(1, 0, 0, 1.12, 0, 0)');
  });
}

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
