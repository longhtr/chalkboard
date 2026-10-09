/**
 * Excalifont's underset correction must not reach fractions.
 *
 * That correction pushes the first centered run of an over-under stack
 * downwards. A fraction is built from the same stack, and a nested fraction
 * puts a script-sized run in that row, so it matched too and every nested
 * fraction had a row shoved down through its own rule.
 *
 * Relative positioning moves paint without moving layout boxes, so an ancestor
 * rect cannot see this. Read the offset on the moved run itself.
 */
import { expect, test } from '@playwright/test';

const NESTED_FRACTION = String.raw`$\frac{\frac{a}{b}}{c}$`;
const UNDERSET = String.raw`$\underset{x}{y}$`;

function equation(id: string, source: string, y: number) {
  return {
    backgroundColor: 'transparent',
    createdBy: 'local',
    fontSize: 40,
    height: 140,
    id,
    lineSpacing: 1.2,
    opacity: 1,
    rotation: 0,
    source,
    strokeColor: '#111827',
    strokeWidth: 2,
    type: 'equation',
    width: 320,
    x: -140,
    y,
  };
}

test('leaves a nested fraction unshifted while an underset still shifts', async ({
  page,
}) => {
  await page.addInitScript(
    ([serialized]) => {
      localStorage.setItem('chalkboard:local-title', 'Nested fractions');
      localStorage.setItem('chalkboard:local-document', serialized ?? '[]');
    },
    [
      JSON.stringify([
        equation('nested', NESTED_FRACTION, -120),
        equation('underset', UNDERSET, 60),
      ]),
    ],
  );
  await page.goto('/');
  await page.locator('.ML__mfrac .ML__mfrac').first().waitFor();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const inner = document.querySelector('.ML__mfrac .ML__mfrac');
        const run = inner?.querySelector<HTMLElement>(
          '.ML__vlist > .ML__center:first-child > span:last-child',
        );
        return run === null || run === undefined
          ? null
          : getComputedStyle(run).top;
      }),
    )
    // Any offset here is the underset correction landing on a fraction row,
    // which is what dropped the numerator onto the rule.
    .toBe('auto');

  await expect
    .poll(() =>
      page.evaluate(() => {
        const underset = [...document.querySelectorAll('.ML__latex')].find(
          (node) =>
            (node.textContent ?? '').includes('x') &&
            node.querySelector('.ML__mfrac') === null,
        );
        const run = underset?.querySelector<HTMLElement>(
          '.ML__vlist > .ML__center:first-child > span:last-child',
        );
        return run === null || run === undefined
          ? null
          : Number.parseFloat(getComputedStyle(run).top);
      }),
    )
    // The correction the selector exists for is still applied.
    .toBeGreaterThan(0);
});
