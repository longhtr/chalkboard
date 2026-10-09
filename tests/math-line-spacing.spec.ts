/** Line-spacing consistency across active editing, inactive rendering, reload, copy, and export. */
import { expect, type Locator, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import { seedLocalBoard } from './helpers/seedLocalBoard.js';

async function arrayRowGap(element: Locator): Promise<number> {
  return element.evaluate((host) => {
    const root = host.shadowRoot ?? host;
    const rows = root.querySelector('.col-align-r .ML__vlist');
    const positions = [...(rows?.children ?? [])].map(
      (row) => row.getBoundingClientRect().y,
    );
    return positions.length > 1
      ? (Math.max(...positions) - Math.min(...positions)) /
          (positions.length - 1)
      : 0;
  });
}

test('applies line spacing to aligned math while editing and rendered', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForURL(/\/local\/[0-9a-f-]{36}$/i);
  const boardId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  const latex = String.raw`\begin{aligned}a&=b+c\\d&=e+f\\g&=h+i\end{aligned}`;
  await seedLocalBoard(page, boardId, [
    {
      backgroundColor: 'transparent',
      createdBy: 'local',
      fontSize: 48,
      height: 210,
      id: 'aligned-proof',
      lineSpacing: 1.2,
      opacity: 1,
      rotation: 0,
      source: `$${latex}$`,
      strokeColor: '#1f2937',
      strokeWidth: 2,
      type: 'equation',
      width: 360,
      x: 100,
      y: 100,
    },
  ]);
  await page.reload();

  const rendered = page.getByRole('math', { name: latex });
  await expect(rendered).toBeVisible();
  const initialRenderedGap = await arrayRowGap(rendered);
  expect(initialRenderedGap).toBeGreaterThan(60);

  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const renderedBounds = await rendered.boundingBox();
  assertValue(renderedBounds, 'rendered element bounds');
  await page.mouse.click(
    renderedBounds.x + renderedBounds.width / 2,
    renderedBounds.y + renderedBounds.height / 2,
  );
  await page.locator('.inline-math-editor.is-ready').waitFor();
  const field = page.locator('math-field');
  await expect
    .poll(() => arrayRowGap(field))
    .toBeCloseTo(initialRenderedGap, 0);

  const spacingSlider = page.getByRole('slider', {
    name: 'Line spacing slider',
  });
  const spacingInput = page.getByRole('spinbutton', {
    name: 'Line spacing input',
  });
  await spacingSlider.fill('2');
  await expect(spacingInput).toHaveValue('2');
  await expect
    .poll(() => arrayRowGap(field))
    .toBeGreaterThan(initialRenderedGap + 25);
  const expandedEditorGap = await arrayRowGap(field);

  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(field).toHaveCount(0);
  await expect
    .poll(() => arrayRowGap(rendered))
    .toBeCloseTo(expandedEditorGap, 0);

  await page.reload();
  await expect
    .poll(() => arrayRowGap(page.getByRole('math', { name: latex })))
    .toBeCloseTo(expandedEditorGap, 0);
});
