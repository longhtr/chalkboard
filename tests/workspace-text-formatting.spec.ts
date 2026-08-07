/** Bold/italic mixed-text formatting across selection, future typing, mode changes, history, and reload. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import * as workspace from './helpers/workspace';

test('toggles bold and italic formatting for mixed text selections and typing', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const regular = page.getByRole('button', { name: 'Use regular text' });
  const bold = page.getByRole('button', { name: 'Toggle bold text' });
  const italic = page.getByRole('button', { name: 'Toggle italic text' });
  await expect(regular).toHaveAttribute('aria-pressed', 'true');
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  await expect(italic).toHaveAttribute('aria-pressed', 'false');
  await bold.click();
  await italic.click();
  await regular.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  await expect(italic).toHaveAttribute('aria-pressed', 'false');
  await bold.click();

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  await page.mouse.click(bounds.x + 430, bounds.y + 280);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  const field = page.locator('math-field');
  await expect(field.locator('#excalifont-mathlive-adapter')).toHaveCount(1);
  await page.keyboard.type('Bold');
  await italic.click();
  await page.keyboard.type('Both');
  await expect
    .poll(() =>
      field.locator('.ML__text.ML__bold.ML__it').evaluateAll((runs) => ({
        hasBoth: runs
          .map((run) => run.textContent)
          .join('')
          .includes('Both'),
        italic: runs.every(
          (run) => getComputedStyle(run).fontStyle === 'italic',
        ),
        usesExcalifontAdapter: runs.every((run) => {
          const family = getComputedStyle(run).fontFamily;
          return (
            family.includes('KaTeX_Main') && !family.includes('KaTeX_SansSerif')
          );
        }),
        weight: runs.every(
          (run) => Number(getComputedStyle(run).fontWeight) >= 600,
        ),
      })),
    )
    .toEqual({
      hasBoth: true,
      italic: true,
      usesExcalifontAdapter: true,
      weight: true,
    });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const style = document.querySelector<HTMLStyleElement>(
          '#chalkboard-font-faces',
        );
        return {
          choice: style?.dataset.workspaceFont,
          faces:
            style?.sheet === null || style?.sheet === undefined
              ? 0
              : [...style.sheet.cssRules].filter(
                  (rule) => rule instanceof CSSFontFaceRule,
                ).length,
        };
      }),
    )
    .toEqual({ choice: 'excalifont', faces: 20 });
  await bold.click();
  await page.keyboard.type('Italic');

  for (let index = 0; index < 'Italic'.length; index += 1) {
    await page.keyboard.press('Shift+ArrowLeft');
  }
  await expect(italic).toHaveAttribute('aria-pressed', 'true');
  await italic.click();
  await expect(italic).toHaveAttribute('aria-pressed', 'false');
  await expect(regular).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('Plain');
  await expect(field).toHaveJSProperty(
    'value',
    String.raw`\textbf{Bold\textit{Both}}ItalicPlain`,
  );

  await page.keyboard.press('Control+m');
  await expect(page.getByRole('group', { name: 'Text style' })).toHaveCount(0);
  await page.keyboard.type('x');
  await page.getByRole('button', { name: 'Selection tool' }).click();

  const rendered = page.getByRole('group', {
    name: 'BoldBothItalicPlain$x$',
  });
  await expect(rendered).toBeVisible();
  await expect(rendered.locator('.ML__bold')).not.toHaveCount(0);
  await expect(rendered.locator('.ML__it')).not.toHaveCount(0);
  await expect
    .poll(() =>
      rendered
        .locator('.ML__text.ML__bold.ML__it', { hasText: 'Both' })
        .evaluate((run) => {
          const style = getComputedStyle(run);
          return {
            fontStyle: style.fontStyle,
            fontWeight: Number(style.fontWeight),
            usesExcalifontAdapter:
              style.fontFamily.includes('KaTeX_Main') &&
              !style.fontFamily.includes('KaTeX_SansSerif'),
          };
        }),
    )
    .toEqual({
      fontStyle: 'italic',
      fontWeight: 700,
      usesExcalifontAdapter: true,
    });
  await expect(rendered).not.toContainText('textbf');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { source?: string }[];
        return elements[0]?.source;
      }),
    )
    .toBe(String.raw`\textbf{Bold}\textbf{\textit{Both}}ItalicPlain$x$`);
});

test('applies text styles around math without styling the math run', async ({
  page,
}) => {
  const source = 'before $x^2$ after';
  await page.addInitScript((mixedSource) => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 32,
          height: 70,
          id: 'style-across-math',
          lineSpacing: 1.2,
          opacity: 1,
          rotation: 0,
          source: mixedSource,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 320,
          x: -120,
          y: -30,
        },
      ]),
    );
  }, source);
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const rendered = page.locator('[data-mixed-text-id="style-across-math"]');
  const bounds = await rendered.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  const field = page.locator('math-field');
  await expect(field).toBeFocused();
  await workspace.waitForPaint(page);
  await field.evaluate((mathField) => {
    mathField.selection = {
      direction: 'forward',
      ranges: [[0, mathField.lastOffset]],
    };
  });
  await expect
    .poll(() => field.evaluate((mathField) => mathField.selectionIsCollapsed))
    .toBe(false);
  const bold = page.getByRole('button', { name: 'Toggle bold text' });
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  await bold.click();
  await expect
    .poll(() => field.evaluate((mathField) => mathField.value))
    .toContain('\\textbf');

  const expectedSource = String.raw`\textbf{before }$x^2$\textbf{ after}`;
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { source?: string }[];
        return elements[0]?.source;
      }),
    )
    .toBe(expectedSource);
  await expect(page.getByRole('group', { name: source })).toBeVisible();
  await expect(rendered.locator('.ML__mathit')).toHaveCount(1);
  await expect
    .poll(() =>
      rendered
        .locator('.ML__mathit')
        .evaluate((node) => getComputedStyle(node).fontWeight),
    )
    .not.toBe('700');

  await page.reload();
  await expect(page.getByRole('group', { name: source })).toBeVisible();
});

test('round-trips text styles through multiline selection, re-entry, undo, redo, and reload', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');

  await page.mouse.click(bounds.x + 430, bounds.y + 280);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  const field = page.locator('math-field');
  const regular = page.getByRole('button', { name: 'Use regular text' });
  const bold = page.getByRole('button', { name: 'Toggle bold text' });
  const italic = page.getByRole('button', { name: 'Toggle italic text' });
  await page.keyboard.type('First');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  await field.evaluate((mathField) => {
    mathField.selection = {
      direction: 'none',
      ranges: [[0, mathField.lastOffset]],
    };
  });
  await italic.click();
  await bold.click();
  await expect
    .poll(() =>
      field.evaluate((mathField) => ({
        bold: mathField.queryStyle({ fontSeries: 'b' }),
        italic: mathField.queryStyle({ fontShape: 'it' }),
      })),
    )
    .toEqual({ bold: 'all', italic: 'all' });
  await expect(field.locator('.ML__bold')).not.toHaveCount(0);
  await expect(field.locator('.ML__it')).not.toHaveCount(0);

  const copied = await field.evaluate((mathField) => {
    const clipboard = new DataTransfer();
    const event = new ClipboardEvent('copy', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'clipboardData', { value: clipboard });
    mathField.dispatchEvent(event);
    return clipboard.getData('text/plain');
  });
  expect(copied).toBe('First\nSecond');

  await regular.click();
  await expect
    .poll(() =>
      field.evaluate((mathField) => ({
        bold: mathField.queryStyle({ fontSeries: 'b' }),
        italic: mathField.queryStyle({ fontShape: 'it' }),
      })),
    )
    .toEqual({ bold: 'none', italic: 'none' });
  await page.keyboard.press('Control+z');
  await expect(field.locator('.ML__bold')).not.toHaveCount(0);
  await expect(field.locator('.ML__it')).not.toHaveCount(0);
  await expect
    .poll(() =>
      field.evaluate((mathField) => {
        const markers = new Set(['\u2066', '\u2067', '\u2068', '\u2069']);
        const ranges: [number, number][] = [];
        let start = 0;
        for (let offset = 0; offset <= mathField.lastOffset; offset += 1) {
          const value =
            offset < mathField.lastOffset
              ? mathField.getValue([offset, offset + 1])
              : '';
          if (offset < mathField.lastOffset && !markers.has(value)) continue;
          if (offset > start) ranges.push([start, offset]);
          start = offset + 1;
        }
        const originalSelection = mathField.selection;
        const styled = ranges.every((range) => {
          mathField.selection = { direction: 'none', ranges: [range] };
          return (
            mathField.queryStyle({ fontSeries: 'b' }) === 'all' &&
            mathField.queryStyle({ fontShape: 'it' }) === 'all'
          );
        });
        mathField.selection = originalSelection;
        return ranges.length > 0 && styled;
      }),
    )
    .toBe(true);
  await page.keyboard.press('Control+y');
  await expect(field.locator('.ML__bold')).toHaveCount(0);
  await expect(field.locator('.ML__it')).toHaveCount(0);
  await field.evaluate((mathField) => {
    mathField.selection = {
      direction: 'none',
      ranges: [[0, mathField.lastOffset]],
    };
  });
  await expect
    .poll(() =>
      field.evaluate((mathField) => ({
        bold: mathField.queryStyle({ fontSeries: 'b' }),
        italic: mathField.queryStyle({ fontShape: 'it' }),
      })),
    )
    .toEqual({ bold: 'none', italic: 'none' });

  await italic.click();
  await page.getByRole('button', { name: 'Selection tool' }).click();
  const rendered = page.getByRole('group', { name: 'First\nSecond' });
  await expect(rendered).toBeVisible();
  await expect(rendered.locator('.ML__it')).not.toHaveCount(0);
  await expect(rendered.locator('.ML__bold')).toHaveCount(0);

  const renderedBounds = await rendered.boundingBox();
  assertValue(renderedBounds, 'rendered multiline text bounds');
  await workspace.selectMixedTextTool(page);
  await page.mouse.click(
    renderedBounds.x + renderedBounds.width - 2,
    renderedBounds.y + renderedBounds.height - 2,
  );
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await expect(field).toBeFocused();
  await expect(field).not.toContainText('textit');
  await expect(field.locator('.ML__it')).not.toHaveCount(0);
  await field.evaluate((mathField) => {
    const italicEndMarker = Array.from(
      { length: mathField.lastOffset },
      (_, offset) => offset,
    ).findLast(
      (offset) => mathField.getValue([offset, offset + 1]) === '\u2069',
    );
    if (italicEndMarker !== undefined) mathField.position = italicEndMarker;
  });
  for (let index = 0; index < 'Second'.length; index += 1) {
    await page.keyboard.press('Shift+ArrowLeft');
  }
  await expect(italic).toHaveAttribute('aria-pressed', 'true');
  await expect(bold).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: 'Selection tool' }).click();
  await page.reload();
  const reloaded = page.getByRole('group', { name: 'First\nSecond' });
  await expect(reloaded.locator('.ML__it')).not.toHaveCount(0);
  await expect(reloaded.locator('.ML__bold')).toHaveCount(0);
});

test('hides future-only text controls for an inactive block selection', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  await page.mouse.click(bounds.x + 440, bounds.y + 280);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('Selected block');
  await page.getByRole('button', { name: 'Selection tool' }).click();

  const panel = page.getByRole('complementary', { name: 'Element style' });
  await expect(panel.locator('.panel-label')).toHaveText([
    'Text size',
    'Line spacing',
  ]);
  await expect(panel.getByRole('group', { name: 'Input mode' })).toHaveCount(0);
  await expect(panel.getByRole('group', { name: 'Text style' })).toHaveCount(0);
  await expect(panel.getByText('Text color')).toHaveCount(0);
});
