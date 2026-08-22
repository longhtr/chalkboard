/** Click/box selection, movement, resize, ordering, clipboard, object navigation, and deletion stories. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import * as workspace from './helpers/workspace';

test('centers the highest object when entering a board', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify(
        [
          { id: 'highest', source: 'Highest', x: 240, y: -900 },
          { id: 'lower', source: 'Lower', x: -300, y: 600 },
        ].map((element) => ({
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 30,
          height: 42,
          opacity: 1,
          rotation: 0,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 160,
          ...element,
        })),
      ),
    );
  });
  await page.goto('/');

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const highest = page.locator('[data-mixed-text-id="highest"]');
  await expect(highest).toBeVisible();
  await expect
    .poll(async () => {
      const [canvasBounds, highestBounds] = await Promise.all([
        canvas.boundingBox(),
        highest.boundingBox(),
      ]);
      if (canvasBounds === null || highestBounds === null) return Infinity;
      return Math.abs(
        highestBounds.y - (canvasBounds.y + canvasBounds.height / 2),
      );
    })
    .toBeLessThan(2);
});

test('zooms around the touchpad pinch point without changing wheel panning', async ({
  page,
}) => {
  await page.goto('/');
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const zoom = page.locator('.zoom-value');
  await expect(zoom).toHaveText('100%');

  const dispatchWheel = (gesture: { ctrlKey: boolean; deltaY: number }) =>
    canvas.evaluate((element, gesture) => {
      const bounds = element.getBoundingClientRect();
      const event = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + bounds.width * 0.7,
        clientY: bounds.top + bounds.height * 0.4,
        ctrlKey: gesture.ctrlKey,
        deltaY: gesture.deltaY,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }, gesture);

  expect(await dispatchWheel({ ctrlKey: true, deltaY: -20 })).toBe(true);
  await expect(zoom).toHaveText('122%');
  expect(await dispatchWheel({ ctrlKey: true, deltaY: 20 })).toBe(true);
  await expect(zoom).toHaveText('100%');
  expect(await dispatchWheel({ ctrlKey: false, deltaY: 20 })).toBe(true);
  await expect(zoom).toHaveText('100%');
});

test('deletes selected existing objects with either deletion key', async ({
  page,
}) => {
  await workspace.seedRectangles(page, 2);
  await page.goto('/');
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');

  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
  const firstRectangle = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2 + 40,
  };
  await page.mouse.click(firstRectangle.x, firstRectangle.y);
  const deleteButton = page.getByRole('button', { name: 'Delete selection' });
  await expect(deleteButton).toBeEnabled();
  await page.keyboard.press('Delete');
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
  await page.mouse.click(firstRectangle.x, firstRectangle.y);
  await page.keyboard.press('Backspace');
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await page.keyboard.press('Meta+z');
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
  await page.keyboard.press('Meta+Shift+z');
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
});

test('deletes drawings and selected mixed-text blocks', async ({ page }) => {
  await page.goto('/');
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const deleteButton = page.getByRole('button', { name: 'Delete selection' });

  await page.getByRole('button', { name: 'Shape tool' }).click();
  await page.mouse.move(center.x - 180, center.y - 100);
  await page.mouse.down();
  await page.mouse.move(center.x - 80, center.y - 20);
  await page.mouse.up();
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await expect(deleteButton).toBeDisabled();

  await page.getByRole('button', { name: 'Line / curve tool' }).click();
  await page.mouse.move(center.x + 40, center.y - 80);
  await page.mouse.down();
  await page.mouse.move(center.x + 180, center.y + 20);
  await page.mouse.up();
  await expect(deleteButton).toBeEnabled();
  await page.keyboard.press('Backspace');
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await expect(deleteButton).toBeDisabled();

  await workspace.selectMixedTextTool(page);
  await page.mouse.click(center.x, center.y);
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('Text');
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(page.locator('math-field')).toHaveCount(0);
  const mixedText = page.locator('[data-mixed-text-id]').first();
  await expect(mixedText).toBeVisible();
  const mixedTextBounds = await mixedText.boundingBox();
  assertValue(mixedTextBounds, 'mixed-text block bounds');
  await page.mouse.click(
    mixedTextBounds.x + mixedTextBounds.width / 2,
    mixedTextBounds.y + mixedTextBounds.height / 2,
  );
  await expect(
    page.getByRole('complementary', { name: 'Element style' }),
  ).toBeVisible();
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await expect(mixedText).toHaveCount(0);
});

test('copies and pastes selected objects with keyboard shortcuts', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: () => {
          sessionStorage.setItem('clipboard-read-attempted', 'true');
          return Promise.reject(new Error('Permission denied'));
        },
        writeText: () => Promise.reject(new Error('Permission denied')),
      },
    });
  });
  await workspace.seedRectangles(page);
  await page.goto('/');
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await page.getByRole('button', { name: 'Board objects' }).click();
  const navigator = page.getByRole('complementary', {
    name: 'Board objects',
  });
  await navigator
    .getByRole('button', {
      name: 'Rectangle shape, object 1, position -240, -100',
    })
    .click();
  await navigator.getByRole('button', { name: 'Close board objects' }).click();
  await expect(
    page.getByRole('button', { name: 'Delete selection' }),
  ).toBeEnabled();
  await page.keyboard.press('Control+c');
  await page.reload();
  const reloadedCanvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  await expect(reloadedCanvas).toBeVisible();
  await reloadedCanvas.focus();
  await page.keyboard.press('Control+v');
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem('clipboard-read-attempted')),
    )
    .toBeNull();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          JSON.parse(
            localStorage.getItem(
              `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
            ) ?? '[]',
          ) as { id: string; x: number; y: number }[]
        ).map(({ id, x, y }) => ({ id, x, y })),
      ),
    )
    .toEqual([
      { id: 'seeded-rectangle-0', x: -240, y: -100 },
      { id: expect.any(String), x: -220, y: -80 },
    ]);
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();

  await page.keyboard.press('Delete');
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          JSON.parse(
            localStorage.getItem(
              `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
            ) ?? '[]',
          ) as { id: string }[]
        ).map(({ id }) => id),
      ),
    )
    .toEqual(['seeded-rectangle-0']);

  await page.keyboard.press('Control+v');
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { x: number; y: number }[];
        return elements.at(-1);
      }),
    )
    .toMatchObject({ x: -200, y: -60 });
});

test('draws and selects a filled shape with no stroke', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Shape tool' }).click();
  const noStroke = page.getByRole('button', { name: 'Use no stroke' });
  await expect(noStroke).toBeVisible();
  await noStroke.click();
  await expect(noStroke).toHaveClass(/is-active/);
  await page.getByRole('button', { name: 'Use #e9ecef fill' }).click();

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  await page.mouse.move(bounds.x + 300, bounds.y + 220);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 480, bounds.y + 340, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { backgroundColor?: string; strokeColor?: string }[];
        return elements[0];
      }),
    )
    .toMatchObject({
      backgroundColor: '#e9ecef',
      strokeColor: 'transparent',
    });

  await page.getByRole('button', { name: 'Selection tool' }).click();
  await page.mouse.click(bounds.x + 390, bounds.y + 280);
  await expect(
    page.getByRole('button', { name: 'Delete selection' }),
  ).toBeEnabled();
  await expect(noStroke).toHaveClass(/is-active/);

  await page.getByRole('button', { name: 'Line / curve tool' }).click();
  await expect(noStroke).toHaveCount(0);
});
