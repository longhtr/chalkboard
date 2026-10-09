/**
 * `\begin{array}` must sit on the math axis like every other tabular
 * environment.
 *
 * MathLive 0.110.0 top-aligns `array` alone, reporting nearly all of its size
 * as depth, while `\left...\right` sizes and centers its delimiters on the axis
 * from that same height and depth. The two disagreed, so the bracket around an
 * array of `\dfrac` rows came out far too tall and floated above its contents,
 * worsening with every row. `patches/mathlive@0.110.0.patch` removes the
 * special case; this holds it removed.
 *
 * The same patch also stops MathLive withholding `\jot` from matrices, `cases`
 * and `array`, which left their rows stacked with the boxes touching exactly so
 * that tall rows drew over each other. The second test holds that too.
 *
 * Read painted geometry rather than the boxes: a delimiter and an array are
 * both inline blocks whose reported height is clamped to the line box, so a
 * bounding rectangle says nothing about where either one is drawn.
 */
import { expect, test } from '@playwright/test';

const ARRAY = String.raw`$\left[\begin{array}{c}\dfrac{a}{b}\\\dfrac{c}{d}\\\dfrac{f}{g}\end{array}\right]$`;
const MATRIX = String.raw`$\begin{bmatrix}\dfrac{a}{b}\\\dfrac{c}{d}\\\dfrac{f}{g}\end{bmatrix}$`;

function equation(id: string, source: string, x: number) {
  return {
    backgroundColor: 'transparent',
    createdBy: 'local',
    fontSize: 32,
    height: 260,
    id,
    lineSpacing: 1.2,
    opacity: 1,
    rotation: 0,
    source,
    strokeColor: '#111827',
    strokeWidth: 2,
    type: 'equation',
    width: 220,
    x,
    y: -130,
  };
}

/** Union of every painted descendant, which struts and empty boxes are not. */
async function paintedSpan(
  page: import('@playwright/test').Page,
  elementIndex: number,
  selector: string,
) {
  return page.evaluate(
    ([index, target]) => {
      const host = document.querySelectorAll('.math-element')[index as number];
      const root = host?.querySelector(target as string);
      if (root == null) return null;
      let top = Infinity;
      let bottom = -Infinity;
      for (const node of [root, ...root.querySelectorAll('*')]) {
        if (node.classList.contains('ML__pstrut')) continue;
        const rect = node.getBoundingClientRect();
        if (rect.height === 0 || rect.width === 0) continue;
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.bottom);
      }
      return { bottom, top };
    },
    [elementIndex, selector] as const,
  );
}

test('centers a delimited array on the axis like the equivalent matrix', async ({
  page,
}) => {
  await page.addInitScript(
    ([serialized]) => {
      localStorage.setItem('chalkboard:local-title', 'Arrays');
      localStorage.setItem('chalkboard:local-document', serialized ?? '[]');
    },
    [
      JSON.stringify([
        equation('array', ARRAY, -260),
        equation('matrix', MATRIX, 40),
      ]),
    ],
  );
  await page.goto('/');
  await page.locator('.ML__mtable').nth(1).waitFor();

  // Polled rather than read once: these are painted positions, so under a
  // parallel run the first measurement can land before the workspace face has
  // finished loading and the geometry is still the fallback font's.
  //
  // The bracket is allowed to fall a little short of the array, which is what
  // \delimitershortfall asks for, but it must not miss it: before the patch the
  // bracket started roughly 90px above a 32px array and cleared its top row
  // entirely.
  await expect
    .poll(async () => {
      const bracket = await paintedSpan(page, 0, '.ML__left-right .ML__open');
      const content = await paintedSpan(page, 0, '.ML__mtable');
      if (bracket == null || content == null) return ['not rendered'];
      const bracketCenter = (bracket.top + bracket.bottom) / 2;
      const contentCenter = (content.top + content.bottom) / 2;
      const complaints: string[] = [];
      if (Math.abs(bracketCenter - contentCenter) >= 12) {
        complaints.push(`center ${bracketCenter - contentCenter}`);
      }
      if (bracket.top <= content.top - 24) complaints.push('starts too high');
      if (bracket.bottom >= content.bottom + 24) {
        complaints.push('ends too low');
      }
      return complaints;
    })
    .toEqual([]);

  // Same rows, same delimiters, so `array` and `bmatrix` must place their
  // contents identically. That equality is what the special case broke.
  await expect
    .poll(async () => {
      const content = await paintedSpan(page, 0, '.ML__mtable');
      const matrixContent = await paintedSpan(page, 1, '.ML__mtable');
      if (content == null || matrixContent == null) return null;
      return Number(
        (
          content.bottom -
          content.top -
          (matrixContent.bottom - matrixContent.top)
        ).toFixed(1),
      );
    })
    .toBe(0);
});

test('separates array and matrix rows with the same clearance as align', async ({
  page,
}) => {
  await page.addInitScript(
    ([serialized]) => {
      localStorage.setItem('chalkboard:local-title', 'Arrays');
      localStorage.setItem('chalkboard:local-document', serialized ?? '[]');
    },
    [
      JSON.stringify([
        equation('array', ARRAY, -260),
        equation('matrix', MATRIX, 40),
      ]),
    ],
  );
  await page.goto('/');
  await page.locator('.ML__mtable').nth(1).waitFor();

  // Consecutive fraction rules are one baseline apart, so their spacing is the
  // row spacing. With the rows merely touching it measured 1.62em and 1.96em
  // for these glyphs, and the ink collided; \jot adds 0.3em to each.
  for (const index of [0, 1]) {
    const rules = await page
      .locator('.math-element')
      .nth(index)
      .locator('.ML__frac-line')
      .evaluateAll((lines) =>
        lines.map((line) => line.getBoundingClientRect().top),
      );
    expect(rules).toHaveLength(3);
    for (let row = 1; row < rules.length; row++) {
      expect(
        (rules[row] ?? 0) - (rules[row - 1] ?? 0),
        `element ${index} row ${row}`,
      ).toBeGreaterThan(1.8 * 32);
    }
  }
});
