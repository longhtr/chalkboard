/**
 * A tall run must not draw through the lines above or below it.
 *
 * A mixed block is one MathLive render whose lines are anonymous block boxes
 * divided by zero-height break spans. MathLive struts a formula's line once per
 * render, so no individual line gets a height and each falls back to what its
 * inline boxes report. Those under-report: `ML__left-right` cancels its own
 * depth out of the line box with a negative top margin, and glyph ink overshoots
 * KaTeX's metric boxes elsewhere. `applyLineClearance` measures the paint and
 * pushes the neighbours apart.
 *
 * The tolerance is calibrated in the same run rather than written down. A text
 * run's font box overhangs its line box in both directions, so two ordinary
 * prose lines already report a small rectangle overlap that is padding, not ink.
 * A prose-only block measures that overhang, and every other block is held to
 * it. Hard-coded pixels would only record whichever face was installed today.
 */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import { canvasBounds } from './helpers/equationEditor';

const PROSE = 'Ordinary prose';

const RUNS: Record<string, string> = {
  bmatrix: String.raw`\begin{bmatrix}\dfrac{a}{b}\\\dfrac{c}{d}\end{bmatrix}`,
  leftright: String.raw`\left[\begin{array}{c}\dfrac{a}{b}\\\dfrac{c}{d}\end{array}\right]`,
  nested: String.raw`\dfrac{\dfrac{a}{b}}{\dfrac{c}{d}}`,
  sum: String.raw`\displaystyle\sum_{i=1}^{n}\dfrac{1}{i^{2}}`,
};

function equation(id: string, middle: string, index: number) {
  return {
    backgroundColor: 'transparent',
    createdBy: 'local',
    fontSize: 24,
    height: 240,
    id,
    lineSpacing: 1.2,
    opacity: 1,
    rotation: 0,
    source: `${PROSE}\n${middle}\n${PROSE}`,
    strokeColor: '#111827',
    strokeWidth: 2,
    type: 'equation',
    width: 280,
    x: -720 + index * 290,
    y: -120,
  };
}

/** The worst rectangle overlap between any two adjacent lines, per block. */
async function worstOverlaps(page: import('@playwright/test').Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-mixed-text-id]')].map((host) => {
        const lines: { bottom: number; top: number }[] = [
          { bottom: -Infinity, top: Infinity },
        ];
        // From the base only. The struts either side of it are sized to the
        // whole render, so counting them would swamp every line.
        const base = host.querySelector('.ML__base');
        for (const node of base?.querySelectorAll('*') ?? []) {
          if (node.classList.contains('mixed-text-line-break')) {
            lines.push({ bottom: -Infinity, top: Infinity });
            continue;
          }
          if (node.classList.contains('ML__pstrut')) continue;
          const rect = node.getBoundingClientRect();
          if (rect.height === 0 || rect.width === 0) continue;
          const line = lines[lines.length - 1];
          if (line === undefined) continue;
          line.top = Math.min(line.top, rect.top);
          line.bottom = Math.max(line.bottom, rect.bottom);
        }
        let worst = -Infinity;
        for (let index = 1; index < lines.length; index++) {
          const above = lines[index - 1];
          const below = lines[index];
          if (above === undefined || below === undefined) continue;
          worst = Math.max(worst, above.bottom - below.top);
        }
        return [
          host.getAttribute('data-mixed-text-id') ?? '',
          Number(worst.toFixed(1)),
        ];
      }),
    ),
  );
}

test('keeps a tall run from drawing through its neighbouring lines', async ({
  page,
}) => {
  await page.addInitScript(
    ([serialized]) => {
      localStorage.setItem('chalkboard:local-title', 'Clearance');
      localStorage.setItem('chalkboard:local-document', serialized ?? '[]');
    },
    [
      JSON.stringify([
        equation('prose', PROSE, 0),
        ...Object.entries(RUNS).map(([id, latex], index) =>
          equation(id, `$${latex}$`, index + 1),
        ),
      ]),
    ],
  );
  await page.goto('/');
  await page.locator('.ML__mfrac').first().waitFor();

  await expect
    .poll(async () => {
      const overlaps = await worstOverlaps(page);
      const overhang = overlaps['prose'];
      if (overhang === undefined) return ['prose block missing'];
      // Every math block held to the plain prose block's own overhang. Before
      // the clearance pass these ran from 15 to 55 pixels past it.
      return Object.entries(overlaps)
        .filter(([id, worst]) => id !== 'prose' && worst > overhang + 1)
        .map(([id, worst]) => `${id}: ${worst} vs ${overhang}`);
    })
    .toEqual([]);

  // Stored in em, so zooming does not have to recompute it.
  const clearances = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.mixed-text-line-break')]
      .map((node) => node.style.getPropertyValue('--line-clearance'))
      .filter((value) => value !== ''),
  );
  expect(clearances.length).toBeGreaterThan(0);
  for (const value of clearances) expect(value).toMatch(/em$/u);
});

test('leaves an all-prose block on its line spacing', async ({ page }) => {
  await page.addInitScript(
    ([serialized]) => {
      localStorage.setItem('chalkboard:local-title', 'Prose');
      localStorage.setItem('chalkboard:local-document', serialized ?? '[]');
    },
    [JSON.stringify([equation('prose', PROSE, 0)])],
  );
  await page.goto('/');
  await page.locator('[data-mixed-text-id="prose"]').waitFor();

  // A text run's font box always overhangs its line box, so measuring text
  // would add space to every gap and silently redefine what the line-spacing
  // setting means. No break span in a prose-only block may carry a clearance.
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.mixed-text-line-break')]
          .map((node) => node.style.getPropertyValue('--line-clearance'))
          .filter((value) => value !== ''),
      ),
    )
    .toEqual([]);
});

test('applies the same clearance while the block is being edited', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'canvas bounds');

  await page.mouse.click(bounds.x + 420, bounds.y + 220);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type(PROSE);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+m');
  // A nested fraction, which is tall enough that its ink leaves the line box.
  await page.keyboard.type('\\frac');
  await page.keyboard.press('Space');
  await page.keyboard.type('\\frac');
  await page.keyboard.press('Space');
  await page.keyboard.type('a');
  await page.keyboard.press('Tab');
  await page.keyboard.type('b');
  await page.keyboard.press('Tab');
  await page.keyboard.type('c');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+m');
  await page.keyboard.type(PROSE);

  // The block and the same block being edited keep separate stylesheets, so the
  // clearance has to be proven inside the shadow tree as well as outside it.
  await expect
    .poll(() =>
      page
        .locator('math-field')
        .evaluate(
          (field) =>
            [
              ...(field.shadowRoot?.querySelectorAll<HTMLElement>(
                '.mixed-text-line-break',
              ) ?? []),
            ]
              .map((node) => node.style.getPropertyValue('--line-clearance'))
              .filter((value) => value !== '').length,
        ),
    )
    .toBeGreaterThan(0);

  await expect
    .poll(() =>
      page
        .locator('math-field')
        .evaluate((field) =>
          [
            ...(field.shadowRoot?.querySelectorAll('.mixed-text-line-break') ??
              []),
          ].map((node) =>
            Number(node.getBoundingClientRect().height.toFixed(1)),
          ),
        ),
    )
    .not.toEqual([0, 0]);
});
