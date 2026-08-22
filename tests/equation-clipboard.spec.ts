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
  // MathLive's own selection boxes are switched off: it sizes them from atom
  // bounds that read the wrapped block as one unwrapped row, which put a long
  // ragged band beside the first line. Only the selected text keeps its tint;
  // the highlight below is ours.
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
  ).toEqual({ background: 'transparent', color: '#1f2937' });
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
  // Highlights are written in the editor's own box, so panning the board has
  // to carry them with the writing. Measured against the shared container they
  // stayed behind, leaving the marks beside the text they were marking.
  // One rectangle per selected line, each sitting on the line it marks. A
  // reading taken while MathLive was rebuilding the field collapsed them into
  // a single tall box, and measuring one tree while positioning against
  // another put them beside the writing entirely.
  const linesCovered = await selectionRects.evaluateAll((rectangles) => {
    const base = document
      .querySelector('math-field')
      ?.shadowRoot?.querySelector('.ML__base');
    const glyphs = [...(base?.children ?? [])]
      .map((child) => child.getBoundingClientRect())
      .filter((bounds) => bounds.width > 0 && bounds.height > 0);
    const rects = rectangles.map((rectangle) =>
      rectangle.getBoundingClientRect(),
    );
    const tallest = Math.max(...rects.map((rect) => rect.height));
    const lineHeight = Math.min(...glyphs.map((glyph) => glyph.height));
    return {
      strays: rects.filter(
        (rect) =>
          !glyphs.some(
            (glyph) =>
              glyph.left < rect.right &&
              glyph.right > rect.left &&
              glyph.top < rect.bottom &&
              glyph.bottom > rect.top,
          ),
      ).length,
      // A box spanning more than one line means the per-line split collapsed.
      spansOneLine: tallest <= lineHeight * 1.5,
    };
  });
  expect(linesCovered).toEqual({ spansOneLine: true, strays: 0 });

  // No highlight runs past the writing on its own line. The first and last
  // lines of a range stop at the caret; the ones between are whole lines.
  const overshoot = await selectionRects.evaluateAll((rectangles) => {
    const base = document
      .querySelector('math-field')
      ?.shadowRoot?.querySelector('.ML__base');
    const lines: { left: number; right: number; top: number }[] = [];
    let current: DOMRect[] = [];
    for (const child of base?.children ?? []) {
      if (child.classList.contains('mixed-text-line-break')) {
        if (current.length > 0) {
          lines.push({
            left: Math.min(...current.map((rect) => rect.left)),
            right: Math.max(...current.map((rect) => rect.right)),
            top: Math.min(...current.map((rect) => rect.top)),
          });
        }
        current = [];
        continue;
      }
      const bounds = child.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) current.push(bounds);
    }
    if (current.length > 0) {
      lines.push({
        left: Math.min(...current.map((rect) => rect.left)),
        right: Math.max(...current.map((rect) => rect.right)),
        top: Math.min(...current.map((rect) => rect.top)),
      });
    }
    return rectangles.filter((rectangle) => {
      const bounds = rectangle.getBoundingClientRect();
      const line = lines.find((entry) => Math.abs(entry.top - bounds.top) < 12);
      return line === undefined || bounds.right > line.right + 2;
    }).length;
  });
  expect(overshoot).toBe(0);

  // Measured against the writing itself, which is the thing the highlight is
  // supposed to stay on top of.
  const offsetsFromWriting = () =>
    selectionRects.evaluateAll((rectangles) => {
      const field = document.querySelector('math-field');
      const origin = field?.getBoundingClientRect();
      return rectangles.map((rectangle) => {
        const bounds = rectangle.getBoundingClientRect();
        return {
          x: Math.round(bounds.left - (origin?.left ?? 0)),
          y: Math.round(bounds.top - (origin?.top ?? 0)),
        };
      });
    });
  const offsetsBeforeScroll = await offsetsFromWriting();
  expect(offsetsBeforeScroll.length).toBeGreaterThan(0);
  await page.mouse.wheel(-120, 90);
  await page.waitForTimeout(200);
  expect(await offsetsFromWriting()).toEqual(offsetsBeforeScroll);

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

test('cuts across rows as one canonical undo transaction', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('chalkboard:input-mode', 'text'),
  );
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');
  await page.mouse.click(bounds.x + 420, bounds.y + 220);
  const field = page.locator('math-field');
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('abc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('def');

  const cutText = await field.evaluate((mathField) => {
    mathField.selection = {
      direction: 'forward',
      ranges: [[1, mathField.lastOffset - 1]],
    };
    const clipboard = new DataTransfer();
    const event = new ClipboardEvent('cut', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'clipboardData', { value: clipboard });
    mathField.dispatchEvent(event);
    return clipboard.getData('text/plain');
  });
  expect(cutText).toBe('bc\nde');
  const published = page.locator('[data-mixed-text-id]').first();
  await expect(published).toHaveAttribute('aria-label', 'af');

  await page.keyboard.press('Control+z');
  await expect(published).toHaveAttribute('aria-label', 'abc\ndef');
  await page.keyboard.press('Control+y');
  await expect(published).toHaveAttribute('aria-label', 'af');
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

test('keeps adjacent formula rows separate when pasting after an empty text atom', async ({
  page,
}) => {
  const first = String.raw`$=\frac{e^{-z}}{1+e^{-z}}\text{}$`;
  const normalizedFirst = String.raw`$=\frac{e^{-z}}{1+e^{-z}}$`;
  const second = String.raw`$=\left(-\frac{1}{1+e^{-z}}\right)\left(-e^{-z}\right)$`;
  await page.addInitScript(() =>
    localStorage.setItem('chalkboard:equation-editing-view', 'source'),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'canvas bounds');
  await page.mouse.click(bounds.x + 360, bounds.y + 170);
  const source = page.getByRole('textbox', { name: 'Block source' });
  await source.fill(first);
  await page.getByRole('button', { name: 'Use rendered editing view' }).click();
  const field = page.locator('math-field');
  await expect(field).toBeFocused();
  await page.getByRole('button', { name: 'Use math input mode' }).click();
  const visualEnd = await field.evaluate((mathField) => {
    const base = mathField.shadowRoot?.querySelector('.ML__base');
    if (!(base instanceof HTMLElement)) {
      throw new Error('Rendered formula has no base');
    }
    const bounds = base.getBoundingClientRect();
    return {
      x: bounds.right - 1,
      y: bounds.top + bounds.height / 2,
    };
  });
  await page.mouse.click(visualEnd.x, visualEnd.y);
  await expect
    .poll(() =>
      field.evaluate((mathField) => ({
        lastOffset: mathField.lastOffset,
        position: mathField.position,
      })),
    )
    .toEqual(
      await field.evaluate((mathField) => ({
        lastOffset: mathField.lastOffset,
        position: mathField.lastOffset,
      })),
    );
  await page.keyboard.press('Enter');
  await field.evaluate((mathField, text) => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (format: string) => (format === 'text/plain' ? text : ''),
      },
    });
    mathField.dispatchEvent(event);
  }, second);

  await expect
    .poll(() =>
      page.locator('[data-mixed-text-id]').first().getAttribute('aria-label'),
    )
    .toBe(`${normalizedFirst}\n${second}`);
  await expect
    .poll(() =>
      field.evaluate(
        (mathField) =>
          mathField.shadowRoot?.querySelectorAll('.mixed-text-line-break')
            .length ?? 0,
      ),
    )
    .toBe(1);
});

test('keeps formula rows separate after re-entering a committed one-line block', async ({
  page,
}) => {
  const first = String.raw`$=\frac{e^{-z}}{1+e^{-z}}\text{}$`;
  const normalizedFirst = String.raw`$=\frac{e^{-z}}{1+e^{-z}}$`;
  const committedFirst = String.raw`=\frac{e^{-z}}{1+e^{-z}}\text{}`;
  const second = String.raw`$=\left(-\frac{1}{1+e^{-z}}\right)\left(-e^{-z}\right)$`;
  const expected = `${normalizedFirst}\n${second}`;
  await page.addInitScript(() => {
    localStorage.setItem('chalkboard:equation-editing-view', 'rendered');
    localStorage.setItem('chalkboard:input-mode', 'math');
  });
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'canvas bounds');
  await page.mouse.click(bounds.x + 360, bounds.y + 170);
  const field = page.locator('math-field');
  await page.locator('.inline-math-editor.is-ready').waitFor();
  const paste = async (text: string) =>
    field.evaluate((mathField, pastedSource) => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (format: string) =>
            format === 'text/plain' ? pastedSource : '',
        },
      });
      mathField.dispatchEvent(event);
    }, text);

  await paste(first);
  await expect
    .poll(() =>
      page.locator('[data-mixed-text-id]').first().getAttribute('aria-label'),
    )
    .toBe(committedFirst);
  await finishEditing(page);

  const committed = page.locator('[data-mixed-text-id]').first();
  await expect(committed).toBeVisible();
  const committedSource = await committed.getAttribute('aria-label');
  assertValue(committedSource, 'committed formula source');
  expect(committedSource).not.toContain('\n');
  const committedBase = committed.locator('.ML__base');
  const committedBounds = await committedBase.boundingBox();
  assertValue(committedBounds, 'committed formula bounds');
  await page.mouse.click(
    committedBounds.x + committedBounds.width - 1,
    committedBounds.y + committedBounds.height / 2,
  );
  await expect(field).toBeFocused();
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await expect
    .poll(() =>
      field.evaluate((mathField) => ({
        lastOffset: mathField.lastOffset,
        position: mathField.position,
      })),
    )
    .toEqual(
      await field.evaluate((mathField) => ({
        lastOffset: mathField.lastOffset,
        position: mathField.lastOffset,
      })),
    );

  await field.press('Enter');
  await page.waitForTimeout(100);
  await expect
    .poll(() =>
      field.evaluate(
        (mathField) =>
          mathField.shadowRoot?.querySelectorAll('.mixed-text-line-break')
            .length ?? 0,
      ),
    )
    .toBe(1);
  await paste(second);
  await page.waitForTimeout(100);
  await expect
    .poll(() =>
      page.locator('[data-mixed-text-id]').first().getAttribute('aria-label'),
    )
    .toBe(expected);
  await expect
    .poll(() =>
      field.evaluate(
        (mathField) =>
          mathField.shadowRoot?.querySelectorAll('.mixed-text-line-break')
            .length ?? 0,
      ),
    )
    .toBe(1);

  await page.keyboard.press('Control+e');
  const source = page.getByRole('textbox', { name: 'Block source' });
  await expect(source).toHaveValue(expected);
  await expect
    .poll(() => source.evaluate((editor) => editor.selectionStart))
    .toBe(expected.length);
  await page.keyboard.press('Control+e');
  await expect(field).toBeFocused();
  await expect
    .poll(() =>
      field.evaluate((mathField) => ({
        lastOffset: mathField.lastOffset,
        position: mathField.position,
      })),
    )
    .toEqual(
      await field.evaluate((mathField) => ({
        lastOffset: mathField.lastOffset,
        position: mathField.lastOffset,
      })),
    );
});

test('orders Enter before paste while rendered editing becomes ready', async ({
  page,
}) => {
  const first = 'first line';
  const second = 'x+1';
  const expected = `${first}\n$${second}$`;
  await page.addInitScript(() => {
    localStorage.setItem('chalkboard:equation-editing-view', 'source');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'canvas bounds');
  await page.mouse.click(bounds.x + 360, bounds.y + 170);
  const source = page.getByRole('textbox', { name: 'Block source' });
  await source.fill(first);
  const field = page.locator('math-field');

  // Keep the mode transition and both edits in one browser turn. Before the
  // ordered readiness queue, Enter was buffered while paste ran immediately;
  // Enter then replayed at the new end and left one combined formula followed
  // by a trailing blank row.
  await page
    .getByRole('button', { name: 'Use rendered editing view' })
    .evaluate((button, pastedSource) => {
      button.click();
      const mathField = document.querySelector('math-field');
      if (mathField === null) throw new Error('Math field is unavailable');
      mathField.position = mathField.lastOffset;
      mathField.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Enter',
        }),
      );
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: {
          getData: (format: string) =>
            format === 'text/plain' ? pastedSource : '',
        },
      });
      mathField.dispatchEvent(paste);
    }, second);

  await page.locator('.inline-math-editor.is-ready').waitFor();
  await expect
    .poll(() =>
      page.locator('[data-mixed-text-id]').first().getAttribute('aria-label'),
    )
    .toBe(expected);
  await expect
    .poll(() =>
      field.evaluate(
        (mathField) =>
          mathField.shadowRoot?.querySelectorAll('.mixed-text-line-break')
            .length ?? 0,
      ),
    )
    .toBe(1);
  await expect
    .poll(() => field.evaluate((mathField) => mathField.mode))
    .toBe('math');

  await page.getByRole('button', { name: 'Use source editing view' }).click();
  await expect(source).toHaveValue(expected);
  await expect
    .poll(() => source.evaluate((editor) => editor.selectionStart))
    .toBe(expected.length);
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

test('treats one multiline paste as one undo transaction', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('chalkboard:equation-editing-view', 'rendered');
    localStorage.setItem('chalkboard:input-mode', 'math');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );

  const field = page.locator('math-field');
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await field.evaluate((mathField) => {
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => 'x\ny\nz' },
    });
    mathField.dispatchEvent(paste);
  });
  const published = page.locator('[data-mixed-text-id]').first();
  await expect(published).toHaveAttribute('aria-label', '$x$\n$y$\n$z$');

  await page.keyboard.press('Control+z');
  await expect
    .poll(() => field.evaluate((mathField) => mathField.value))
    .toBe('');
  await page.keyboard.press('Control+y');
  await expect(published).toHaveAttribute('aria-label', '$x$\n$y$\n$z$');
  await expect
    .poll(() =>
      field.evaluate(
        (mathField) =>
          mathField.shadowRoot?.querySelectorAll('.mixed-text-line-break')
            .length ?? 0,
      ),
    )
    .toBe(2);
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
