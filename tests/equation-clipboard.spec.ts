/** Visible copy/paste behavior within and across prose, math regions, equations, and external plain text. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import {
  activeMathLatex,
  canvasBounds,
  createEmptyMathRegion,
  finishEditing,
} from './helpers/equationEditor';
test('selects and copies text across multiline rows with the mouse', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 420, bounds.y + 220);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('abcdef');
  await page.keyboard.press('Enter');
  await page.keyboard.type('uvwxyz');
  await page.keyboard.press('Enter');
  await page.keyboard.type('123456');

  const rendered = page.getByRole('group', {
    name: 'abcdef\nuvwxyz\n123456',
  });
  const mathField = page.locator('math-field');
  await expect(rendered.locator('.mixed-text-line-break')).toHaveCount(2);
  await expect
    .poll(() =>
      mathField.evaluate(
        (field) =>
          field.shadowRoot?.querySelectorAll('.mixed-text-line-break').length ??
          0,
      ),
    )
    .toBe(2);
  const boundaryPoint = async (line: string, offset: number) => {
    const text = rendered.locator('.ML__text').filter({
      hasText: new RegExp(`^${line}$`),
    });
    await expect(text).toBeVisible();
    await expect
      .poll(() =>
        text.evaluate((node, boundaryOffset) => {
          const textNode = [...node.childNodes].find(
            (child) => child.nodeType === Node.TEXT_NODE,
          );
          if (!(textNode instanceof Text)) return 0;
          const range = document.createRange();
          range.setStart(textNode, boundaryOffset);
          range.setEnd(textNode, boundaryOffset);
          return range.getBoundingClientRect().x;
        }, offset),
      )
      .toBeGreaterThan(0);
    return text.evaluate((node, boundaryOffset) => {
      const textNode = [...node.childNodes].find(
        (child) => child.nodeType === Node.TEXT_NODE,
      );
      if (!(textNode instanceof Text)) return null;
      const range = document.createRange();
      range.setStart(textNode, boundaryOffset);
      range.setEnd(textNode, boundaryOffset);
      const caret = range.getBoundingClientRect();
      const bounds = node.getBoundingClientRect();
      return { x: caret.x, y: bounds.y + bounds.height / 2 };
    }, offset);
  };

  const start = await boundaryPoint('abcdef', 2);
  const end = await boundaryPoint('123456', 3);
  assertValue(start, 'selection start point');
  assertValue(end, 'selection end point');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(() => mathField.evaluate((field) => field.selectionIsCollapsed))
    .toBe(false);
  expect(
    await mathField.evaluate((field) => {
      const style = getComputedStyle(field);
      return {
        background: style
          .getPropertyValue('--selection-background-color')
          .trim(),
        color: style.getPropertyValue('--selection-color').trim(),
      };
    }),
  ).toEqual({ background: '#dddafe', color: '#1f2937' });
  const selectionRects = page.locator('.inline-math-editor__selection-rect');
  await expect(selectionRects).toHaveCount(3);
  await expect
    .poll(() =>
      selectionRects.evaluateAll((rectangles) =>
        rectangles.every(
          (rectangle) => rectangle.getBoundingClientRect().width > 0,
        ),
      ),
    )
    .toBe(true);
  const copiedText = await mathField.evaluate((field) => {
    const clipboard = new DataTransfer();
    const event = new ClipboardEvent('copy', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'clipboardData', { value: clipboard });
    field.dispatchEvent(event);
    return clipboard.getData('text/plain');
  });
  expect(copiedText).toBe('cdef\nuvwxyz\n123');
  const contextMenuPrevented = await mathField.evaluate((field) => {
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    return !field.dispatchEvent(event) && event.defaultPrevented;
  });
  expect(contextMenuPrevented).toBe(true);
  await expect(page.locator('[role="menu"]')).toHaveCount(0);

  await page.keyboard.press('Backspace');
  await expect(selectionRects).toHaveCount(0);
  await expect
    .poll(() => mathField.evaluate((field) => field.selectionIsCollapsed))
    .toBe(true);
  await expect
    .poll(() => mathField.evaluate((field) => field.value))
    .not.toContain('uvwxyz');
});

test('pastes single-line LaTeX source without escaping its syntax', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');
  await createEmptyMathRegion(page, bounds.x + 420, bounds.y + 220);
  const mathField = page.locator('math-field');

  const paste = (text: string) =>
    mathField.evaluate((field, clipboardText) => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (format: string) =>
            format === 'text/plain' ? clipboardText : '',
        },
      });
      field.dispatchEvent(event);
    }, text);

  await paste('a^2=1');
  await expect.poll(() => activeMathLatex(mathField)).toBe('a^2=1');
  await expect
    .poll(() => mathField.evaluate((field) => field.value))
    .not.toContain('textasciicircum');
  await expect
    .poll(() =>
      mathField.evaluate(
        (field) => field.shadowRoot?.querySelectorAll('.ML__error').length ?? 0,
      ),
    )
    .toBe(0);

  await page.keyboard.type('+');
  await paste(String.raw`$b_1$`);
  await expect.poll(() => activeMathLatex(mathField)).toBe('a^2=1+b_1');
});

test('preserves line breaks when pasting into a mixed text block', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 420, bounds.y + 220);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  const mathField = page.locator('math-field');
  await mathField.evaluate((field, text) => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (format: string) => (format === 'text/plain' ? text : ''),
      },
    });
    field.dispatchEvent(event);
  }, 'first line\nsecond line\n\nfourth line');

  await expect(mathField).toHaveJSProperty(
    'value',
    'first line\u2063second line\u2063\u2063fourth line',
  );
  await expect
    .poll(() =>
      mathField.evaluate(
        (field) =>
          field.shadowRoot?.querySelectorAll('.mixed-text-line-break').length ??
          0,
      ),
    )
    .toBe(3);
  await finishEditing(page);
  await expect(
    page.getByRole('group', {
      name: 'first line\nsecond line\n\nfourth line',
    }),
  ).toBeVisible();
});

test('round-trips multiline text through the native clipboard', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  const source = 'line 1\nline 2\na^2+b^2=c^2';
  await page.mouse.click(bounds.x + 340, bounds.y + 200);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('line 1');
  await page.keyboard.press('Enter');
  await page.keyboard.type('line 2');
  await page.keyboard.press('Enter');
  await page.keyboard.type('a^2+b^2=c^2');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');

  await page.mouse.click(bounds.x + 680, bounds.y + 400);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.press('Control+v');
  await expect
    .poll(() =>
      page
        .locator('math-field')
        .evaluate((field) =>
          field.value
            .replaceAll(String.fromCodePoint(0x2063), '\n')
            .replaceAll(/\\textasciicircum\s?/g, '^'),
        ),
    )
    .toBe(source);

  await finishEditing(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          JSON.parse(
            localStorage.getItem(
              `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
            ) ?? '[]',
          ) as { source?: string }[]
        ).map((element) => element.source),
      ),
    )
    .toEqual([source, source]);
});

test('undoes and redoes active multiline math edits without collapsing lines', async ({
  page,
}) => {
  const originalSource = 'first line\nsecond line\nthird line\nfourth line';
  await page.addInitScript((source) => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 22,
          height: 112,
          id: 'undo-multiline-block',
          opacity: 1,
          rotation: 0,
          source,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 130,
          x: -180,
          y: -100,
        },
      ]),
    );
  }, originalSource);
  await page.goto('/');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const rendered = page.locator('[data-mixed-text-id="undo-multiline-block"]');
  await expect(rendered).toHaveAttribute('aria-label', originalSource);
  const bounds = await rendered.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.click(
    bounds.x + bounds.width - 2,
    bounds.y + bounds.height - 4,
  );
  const field = page.locator('math-field');
  await expect(field).toBeFocused();

  await page.keyboard.press('Control+m');
  const positionBeforeEdit = await field.evaluate(
    (mathField) =>
      new Promise<number>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(mathField.position)),
        );
      }),
  );
  await page.keyboard.type('z');
  await expect.poll(() => rendered.getAttribute('aria-label')).toContain('$z$');
  const positionAfterEdit = await field.evaluate(
    (mathField) => mathField.position,
  );
  const editedSource = await rendered.getAttribute('aria-label');
  assertValue(editedSource, 'edited source');

  await page.keyboard.press('Control+z');
  await expect(rendered).toHaveAttribute('aria-label', originalSource);
  await expect
    .poll(() => field.evaluate((mathField) => mathField.position))
    .toBe(positionBeforeEdit);
  await page.keyboard.press('Control+Shift+z');
  await expect(rendered).toHaveAttribute('aria-label', editedSource ?? '');
  await expect
    .poll(() => field.evaluate((mathField) => mathField.position))
    .toBe(positionAfterEdit);

  const editedBounds = await rendered.boundingBox();
  assertValue(editedBounds, 'edited element bounds');
  await page.mouse.move(editedBounds.x + 8, editedBounds.y + 8);
  await page.mouse.down();
  await page.mouse.move(
    editedBounds.x + editedBounds.width - 8,
    editedBounds.y + editedBounds.height - 8,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(rendered).toHaveAttribute('aria-label', editedSource ?? '');
  await page.keyboard.press('Control+m');
  await page.keyboard.press('Control+m');
  await expect(rendered).toHaveAttribute('aria-label', editedSource ?? '');

  await page.keyboard.press('Control+z');
  await expect(rendered).toHaveAttribute('aria-label', originalSource);
  await page.keyboard.press('Control+Shift+z');
  await expect(rendered).toHaveAttribute('aria-label', editedSource ?? '');

  await page.keyboard.press('Control+m');
  await page.keyboard.type('!');
  const textEditedSource = `${editedSource ?? ''}!`;
  await expect(rendered).toHaveAttribute('aria-label', textEditedSource);
  await page.keyboard.press('Control+z');
  await expect(rendered).toHaveAttribute('aria-label', editedSource ?? '');
  await page.keyboard.press('Control+Shift+z');
  await expect(rendered).toHaveAttribute('aria-label', textEditedSource);

  await expect
    .poll(() =>
      field.evaluate((mathField) => {
        const markers = [
          ...(mathField.shadowRoot?.querySelectorAll(
            '.mixed-text-line-break',
          ) ?? []),
        ];
        return {
          count: markers.length,
          hasOnlyLineBreakMarkers: markers.every(
            (marker) => marker.textContent === '\u2063',
          ),
          rows: new Set(
            markers.map((marker) => marker.getBoundingClientRect().y),
          ).size,
        };
      }),
    )
    .toEqual({ count: 3, hasOnlyLineBreakMarkers: true, rows: 3 });
});

test('moves the caret vertically between multiline rows', async ({ page }) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 420, bounds.y + 220);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('abcdef');
  await page.keyboard.press('Enter');
  await page.keyboard.type('xy');
  await page.keyboard.press('Enter');
  await page.keyboard.type('123456');

  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.type('!');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('!');
  await finishEditing(page);

  await expect(
    page.getByRole('group', {
      name: 'abcdef!\nxy\n123456!',
    }),
  ).toBeVisible();
});

test('types backslashes literally in text mode', async ({ page }) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 420, bounds.y + 240);
  await expect(page.locator('.inline-math-editor')).toHaveClass(/is-ready/);
  const literalText = String.raw`path\to\file \$5 \frac{x}{y}`;
  await page.keyboard.type(literalText);
  const activeBackslashes = page
    .locator('math-field')
    .locator('.mixed-text-literal-backslash');
  await expect(activeBackslashes).toHaveCount(4);
  await expect
    .poll(() =>
      activeBackslashes
        .first()
        .evaluate((element) =>
          getComputedStyle(element, '::after').content.includes('\\'),
        ),
    )
    .toBe(true);

  await finishEditing(page);
  const block = page.getByRole('group', { name: literalText });
  await expect(block).toBeVisible();
  const renderedBackslashes = block.locator('.mixed-text-literal-backslash');
  await expect(renderedBackslashes).toHaveCount(4);
  await expect
    .poll(() =>
      renderedBackslashes
        .first()
        .evaluate((element) =>
          getComputedStyle(element, '::after').content.includes('\\'),
        ),
    )
    .toBe(true);
  await expect(block.locator('.mixed-text-literal-dollar')).toHaveCount(1);
  await expect(block.locator('.ML__mathit, .ML__frac-line')).toHaveCount(0);
});

test('types dollar signs literally without changing input mode', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 420, bounds.y + 240);
  await expect(page.locator('.inline-math-editor')).toHaveClass(/is-ready/);
  await page.keyboard.type('Price \\$5 and $$plain text');
  await finishEditing(page);

  const source = String.raw`Price \$5 and $$plain text`;
  const block = page.getByRole('group', { name: source });
  await expect(block).toBeVisible();
  await expect(block.locator('.mixed-text-literal-backslash')).toHaveCount(1);
  const literalDollar = block.locator('.mixed-text-literal-dollar');
  await expect(literalDollar).toHaveCount(3);
  await expect
    .poll(() =>
      literalDollar
        .first()
        .evaluate((element) => getComputedStyle(element, '::after').content),
    )
    .toBe('"$"');
  await expect(block.locator('.ML__mathit')).toHaveCount(0);
});
