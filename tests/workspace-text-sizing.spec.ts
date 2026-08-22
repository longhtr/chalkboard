/** Text size and line-spacing controls across drafts, selections, anchors, measurement, reload, and undo. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import * as workspace from './helpers/workspace';

test('adjusts text size and line spacing with Alt shortcuts after using sliders', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const textSizeSlider = page.getByRole('slider', {
    name: 'Text size slider',
  });
  const textSizeInput = page.getByRole('spinbutton', {
    name: 'Text size input',
  });
  const lineSpacingSlider = page.getByRole('slider', {
    name: 'Line spacing slider',
  });
  const lineSpacingInput = page.getByRole('spinbutton', {
    name: 'Line spacing input',
  });
  const pressAlt = async (key: string) => {
    await page.keyboard.down('Alt');
    await page.keyboard.press(key);
    await page.keyboard.up('Alt');
  };

  await textSizeSlider.fill('40');
  await expect(textSizeSlider).toBeFocused();
  await pressAlt('=');
  await expect(textSizeInput).toHaveValue('41');
  await pressAlt('-');
  await expect(textSizeInput).toHaveValue('40');

  await lineSpacingSlider.fill('1.5');
  await expect(lineSpacingSlider).toBeFocused();
  await pressAlt(']');
  await expect(lineSpacingInput).toHaveValue('1.6');
  await pressAlt('[');
  await expect(lineSpacingInput).toHaveValue('1.5');
});

test('changes mixed-text block size with a slider and editable input', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const panel = page.getByRole('complementary', { name: 'Element style' });
  // The editing view is offered with the tool selected and no block open, so a
  // new block can be started in whichever view the writer wants.
  await expect(panel.locator('.panel-label')).toHaveText([
    'Input mode',
    'Text color',
    'Text size',
    'Line spacing',
    'Text style',
    'Editing view',
  ]);
  await expect(panel.locator('.panel-label').first()).toHaveCSS(
    'font-size',
    '13px',
  );
  const slider = page.getByRole('slider', { name: 'Text size slider' });
  const sizeInput = page.getByRole('spinbutton', { name: 'Text size input' });
  await expect(slider).toHaveValue('30');
  await expect(sizeInput).toHaveValue('30');
  await slider.fill('40');
  await expect(sizeInput).toHaveValue('40');

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.click(bounds.x + 440, bounds.y + 280);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('Alpha');
  const rendered = page.getByRole('group', { name: 'Alpha' });
  await expect
    .poll(() =>
      rendered
        .locator('.mixed-text-element__content')
        .evaluate((element) => getComputedStyle(element).fontSize),
    )
    .toBe('40px');

  const sliderBounds = await slider.boundingBox();
  assertValue(sliderBounds, 'slider bounds');
  await page.mouse.move(
    sliderBounds.x + sliderBounds.width * 0.35,
    sliderBounds.y + sliderBounds.height / 2,
  );
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.move(
    sliderBounds.x + sliderBounds.width * 0.7,
    sliderBounds.y + sliderBounds.height / 2,
    { steps: 5 },
  );
  await page.waitForTimeout(150);
  const draggedSize = Number(await slider.inputValue());
  expect(draggedSize).toBeGreaterThan(40);
  await expect(sizeInput).toHaveValue(String(draggedSize));
  await expect(page.locator('math-field')).toHaveCount(1);
  await expect
    .poll(() =>
      rendered
        .locator('.mixed-text-element__content')
        .evaluate((element) => getComputedStyle(element).fontSize),
    )
    .toBe(`${draggedSize}px`);
  await page.mouse.up();
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('X');
  await expect(page.locator('math-field')).toHaveJSProperty('value', 'AlphaX');

  await sizeInput.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('56', { delay: 150 });
  await expect(sizeInput).toBeFocused();
  await expect(slider).toHaveValue('56');
  await expect(page.locator('math-field')).toHaveCount(1);
  await expect
    .poll(() =>
      rendered
        .locator('.mixed-text-element__content')
        .evaluate((element) => getComputedStyle(element).fontSize),
    )
    .toBe('56px');
  await page.keyboard.press('Escape');
  await expect(sizeInput).not.toBeFocused();
  await expect(sizeInput).toHaveValue('56');
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('Y');
  await expect(page.locator('math-field')).toHaveJSProperty('value', 'AlphaXY');
  await slider.focus();
  const keyboardSize = Number(await slider.inputValue()) + 1;
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue(String(keyboardSize));
  await expect(page.locator('math-field')).toBeFocused({ timeout: 2_000 });
  await page.keyboard.type('K');
  await expect(page.locator('math-field')).toHaveJSProperty(
    'value',
    'AlphaXYK',
  );
  await page.getByRole('button', { name: 'Selection tool' }).click();

  const renderedBounds = await rendered.boundingBox();
  if (renderedBounds === null) {
    throw new Error('Expected rendered text bounds before re-editing');
  }
  await page.mouse.click(
    renderedBounds.x + renderedBounds.width / 2,
    renderedBounds.y + renderedBounds.height / 2,
  );
  await sizeInput.fill('48');
  await expect(slider).toHaveValue('48');
  await expect
    .poll(() =>
      rendered
        .locator('.mixed-text-element__content')
        .evaluate((element) => getComputedStyle(element).fontSize),
    )
    .toBe('48px');

  await page.reload();
  await expect
    .poll(() =>
      page
        .getByRole('group', { name: 'AlphaXYK' })
        .locator('.mixed-text-element__content')
        .evaluate((element) => getComputedStyle(element).fontSize),
    )
    .toBe('48px');
  await workspace.selectMixedTextTool(page);
  await expect(slider).toHaveValue('48');
  const reloadedBounds = await canvas.boundingBox();
  assertValue(reloadedBounds, 'element bounds after reload');
  await page.mouse.click(reloadedBounds.x + 650, reloadedBounds.y + 430);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('Beta');
  await expect
    .poll(() =>
      page
        .getByRole('group', { name: 'Beta' })
        .locator('.mixed-text-element__content')
        .evaluate((element) => getComputedStyle(element).fontSize),
    )
    .toBe('48px');
});

test('changes and persists mixed-text line spacing while editing and rendered', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const spacingSlider = page.getByRole('slider', {
    name: 'Line spacing slider',
  });
  const spacingInput = page.getByRole('spinbutton', {
    name: 'Line spacing input',
  });
  await expect(spacingSlider).toHaveValue('1.2');
  await expect(spacingInput).toHaveValue('1.2');
  await spacingInput.fill('2');
  await expect(spacingSlider).toHaveValue('2');

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.click(bounds.x + 440, bounds.y + 280);
  const field = page.locator('math-field');
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('First');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');

  const editorGap = await field.evaluate((mathField) => {
    const rowPositions = [
      ...(mathField.shadowRoot?.querySelectorAll<HTMLElement>(
        '.ML__text:not(.ML__base):not(.mixed-text-line-break)',
      ) ?? []),
    ]
      .filter((node) => (node.textContent ?? '') !== '')
      .map((node) => node.getBoundingClientRect().y);
    return rowPositions.length === 0
      ? 0
      : Math.max(...rowPositions) - Math.min(...rowPositions);
  });
  expect(editorGap).toBeGreaterThan(45);

  await page.getByRole('button', { name: 'Selection tool' }).click();
  const rendered = page.getByRole('group', { name: 'First\nSecond' });
  const renderedGap = async () =>
    rendered
      .locator('.ML__text:not(.ML__base)')
      .filter({ hasText: /^(First|Second)$/ })
      .evaluateAll((rows) => {
        const [firstRow, secondRow] = rows;
        return firstRow === undefined || secondRow === undefined
          ? 0
          : secondRow.getBoundingClientRect().y -
              firstRow.getBoundingClientRect().y;
      });
  await expect.poll(renderedGap).toBeGreaterThan(45);
  const expandedRenderedGap = await renderedGap();
  expect(Math.abs(expandedRenderedGap - editorGap)).toBeLessThan(2);

  const renderedBounds = await rendered.boundingBox();
  if (renderedBounds === null) {
    throw new Error('Expected rendered multiline text bounds');
  }
  await page.mouse.click(renderedBounds.x + 8, renderedBounds.y + 12);
  await spacingInput.fill('1');
  await expect(spacingSlider).toHaveValue('1');
  await expect.poll(renderedGap).toBeLessThan(expandedRenderedGap - 15);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { lineSpacing?: number }[];
        return elements[0]?.lineSpacing;
      }),
    )
    .toBe(1);

  await page.reload();
  const reloaded = page.getByRole('group', { name: 'First\nSecond' });
  await expect
    .poll(() =>
      reloaded
        .locator('.ML__text:not(.ML__base)')
        .filter({ hasText: /^(First|Second)$/ })
        .evaluateAll((rows) => {
          const [firstRow, secondRow] = rows;
          return firstRow === undefined || secondRow === undefined
            ? 0
            : secondRow.getBoundingClientRect().y -
                firstRow.getBoundingClientRect().y;
        }),
    )
    .toBeLessThan(expandedRenderedGap - 15);
  await workspace.selectMixedTextTool(page);
  await expect(spacingInput).toHaveValue('1');
});

test('groups a font-size slider drag into one board undo step', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 25,
          height: 32,
          id: 'sized-block',
          opacity: 1,
          rotation: 0,
          source: 'Size',
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 55,
          x: -100,
          y: -50,
        },
      ]),
    );
  });
  await page.goto('/');
  const block = page.locator('[data-mixed-text-id="sized-block"]');
  await expect(block).toBeVisible();
  await page.getByRole('button', { name: 'Board objects' }).click();
  const navigator = page.getByRole('complementary', { name: 'Board objects' });
  await navigator.locator('[data-object-id="sized-block"]').click();
  await navigator.getByRole('button', { name: 'Close board objects' }).click();
  const slider = page.getByRole('slider', { name: 'Text size slider' });
  await expect(slider).toBeVisible();
  const sliderBounds = await slider.boundingBox();
  assertValue(sliderBounds, 'slider bounds');
  await page.mouse.move(
    sliderBounds.x + sliderBounds.width * 0.2,
    sliderBounds.y + sliderBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    sliderBounds.x + sliderBounds.width * 0.75,
    sliderBounds.y + sliderBounds.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(slider).not.toHaveValue('25');
  await page.getByRole('button', { name: 'Undo' }).focus();
  await page.keyboard.press('Control+z');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { fontSize?: number }[];
        return elements[0]?.fontSize;
      }),
    )
    .toBe(25);
});

test('keeps the cursor aligned through repeated color changes and undo', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.click(bounds.x + 420, bounds.y + 260);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  const field = page.locator('math-field');
  const rendered = page.locator('.math-element');
  const logicalPosition = () =>
    field.evaluate((mathField) => {
      const markerOffsets: number[] = [];
      for (let offset = 0; offset < mathField.lastOffset; offset += 1) {
        if (
          /^[\u200B\u200C\u2060-\u2062]$/.test(
            mathField.getValue([offset, offset + 1]),
          )
        ) {
          markerOffsets.push(offset);
        }
      }
      return (
        mathField.position -
        markerOffsets.filter((offset) => offset < mathField.position).length
      );
    });

  await page.keyboard.type('a');
  for (const [color, character] of [
    ['#e03131', 'b'],
    ['#1971c2', 'c'],
    ['#1f2937', 'd'],
  ]) {
    await page.getByRole('button', { name: `Use ${color} text color` }).click();
    await page.keyboard.type(character);
  }
  await expect(rendered).toHaveAttribute('aria-label', 'abcd');
  await expect.poll(logicalPosition).toBe(4);

  for (const [source, position] of [
    ['abc', 3],
    ['ab', 2],
    ['a', 1],
  ] as const) {
    await page.keyboard.press('Control+z');
    await expect(rendered).toHaveAttribute('aria-label', source);
    await expect.poll(logicalPosition).toBe(position);
  }
  for (const [source, position] of [
    ['ab', 2],
    ['abc', 3],
    ['abcd', 4],
  ] as const) {
    await page.keyboard.press('Control+Shift+z');
    await expect(rendered).toHaveAttribute('aria-label', source);
    await expect.poll(logicalPosition).toBe(position);
  }
  await expect
    .poll(() =>
      field.evaluate((mathField) => {
        const markers = [
          ...(mathField.shadowRoot?.querySelectorAll(
            '.mixed-text-color-marker',
          ) ?? []),
        ];
        markers.forEach((marker) =>
          marker.classList.remove('mixed-text-color-marker'),
        );
        const widths = markers.map(
          (marker) => marker.getBoundingClientRect().width,
        );
        markers.forEach((marker) =>
          marker.classList.add('mixed-text-color-marker'),
        );
        return widths;
      }),
    )
    .toEqual([0, 0, 0, 0]);

  await page.keyboard.press('Control+z');
  await expect(rendered).toHaveAttribute('aria-label', 'abc');
  await page.keyboard.type('X');
  await expect(rendered).toHaveAttribute('aria-label', 'abcX');
  await expect.poll(logicalPosition).toBe(4);
  await expect
    .poll(() =>
      rendered
        .locator('.ML__base > .ML__text', { hasText: /^X$/ })
        .evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(31, 41, 55)');
});

test('cycles the future text color with Alt+J/K shortcuts', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const red = page.getByRole('button', { name: 'Use #e03131 text color' });
  const blue = page.getByRole('button', { name: 'Use #1971c2 text color' });

  await page.keyboard.press('Alt+k');
  await expect(red).toHaveClass(/is-active/);

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.click(bounds.x + 440, bounds.y + 280);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('a');

  await page.keyboard.press('Alt+k');
  await expect(blue).toHaveClass(/is-active/);
  await page.keyboard.type('b');

  await page.keyboard.press('Alt+j');
  await expect(red).toHaveClass(/is-active/);
  await page.keyboard.type('c');
  const rendered = page.getByRole('group', { name: 'abc' });
  await expect(rendered).toBeVisible();
  const coloredRuns = rendered.locator('.mixed-text-color-marker + .ML__text');
  await expect(coloredRuns.nth(0)).toHaveText('b');
  await expect
    .poll(() =>
      coloredRuns.nth(0).evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(25, 113, 194)');
  await expect(coloredRuns.nth(1)).toHaveText('c');
  await expect
    .poll(() =>
      coloredRuns.nth(1).evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(224, 49, 49)');
});

test('keeps multiline math intact across repeated colored-text undo', async ({
  page,
}) => {
  const originalSource = 'line1\nline2\n...\n...\nline100\n$a^2+b^2=c^2$';
  await page.addInitScript((source) => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 22,
          height: 180,
          id: 'colored-undo-block',
          opacity: 1,
          rotation: 0,
          source,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 190,
          x: -180,
          y: -120,
        },
      ]),
    );
  }, originalSource);
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const rendered = page.locator('[data-mixed-text-id="colored-undo-block"]');
  const bounds = await rendered.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.click(
    bounds.x + bounds.width - 2,
    bounds.y + bounds.height - 4,
  );
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.locator('math-field').evaluate((field) => {
    field.position = field.lastOffset;
  });

  await page.getByRole('button', { name: 'Use #1971c2 text color' }).click();
  await page.keyboard.type('blue');
  await page.getByRole('button', { name: 'Use #e03131 text color' }).click();
  await page.keyboard.type(' red');
  await expect(rendered).toHaveAttribute(
    'aria-label',
    `${originalSource}blue red`,
  );
  await expect(rendered.locator('.ML__mathit')).not.toHaveCount(0);

  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('Control+z');
  }
  await expect(rendered).toHaveAttribute('aria-label', originalSource);
  await expect(rendered.locator('.ML__mathit')).not.toHaveCount(0);
  await expect
    .poll(() =>
      page.locator('math-field').evaluate((field) => ({
        hasRawColorCommand: field.value.includes('\\textcolor'),
        visibleColorMarkers: [
          ...(field.shadowRoot?.querySelectorAll('.mixed-text-color-marker') ??
            []),
        ].filter((marker) => getComputedStyle(marker).width !== '0px').length,
      })),
    )
    .toEqual({ hasRawColorCommand: false, visibleColorMarkers: 0 });

  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('Control+Shift+z');
  }
  await expect(rendered).toHaveAttribute(
    'aria-label',
    `${originalSource}blue red`,
  );
  await expect(rendered.locator('.ML__mathit')).not.toHaveCount(0);
});
