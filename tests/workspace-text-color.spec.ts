/** Existing selection color, custom palettes, future typing color, mixed spans, undo, and persistence. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import * as workspace from './helpers/workspace';

test('shows explicit mixed-text input mode controls', async ({ page }) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const modes = page.getByRole('group', { name: 'Input mode' });
  const textMode = modes.getByRole('button', {
    name: 'Use text input mode',
  });
  const mathMode = modes.getByRole('button', {
    name: 'Use math input mode',
  });
  await expect(textMode).toHaveAttribute('aria-pressed', 'true');
  await expect(mathMode).toHaveAttribute('aria-pressed', 'false');

  await mathMode.click();
  await expect(mathMode).toHaveAttribute('aria-pressed', 'true');
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  await page.mouse.click(bounds.x + 360, bounds.y + 240);
  await page.locator('.inline-math-editor.is-ready').waitFor();

  await textMode.click();
  await expect(textMode).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('math-field')).toBeFocused();
});

test('applies text color when the workspace starts in dark mode', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('chalkboard:theme', 'dark');
  });
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');

  await page.mouse.click(bounds.x + 360, bounds.y + 240);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('A');
  const darkRed = page.getByRole('button', {
    name: 'Use #ff8787 text color',
  });
  await darkRed.click();
  await expect(darkRed).toHaveClass(/is-active/);
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('R');
  await page.getByRole('button', { name: 'Selection tool' }).click();

  // Every color, palette or not, reaches MathLive as a marker rather than a
  // `\textcolor` command, because the editable field escapes that command in
  // text mode and shows the reader its source.
  const coloredRun = page
    .getByRole('group', { name: 'AR', exact: true })
    .locator('.mixed-text-color-marker + .ML__text')
    .filter({ hasText: /^R$/u });
  await expect(coloredRun).toHaveCount(1);
  await expect
    .poll(() =>
      coloredRun.evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(255, 135, 135)');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const boardId = window.location.pathname.split('/').at(-1) ?? '';
        const elements = JSON.parse(
          localStorage.getItem(`chalkboard:local-document:${boardId}`) ?? '[]',
        ) as { source?: string }[];
        return elements[0]?.source;
      }),
    )
    .toBe(String.raw`A\textcolor{#ff8787}{R}`);
});

test('colors an existing text selection as one undo transaction', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  await page.mouse.click(bounds.x + 360, bounds.y + 240);
  const field = page.locator('math-field');
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('ABC');
  await field.evaluate((mathField) => {
    mathField.selection = { direction: 'forward', ranges: [[1, 2]] };
  });

  await page.getByRole('button', { name: 'Use #e03131 text color' }).click();
  const coloredSource = String.raw`A\textcolor{#e03131}{B}C`;
  const published = page.locator('[data-mixed-text-id]').first();
  await expect
    .poll(() => field.evaluate((mathField) => mathField.value))
    .toBe(coloredSource);
  await expect(published).toHaveAttribute('aria-label', 'ABC');
  await expect(published.locator('.mixed-text-color-marker')).toHaveCount(2);

  await page.keyboard.press('Control+z');
  await expect
    .poll(() => field.evaluate((mathField) => mathField.value))
    .toBe('ABC');
  await expect(published.locator('.mixed-text-color-marker')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(published.locator('.mixed-text-color-marker')).toHaveCount(2);
  await page.keyboard.press('Control+e');
  await expect(page.getByRole('textbox', { name: 'Block source' })).toHaveValue(
    coloredSource,
  );
});

test('applies text color only to future typing', async ({ page }) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');

  await page.mouse.click(bounds.x + 360, bounds.y + 240);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('Alpha');
  await page.getByRole('button', { name: 'Selection tool' }).click();
  const initialAlpha = page.getByRole('group', { name: 'Alpha' });
  const alphaId = await initialAlpha.getAttribute('data-mixed-text-id');
  assertValue(alphaId, 'mixed-text element identity');
  const alpha = page.locator(`[data-mixed-text-id="${alphaId}"]`);
  const alphaBounds = await alpha.boundingBox();
  assertValue(alphaBounds, 'mixed-text block bounds');
  await page.mouse.click(
    alphaBounds.x + alphaBounds.width / 2,
    alphaBounds.y + alphaBounds.height / 2,
  );

  await expect(page.getByText('Text color', { exact: true })).toHaveCount(0);
  await workspace.selectMixedTextTool(page);
  const currentAlphaBounds = await alpha.boundingBox();
  assertValue(currentAlphaBounds, 'current mixed-text block bounds');
  await page.mouse.click(
    currentAlphaBounds.x + currentAlphaBounds.width - 2,
    currentAlphaBounds.y + currentAlphaBounds.height / 2,
  );
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await expect(page.getByText('Text color', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use #e03131 text color' }).click();
  await expect
    .poll(() =>
      alpha
        .locator('.mixed-text-element__content')
        .evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(31, 41, 55)');
  await page.keyboard.type('R');
  const alphaColoredRun = alpha
    .locator('.mixed-text-color-marker + .ML__text')
    .first();
  await expect(alphaColoredRun).toContainText('R');
  await expect
    .poll(() =>
      alphaColoredRun.evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(224, 49, 49)');
  await expect
    .poll(() =>
      alpha
        .locator('.mixed-text-element__content')
        .evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(31, 41, 55)');
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(page.locator('math-field')).toHaveCount(0);

  await workspace.selectMixedTextTool(page);
  await page.mouse.click(bounds.x + 680, bounds.y + 400);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('Beta');
  const beta = page.locator('.math-element').nth(1);
  await expect
    .poll(() =>
      beta
        .locator('.mixed-text-element__content')
        .evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(224, 49, 49)');
  await page.getByRole('button', { name: 'Use #1971c2 text color' }).click();
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('G');
  const betaColoredRun = beta
    .locator('.mixed-text-color-marker + .ML__text')
    .first();
  await expect(betaColoredRun).toContainText('G');
  await expect
    .poll(() =>
      betaColoredRun.evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(25, 113, 194)');
  await page.keyboard.press('Control+z');
  await expect(beta.locator('.mixed-text-color-marker')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(betaColoredRun).toContainText('G');
  await page.getByRole('button', { name: 'Selection tool' }).click();

  await page.reload();
  await expect(
    alpha.locator('.mixed-text-color-marker + .ML__text').first(),
  ).toContainText('R');
  await expect
    .poll(() =>
      alpha
        .locator('.mixed-text-element__content')
        .evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(31, 41, 55)');
  await expect(
    page
      .locator('.math-element')
      .nth(1)
      .locator('.mixed-text-color-marker + .ML__text')
      .first(),
  ).toContainText('G');
});

test('adds persistent custom colors with at most five controls per row', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const palette = page.locator('.swatches');
  await expect(palette.locator('button')).toHaveCount(4);
  await expect
    .poll(() =>
      palette.evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(' ').length,
      ),
    )
    .toBe(5);

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const canvasBounds = await canvas.boundingBox();
  assertValue(canvasBounds, 'drawing canvas bounds');
  await page.mouse.click(canvasBounds.x + 440, canvasBounds.y + 280);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('A');

  await page.getByRole('button', { name: 'Add color' }).click();
  const picker = page.getByRole('dialog', { name: 'Add custom color' });
  await expect(picker).toBeVisible();
  await expect(picker.locator('.hsv-color-control').first()).toHaveCSS(
    'font-size',
    '12px',
  );
  await expect(picker.getByRole('textbox', { name: 'Hex color' })).toHaveCSS(
    'font-size',
    '12px',
  );
  const panelBounds = await page
    .getByRole('complementary', { name: 'Element style' })
    .boundingBox();
  const pickerBounds = await picker.boundingBox();
  assertValue(panelBounds, 'style panel bounds');
  assertValue(pickerBounds, 'picker bounds');
  if (panelBounds !== null && pickerBounds !== null) {
    expect(pickerBounds.x).toBeGreaterThan(panelBounds.x + panelBounds.width);
  }
  await expect(page.locator('input[type="color"]')).toHaveCount(0);
  await expect(picker.locator('.picker-swatch')).toHaveCount(0);
  await picker.getByRole('slider', { name: 'Hue' }).fill('120');
  await picker.getByRole('slider', { name: 'Saturation' }).fill('100');
  await picker.getByRole('slider', { name: 'Value' }).fill('100');
  await expect(picker.getByRole('textbox', { name: 'Hex color' })).toHaveValue(
    '#00ff00',
  );
  await expect(
    picker.getByRole('spinbutton', { name: 'Red value' }),
  ).toHaveValue('0');
  await expect(
    picker.getByRole('spinbutton', { name: 'Green value' }),
  ).toHaveValue('255');
  await expect(
    picker.getByRole('spinbutton', { name: 'Blue value' }),
  ).toHaveValue('0');
  await picker.getByRole('spinbutton', { name: 'Hue value' }).fill('240');
  await picker
    .getByRole('spinbutton', { name: 'Saturation value' })
    .fill('100');
  await picker.getByRole('spinbutton', { name: 'Value value' }).fill('100');
  await expect(picker.getByRole('slider', { name: 'Hue' })).toHaveValue('240');
  await expect(picker.getByRole('textbox', { name: 'Hex color' })).toHaveValue(
    '#0000ff',
  );
  await picker.getByRole('slider', { name: 'Red' }).fill('255');
  await picker.getByRole('spinbutton', { name: 'Green value' }).fill('0');
  await picker.getByRole('spinbutton', { name: 'Blue value' }).fill('0');
  await expect(picker.getByRole('textbox', { name: 'Hex color' })).toHaveValue(
    '#ff0000',
  );
  await expect(
    picker.getByRole('spinbutton', { name: 'Hue value' }),
  ).toHaveValue('0');
  await picker.getByRole('textbox', { name: 'Hex color' }).fill('#f59f00');
  await expect(picker.getByRole('slider', { name: 'Hue' })).toHaveValue('39');
  await expect(
    picker.getByRole('spinbutton', { name: 'Red value' }),
  ).toHaveValue('245');
  await expect(
    picker.getByRole('spinbutton', { name: 'Green value' }),
  ).toHaveValue('159');
  await picker.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(picker).toHaveCount(0);
  const customSwatch = page.getByRole('button', {
    name: 'Use #f59f00 text color',
  });
  await expect(customSwatch).toHaveClass(/is-active/);
  await expect(palette.locator('.swatch')).toHaveCount(4);
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('C');
  await page.getByRole('button', { name: 'Use #e03131 text color' }).click();
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('R');
  await page.getByRole('button', { name: 'Selection tool' }).click();

  const rendered = page.getByRole('group', { name: 'ACR', exact: true });
  const runAfterMarker = (text: string) =>
    rendered
      .locator('.mixed-text-color-marker + .ML__text')
      .filter({ hasText: new RegExp(`^${text}$`, 'u') });
  const customRun = runAfterMarker('C');
  const redRun = runAfterMarker('R');
  await expect(customRun).toHaveCount(1);
  await expect(redRun).toHaveCount(1);
  await expect
    .poll(() =>
      customRun.evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(245, 159, 0)');
  await expect
    .poll(() => redRun.evaluate((element) => getComputedStyle(element).color))
    .toBe('rgb(224, 49, 49)');

  await page.reload();
  await workspace.selectMixedTextTool(page);
  const persistedCustomSwatch = page.getByRole('button', {
    name: 'Use #f59f00 text color',
  });
  await expect(persistedCustomSwatch).toBeVisible();
  await persistedCustomSwatch.hover();
  await page.getByRole('button', { name: 'Remove #f59f00 color' }).click();
  await expect(persistedCustomSwatch).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .getByRole('group', { name: 'ACR', exact: true })
        .locator('.mixed-text-color-marker + .ML__text')
        .filter({ hasText: /^C$/u })
        .evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(245, 159, 0)');

  await page.reload();
  await workspace.selectMixedTextTool(page);
  await expect(
    page.getByRole('button', { name: 'Use #f59f00 text color' }),
  ).toHaveCount(0);
});

test('removing the active custom color resets future typing', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  await page.mouse.click(bounds.x + 500, bounds.y + 300);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('A');

  await page.getByRole('button', { name: 'Add color' }).click();
  const picker = page.getByRole('dialog', { name: 'Add custom color' });
  await picker.getByRole('textbox', { name: 'Hex color' }).fill('#f59f00');
  await picker.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('C');

  const customSwatch = page.getByRole('button', {
    name: 'Use #f59f00 text color',
  });
  await customSwatch.hover();
  await page.getByRole('button', { name: 'Remove #f59f00 color' }).click();
  await expect(customSwatch).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Use #1f2937 text color' }),
  ).toHaveClass(/is-active/);
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('B');
  await page.getByRole('button', { name: 'Selection tool' }).click();

  const rendered = page.getByRole('group', { name: 'ACB', exact: true });
  await expect
    .poll(() =>
      rendered
        .locator('.ML__text')
        .filter({ hasText: /^B$/ })
        .evaluate((element) => getComputedStyle(element).color),
    )
    .toBe('rgb(31, 41, 55)');
});

/**
 * Reopening a colored block must not show the reader its color command.
 *
 * `convertLatexToMarkup` understands `\textcolor` in text mode, so the inactive
 * block always looked right. The editable field does not: given the command in
 * text mode it escapes every backslash and brace into literal characters, so
 * clicking back into the block replaced the writing with
 * `A\textcolor{#ff8787}{R}`. Only the five colors that happened to hold a
 * marker escaped this, which hid it behind the light palette.
 */
for (const [theme, swatch] of [
  ['dark', '#ff8787'],
  ['light', '#e03131'],
] as const) {
  test(`reopens a ${theme} colored block as writing, not as its source`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      localStorage.setItem('chalkboard:theme', value);
    }, theme);
    await page.goto('/');
    await workspace.selectMixedTextTool(page);
    const canvas = page.getByRole('application', {
      name: 'Chalkboard drawing canvas',
    });
    const bounds = await canvas.boundingBox();
    assertValue(bounds, 'drawing canvas bounds');

    await page.mouse.click(bounds.x + 360, bounds.y + 240);
    await page.locator('.inline-math-editor.is-ready').waitFor();
    await page.keyboard.type('A');
    await page
      .getByRole('button', { name: `Use ${swatch} text color` })
      .click();
    await page.keyboard.type('R');
    await page.getByRole('button', { name: 'Selection tool' }).click();

    // Storage keeps the canonical command; only what MathLive is handed differs.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const boardId = window.location.pathname.split('/').at(-1) ?? '';
          const elements = JSON.parse(
            localStorage.getItem(`chalkboard:local-document:${boardId}`) ??
              '[]',
          ) as { source?: string }[];
          return elements[0]?.source;
        }),
      )
      .toBe(`A\\textcolor{${swatch}}{R}`);

    await page.reload();
    await workspace.selectMixedTextTool(page);
    const rendered = page.getByRole('group', { name: 'AR', exact: true });
    const renderedBounds = await rendered.boundingBox();
    assertValue(renderedBounds, 'rendered block bounds');
    await page.mouse.click(
      renderedBounds.x + renderedBounds.width / 2,
      renderedBounds.y + renderedBounds.height / 2,
    );
    await page.locator('.inline-math-editor.is-ready').waitFor();

    // A restored color is a MathLive style, which serializes as `\textcolor`.
    // The defect looked different: the field escaped the command it was handed
    // into literal characters, which is what `\textbackslash` marks.
    const fieldValue = await page
      .locator('math-field')
      .evaluate((element) => (element as unknown as { value: string }).value);
    expect(fieldValue).not.toContain('textbackslash');
    expect(fieldValue).not.toContain('textbraceleft');

    // What the writer sees is the writing, not its source.
    const drawn = await page.locator('math-field').evaluate((node) =>
      [...(node.shadowRoot?.querySelectorAll<HTMLElement>('.ML__text') ?? [])]
        .filter((child) => child.children.length === 0)
        .map((child) => child.textContent ?? '')
        .join('')
        .replace(/[^\p{L}\p{N}\\{}]/gu, ''),
    );
    expect(drawn).toBe('AR');

    // Opening and closing the block repeatedly must not accumulate anything in
    // the stored source: the color arrives as a marker and leaves as a command,
    // and each pass converts between them.
    const storedSource = () =>
      page.evaluate(() => {
        const boardId = window.location.pathname.split('/').at(-1) ?? '';
        const elements = JSON.parse(
          localStorage.getItem(`chalkboard:local-document:${boardId}`) ?? '[]',
        ) as { source?: string }[];
        return elements[0]?.source;
      });
    for (let pass = 0; pass < 3; pass += 1) {
      await page.getByRole('button', { name: 'Selection tool' }).click();
      await expect(page.locator('math-field')).toHaveCount(0);
      await workspace.selectMixedTextTool(page);
      const box = await page.locator('.math-element').first().boundingBox();
      assertValue(box, 'block bounds');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.locator('.inline-math-editor.is-ready').waitFor();
    }
    await page.getByRole('button', { name: 'Selection tool' }).click();
    await expect.poll(storedSource).toBe(`A\\textcolor{${swatch}}{R}`);
  });
}

/**
 * Colored runs stay colored while the block is being edited.
 *
 * A color reaches MathLive as an invisible marker, which carries no style of
 * its own, so the editable field showed every run in the block's own color
 * until the styles were restored onto it. Bold and italic were restored that
 * way from the start; color was not, so opening a block to edit it looked like
 * the color had been discarded.
 */
test('keeps run colors while the block is open for editing', async ({
  page,
}) => {
  await page.addInitScript(
    (source) => {
      localStorage.setItem(
        'chalkboard:local-document',
        JSON.stringify([
          {
            backgroundColor: 'transparent',
            createdBy: 'local',
            fontSize: 24,
            height: 120,
            id: 'tinted',
            lineSpacing: 1.2,
            opacity: 1,
            rotation: 0,
            source,
            strokeColor: '#1f2937',
            strokeWidth: 2,
            type: 'equation',
            width: 400,
            x: -200,
            y: -80,
          },
        ]),
      );
    },
    String.raw`N\textcolor{#e03131}{R}\textcolor{#1971c2}{B}K`,
  );

  await page.goto('/');
  const rendered = page.locator('[data-mixed-text-id="tinted"]');
  await rendered.waitFor();

  const coloredRuns = (root: Element) =>
    [...root.querySelectorAll<HTMLElement>('.ML__text')]
      .filter((node) => /^[A-Z]$/u.test(node.textContent ?? ''))
      .map((node) => `${node.textContent}=${getComputedStyle(node).color}`)
      .join(' ');
  const expected =
    'N=rgb(31, 41, 55) R=rgb(224, 49, 49) B=rgb(25, 113, 194) K=rgb(31, 41, 55)';

  await expect.poll(() => rendered.evaluate(coloredRuns)).toBe(expected);

  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const box = await rendered.boundingBox();
  assertValue(box, 'block box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('.inline-math-editor.is-ready').waitFor();

  // The editable field has to show exactly what the inactive block showed.
  await expect
    .poll(() =>
      page
        .locator('math-field')
        .evaluate(
          (node, read) =>
            node.shadowRoot === null
              ? ''
              : new Function(`return (${read})`)()(node.shadowRoot),
          coloredRuns.toString(),
        ),
    )
    .toBe(expected);
});
