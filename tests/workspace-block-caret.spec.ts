/**
 * Caret placement and viewport stability inside a mixed block taller than the
 * window.
 *
 * Two defects met here. `.canvas-viewport` was `overflow: hidden`, which is
 * still a scroll container, so focusing the caret let the browser scroll it to
 * reveal the caret: the view moved with no input from the user, and every later
 * click resolved against stale coordinates. And MathLive's `getOffsetFromPoint`
 * ignores the horizontal coordinate on Gecko, answering one near-final offset
 * for a whole row, so a click landed at the end of a line instead of where it
 * was aimed.
 */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';

const SOURCE = Array.from(
  { length: 26 },
  (_, index) =>
    `Line ${index} alpha beta gamma delta epsilon zeta eta $x_{${index}}$ tail`,
).join('\n');

async function viewportScroll(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.canvas-viewport');
    return {
      left: viewport?.scrollLeft ?? null,
      top: viewport?.scrollTop ?? null,
    };
  });
}

test('places the caret where a tall block is clicked without moving the view', async ({
  page,
}) => {
  await page.addInitScript((source) => {
    localStorage.setItem('chalkboard:local-title', 'Tall block caret');
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 24,
          height: 940,
          id: 'tall-block',
          lineSpacing: 1.2,
          opacity: 1,
          rotation: 0,
          source,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 640,
          x: -260,
          y: -220,
        },
      ]),
    );
  }, SOURCE);

  await page.goto('/');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const rendered = page.locator('[data-mixed-text-id="tall-block"]');
  await rendered.waitFor();

  const box = await rendered.boundingBox();
  assertValue(box, 'block box');
  const window_ = page.viewportSize();
  assertValue(window_, 'window size');
  // The block must overflow the window for the scroll defect to be reachable.
  expect(box.height).toBeGreaterThan(window_.height);

  expect(await viewportScroll(page)).toEqual({ left: 0, top: 0 });

  await page.mouse.click(box.x + 400, box.y + 16);
  const field = page.locator('math-field');
  await expect(field).toBeFocused();

  // Focusing the caret must not scroll the canvas out from under the pointer.
  await expect.poll(() => viewportScroll(page)).toEqual({ left: 0, top: 0 });

  // Columns along one row, several lines down. The defect answered the same
  // offset for every point on a row, so the caret went to the end of a line
  // wherever the block was aimed at; distinct columns must stay ordered.
  const rowY = box.y + 16;
  const positionAt = async (x: number) => {
    await page.waitForTimeout(600);
    await page.mouse.click(x, rowY);
    await page.waitForTimeout(200);
    return field.evaluate(
      (node) => (node as unknown as { position: number }).position,
    );
  };

  const near = await positionAt(box.x + 40);
  const middle = await positionAt(box.x + 150);
  const far = await positionAt(box.x + 280);
  expect(near).toBeLessThan(middle);
  expect(middle).toBeLessThan(far);

  await expect.poll(() => viewportScroll(page)).toEqual({ left: 0, top: 0 });
});

test('refuses to scroll the canvas viewport at all', async ({ page }) => {
  await page.addInitScript((source) => {
    localStorage.setItem('chalkboard:local-title', 'Overflowing board');
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 24,
          height: 940,
          id: 'overflow-block',
          lineSpacing: 1.2,
          opacity: 1,
          rotation: 0,
          source,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 640,
          x: -260,
          y: -220,
        },
      ]),
    );
  }, SOURCE);
  await page.goto('/');
  await page.locator('[data-mixed-text-id="overflow-block"]').waitFor();

  // Correct caret placement keeps the browser from wanting to scroll, but the
  // guarantee is that it cannot: `overflow: clip` leaves no scroll container,
  // so no focus, scroll-into-view, or script can shift the canvas.
  const scrolled = await page.evaluate(() => {
    const viewport = document.querySelector('.canvas-viewport');
    if (viewport === null) return null;
    viewport.scrollTop = 500;
    viewport.scrollLeft = 500;
    return {
      left: viewport.scrollLeft,
      // Proves the attempt was against genuinely overflowing content, so a
      // scroll container here would have moved.
      overflows: viewport.scrollHeight > viewport.clientHeight,
      top: viewport.scrollTop,
    };
  });
  expect(scrolled).toEqual({ left: 0, overflows: true, top: 0 });
});

test('resolves separate columns of one row to separate offsets', async ({
  page,
}) => {
  await page.addInitScript((source) => {
    localStorage.setItem('chalkboard:local-title', 'Row columns');
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 24,
          height: 300,
          id: 'row-block',
          lineSpacing: 1.2,
          opacity: 1,
          rotation: 0,
          source,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 640,
          x: -260,
          y: -120,
        },
      ]),
    );
  }, ['First line of prose here', 'Second line of prose here'].join('\n'));

  await page.goto('/');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const rendered = page.locator('[data-mixed-text-id="row-block"]');
  await rendered.waitFor();
  const box = await rendered.boundingBox();
  assertValue(box, 'block box');

  await page.mouse.click(box.x + 280, box.y + 16);
  const field = page.locator('math-field');
  await expect(field).toBeFocused();

  // Each sample uses a distinct coordinate and waits past the double-click
  // interval, so these stay three separate single clicks rather than a
  // word-selecting multi-click.
  const positionAt = async (x: number) => {
    await page.waitForTimeout(600);
    await page.mouse.click(x, box.y + 16);
    await page.waitForTimeout(200);
    return field.evaluate(
      (node) => (node as unknown as { position: number }).position,
    );
  };

  const near = await positionAt(box.x + 30);
  const middle = await positionAt(box.x + 110);
  const far = await positionAt(box.x + 190);

  // The Gecko defect returned one identical offset for all three.
  expect(near).toBeLessThan(middle);
  expect(middle).toBeLessThan(far);
});
