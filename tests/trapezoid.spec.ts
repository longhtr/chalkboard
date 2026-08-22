/** Trapezoid creation, direct top-edge handles, bounds, copy, undo, reload, and export geometry. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';

test('creates trapezoids and hides creation shapes in selection mode', async ({
  page,
}) => {
  await page.goto('/');
  const shapeTool = page.getByRole('button', { name: 'Shape tool' });
  await shapeTool.click();
  await expect(shapeTool).toHaveAttribute('aria-pressed', 'true');
  await expect(shapeTool).toHaveAttribute('data-shape-kind', 'rectangle');
  await expect(page.getByText('Stroke color', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('group', { exact: true, name: 'Shape' }).getByRole('button'),
  ).toHaveCount(8);

  await expect(
    page.getByRole('button', { name: 'Use star shape' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Use trapezoid shape' }).click();
  await expect(shapeTool).toHaveAttribute('data-shape-kind', 'trapezoid');
  await page.getByRole('button', { name: 'Use 4 pixel stroke weight' }).click();
  await page.getByRole('button', { name: 'Use dashed stroke' }).click();
  const cornerRadiusInput = page.getByLabel('Corner radius value');
  await cornerRadiusInput.click();
  await page.keyboard.press('Backspace');
  await expect(cornerRadiusInput).toHaveValue('');
  await page.keyboard.type('5');
  await expect(cornerRadiusInput).toHaveValue('5');
  await cornerRadiusInput.fill('18');
  await page.getByRole('button', { name: 'Use #1971c2 stroke' }).click();
  await expect(page.getByRole('button', { name: /^Use .* fill$/ })).toHaveCount(
    4,
  );
  await page.getByRole('button', { name: 'Add fill color' }).click();
  const pickerBounds = await page
    .getByRole('dialog', { name: 'Add custom color' })
    .boundingBox();
  const panelBounds = await page
    .getByRole('complementary', { name: 'Element style' })
    .boundingBox();
  assertValue(pickerBounds, 'picker bounds');
  assertValue(panelBounds, 'style panel bounds');
  if (pickerBounds !== null && panelBounds !== null) {
    expect(
      Math.abs(
        pickerBounds.y +
          pickerBounds.height -
          (panelBounds.y + panelBounds.height),
      ),
    ).toBeLessThan(2);
  }
  await page.getByRole('textbox', { name: 'Hex color' }).fill('#d0bfff');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Use #d0bfff fill' }),
  ).toHaveClass(/is-active/);

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.move(
    bounds.x + bounds.width / 2 - 90,
    bounds.y + bounds.height / 2 - 60,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 90,
    bounds.y + bounds.height / 2 + 60,
    { steps: 5 },
  );
  await page.mouse.up();

  const leftHandle = {
    x: bounds.x + bounds.width / 2 - 54,
    y: bounds.y + bounds.height / 2 - 60,
  };
  await page.mouse.move(leftHandle.x, leftHandle.y);
  await page.mouse.down();
  await page.mouse.move(leftHandle.x + 24, leftHandle.y + 80, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { trapezoidTopLeft?: number }[];
        return elements[0]?.trapezoidTopLeft;
      }),
    )
    .toBeCloseTo(1 / 3);

  const rightHandle = {
    x: bounds.x + bounds.width / 2 + 54,
    y: bounds.y + bounds.height / 2 - 60,
  };
  await page.mouse.move(rightHandle.x, rightHandle.y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 - 90, rightHandle.y, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { trapezoidTopLeft?: number; trapezoidTopRight?: number }[];
        const shape = elements[0];
        return (shape?.trapezoidTopRight ?? 0) - (shape?.trapezoidTopLeft ?? 0);
      }),
    )
    .toBeCloseTo(0.1);

  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ),
      ),
    )
    .toEqual([
      expect.objectContaining({
        backgroundColor: '#d0bfff',
        cornerRadius: 18,
        shapeKind: 'trapezoid',
        strokeColor: '#1971c2',
        strokeStyle: 'dashed',
        strokeWidth: 4,
        type: 'shape',
      }),
    ]);

  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(
    page.getByRole('complementary', { name: 'Element style' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Delete selection' }),
  ).toBeEnabled();
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  // Exact matching: the shape-kind picker is the creation control that must
  // disappear, and a substring match would also catch sibling style groups.
  await expect(
    page.getByRole('group', { exact: true, name: 'Shape' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Use triangle shape' }),
  ).toHaveCount(0);
  await expect(shapeTool).toHaveAttribute('data-shape-kind', 'trapezoid');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { shapeKind?: string }[];
        return elements[0]?.shapeKind;
      }),
    )
    .toBe('trapezoid');
  await expect(page.getByLabel('Corner radius slider')).toBeVisible();
  await expect(page.getByLabel('Corner radius value')).toHaveValue('18');
});
