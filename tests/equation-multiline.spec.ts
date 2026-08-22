/** Complete multiline equation behavior: breaks, movement, selection, styles, history, persistence, and rendering. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import {
  canvasBounds,
  createEmptyMathRegion,
  finishEditing,
} from './helpers/equationEditor';

import {
  activeMathFieldGlyphPoint,
  activeMathFieldTextBoundaryPoint,
  clickMathFieldAtPagePoint,
} from './helpers/mathField';
test('creates a mixed text block by clicking empty canvas', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 420, bounds.y + 240);
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();
  await expect(page.locator('.inline-math-editor')).toHaveClass(/is-ready/);
  await page.keyboard.type('Area is ');
  await page.keyboard.press('Control+m');
  await page.keyboard.type('A=\\pi r^2');
  await page.keyboard.press('Control+m');
  await page.keyboard.type(' square units.');
  await finishEditing(page);

  const block = page.getByRole('group', {
    name: String.raw`Area is $A=\pi r^2$ square units.`,
  });
  await expect(block).toBeVisible();
  const mathBounds = await block.locator('.ML__mathit').last().boundingBox();
  assertValue(mathBounds, 'rendered math bounds');
  await page.mouse.click(
    mathBounds.x + mathBounds.width / 2,
    mathBounds.y + mathBounds.height / 2,
  );
  await expect(page.locator('math-field')).toBeFocused();
});

test('preserves published rows when selection follows silent focus normalization', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 420, bounds.y + 240);
  const field = page.locator('math-field');
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('First');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Third');
  await expect(page.locator('.math-element')).toHaveAttribute(
    'aria-label',
    'First\nSecond\nThird',
  );

  // Reproduce a browser/MathLive focus normalization that changes the field
  // without an input event immediately before the toolbar receives focus.
  await field.evaluate((mathField) => {
    mathField.setValue('FirstSecondThird', {
      mode: 'text',
      silenceNotifications: true,
    });
  });
  const selectionTool = page.getByRole('button', { name: 'Selection tool' });
  await selectionTool.click();
  await expect(selectionTool).toHaveAttribute('aria-pressed', 'true');

  const rendered = page.getByRole('group', {
    name: 'First\nSecond\nThird',
  });
  await expect(rendered.locator('.mixed-text-line-break')).toHaveCount(2);
  await expect
    .poll(async () => {
      const rows = await rendered
        .locator('.ML__text')
        .filter({ hasText: /^(First|Second|Third)$/ })
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getBoundingClientRect().y),
        );
      return (
        rows.length === 3 &&
        (rows[1] ?? 0) - (rows[0] ?? 0) > 20 &&
        (rows[2] ?? 0) - (rows[1] ?? 0) > 20
      );
    })
    .toBe(true);
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
    .toBe('First\nSecond\nThird');
});

test('switches input mode from the mixed text tool or Control+M', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 420, bounds.y + 240);
  const mathField = page.locator('math-field');
  const editor = page.locator('.inline-math-editor');
  const modeIndicator = page.locator('.mixed-text-tool-mode');
  await expect(editor).toHaveClass(/is-ready/);
  await expect(editor).toHaveCSS('outline-style', 'none');
  await expect(modeIndicator).toHaveText('T');

  await page.keyboard.type('Value ');
  await page.keyboard.press('Control+m');
  await expect
    .poll(() => mathField.evaluate((field) => field.mode))
    .toBe('math');
  await expect(modeIndicator).toHaveText('M');
  await expect
    .poll(() => mathField.evaluate((field) => field.value))
    .toBe('Value ');
  await expect
    .poll(() =>
      mathField.evaluate(
        (field) =>
          field.shadowRoot?.querySelectorAll('.ML__placeholder-selected')
            .length ?? 0,
      ),
    )
    .toBe(0);

  await page.keyboard.type('x');
  await page.keyboard.press('Space');
  await expect
    .poll(() => mathField.evaluate((field) => field.mode))
    .toBe('math');
  await expect(modeIndicator).toHaveText('M');
  await page.keyboard.type('y');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  await expect
    .poll(() => mathField.evaluate((field) => field.mode))
    .toBe('text');
  await expect(modeIndicator).toHaveText('T');
  await page.keyboard.type(' after');
  const firstLineHeight = await mathField.evaluate(
    (field) => field.getBoundingClientRect().height,
  );
  await page.keyboard.press('Enter');
  await expect(mathField).toBeFocused();
  await page.keyboard.type('next line');
  await expect
    .poll(() =>
      mathField.evaluate((field) => field.getBoundingClientRect().height),
    )
    .toBeGreaterThan(firstLineHeight);
  await expect
    .poll(() =>
      mathField.evaluate(
        (field) =>
          [...(field.shadowRoot?.querySelectorAll('.ML__text') ?? [])].filter(
            (node) =>
              getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)',
          ).length,
      ),
    )
    .toBe(0);
  await finishEditing(page);

  const rendered = page.getByRole('group', {
    name: 'Value $xy$ after\nnext line',
  });
  await expect(rendered).toBeVisible();
  await expect(rendered.locator('.mixed-text-line-break')).toHaveCount(1);

  const mathBounds = await rendered
    .locator('.ML__mathit')
    .first()
    .boundingBox();
  assertValue(mathBounds, 'rendered math bounds');
  await page.mouse.click(
    mathBounds.x + mathBounds.width / 2,
    mathBounds.y + mathBounds.height / 2,
  );
  await expect(page.locator('.inline-math-editor')).toHaveClass(/is-ready/);
  await expect(modeIndicator).toHaveText('T');
  await expect
    .poll(() =>
      mathField.evaluate(
        (field) =>
          field.shadowRoot?.querySelectorAll('.mixed-text-line-break').length ??
          0,
      ),
    )
    .toBe(1);
});

test('keeps the math caret geometry stable when Escape is pressed', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');
  await createEmptyMathRegion(page, bounds.x + 420, bounds.y + 240);
  const mathField = page.locator('math-field');

  await page.keyboard.type('\\frac');
  await page.keyboard.press('Space');
  await page.keyboard.type('x');
  const caretState = () =>
    mathField.evaluate((field) => {
      const caret = field.shadowRoot?.querySelector(
        '.ML__caret, .ML__text-caret, .ML__latex-caret',
      );
      if (!(caret instanceof HTMLElement)) return null;
      const bounds = caret.getBoundingClientRect();
      const pseudoStyle = getComputedStyle(caret, '::after');
      return {
        caretClass: caret.className,
        caretHeight: bounds.height,
        mode: field.mode,
        position: field.position,
        pseudoHeight: pseudoStyle.height,
        selection: field.selection,
        value: field.value,
      };
    });
  const before = await caretState();
  assertValue(before, 'element bounds before resize');

  await page.keyboard.press('Escape');

  await expect(mathField).toBeFocused();
  await expect.poll(caretState).toEqual(before);
});

test('uses one global input mode across blocks and newlines', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  const mathField = page.locator('math-field');
  const modeIcon = page.locator('.mixed-text-tool-mode');
  await page.mouse.click(bounds.x + 360, bounds.y + 220);
  await expect(page.locator('.inline-math-editor')).toHaveClass(/is-ready/);
  await page.keyboard.type('first');
  await page.keyboard.press('Control+m');
  await page.keyboard.type('x');
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await page.keyboard.type('y');
  await expect(modeIcon).toHaveText('M');
  await finishEditing(page);

  await page.mouse.click(bounds.x + 650, bounds.y + 380);
  await expect(mathField).toBeFocused();
  await expect(modeIcon).toHaveText('M');
  await page.keyboard.press('Control+m');
  await page.keyboard.type('second');
  await finishEditing(page);

  const first = page.getByRole('group', { name: 'first$x$\n$y$' });
  const firstBounds = await first.boundingBox();
  assertValue(firstBounds, 'first element bounds');
  await page.mouse.click(firstBounds.x + 3, firstBounds.y + 3);
  await expect(mathField).toBeFocused();
  await expect(modeIcon).toHaveText('T');
  await page.keyboard.press('Control+m');
  await expect(modeIcon).toHaveText('M');
  await finishEditing(page);

  const second = page.getByRole('group', { name: 'second' });
  const secondBounds = await second.boundingBox();
  assertValue(secondBounds, 'second element bounds');
  await page.mouse.click(secondBounds.x + 3, secondBounds.y + 3);
  await expect(mathField).toBeFocused();
  await expect(modeIcon).toHaveText('M');

  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          JSON.parse(
            localStorage.getItem(
              `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
            ) ?? '[]',
          ) as Record<string, unknown>[]
        ).some((element) => 'inputMode' in element),
      ),
    )
    .toBe(false);
});

test('keeps existing text rendered as text when math mode adds a newline', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 420, bounds.y + 220);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('abc');
  await page.keyboard.press('Control+m');
  await page.keyboard.press('Enter');

  await expect(page.locator('.mixed-text-tool-mode')).toHaveText('M');
  const rendered = page.locator('.math-element');
  await expect(rendered.locator('.mixed-text-element__content')).toHaveCount(1);
  await expect(rendered.locator('.ML__mathit', { hasText: 'abc' })).toHaveCount(
    0,
  );
  await expect(
    rendered.locator('.ML__text', { hasText: 'abc' }),
  ).not.toHaveCount(0);

  await page.keyboard.type('x');
  await finishEditing(page);
  await expect(page.getByRole('group', { name: 'abc\n$x$' })).toBeVisible();
});

test('keeps complex equations separated across new lines in math-only mode', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');
  await page
    .getByRole('spinbutton', { name: 'Line spacing input' })
    .fill('2.2');

  await page.mouse.click(bounds.x + 420, bounds.y + 220);
  const field = page.locator('math-field');
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.press('Control+m');

  await page.keyboard.type('\\frac');
  await page.keyboard.press('Space');
  await page.keyboard.type('a');
  await page.keyboard.press('Tab');
  await page.keyboard.type('b');
  await page.keyboard.type('+');
  await page.keyboard.type('\\sqrt');
  await page.keyboard.press('Space');
  await page.keyboard.type('x');
  await page.keyboard.press('Enter');

  await page.keyboard.type('\\sum');
  await page.keyboard.press('Space');
  await page.keyboard.type('_');
  await page.keyboard.type('i=0');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('^');
  await page.keyboard.type('n');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('i');
  await page.keyboard.press('Enter');

  await page.keyboard.type('\\int');
  await page.keyboard.press('Space');
  await page.keyboard.type('_0');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('^1');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('x');
  await page.keyboard.type('\\mathrm');
  await page.keyboard.press('Space');
  await page.keyboard.type('dx');

  await expect(page.locator('.mixed-text-tool-mode')).toHaveText('M');
  await expect
    .poll(() => field.evaluate((mathField) => mathField.mode))
    .toBe('math');
  await expect
    .poll(() =>
      field.evaluate(
        (mathField) =>
          mathField.shadowRoot?.querySelectorAll('.mixed-text-line-break')
            .length ?? 0,
      ),
    )
    .toBe(2);
  await expect
    .poll(() => field.evaluate((mathField) => mathField.value))
    .not.toContain(String.raw`\placeholder{}`);

  await finishEditing(page);
  const rendered = page.locator('[data-mixed-text-id]').filter({
    has: page.locator('.mixed-text-line-break'),
  });
  await expect(rendered).toHaveCount(1);
  await expect(rendered.locator('.mixed-text-line-break')).toHaveCount(2);
  await expect(rendered).not.toHaveClass(/is-error/);
  await expect
    .poll(() =>
      rendered.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          height: bounds.height,
          lineHeight: getComputedStyle(element).lineHeight,
        };
      }),
    )
    .toEqual({ height: expect.any(Number), lineHeight: '66px' });
  const multilineBounds = await rendered.boundingBox();
  assertValue(multilineBounds, 'multiline rendered bounds');
  expect(multilineBounds.height).toBeGreaterThan(130);
  const source = await rendered.getAttribute('aria-label');
  assertValue(source, 'multiline equation source');
  expect(source.split('\n')).toHaveLength(3);
  expect(source.split('\n').every((line) => line.startsWith('$'))).toBe(true);

  const renderedBounds = await rendered.boundingBox();
  assertValue(renderedBounds, 'rendered element bounds');
  await page.mouse.click(
    renderedBounds.x + Math.min(50, renderedBounds.width / 2),
    renderedBounds.y + renderedBounds.height / 2,
  );
  await expect(field).toBeFocused();
  await expect(page.locator('.mixed-text-tool-mode')).toHaveText('M');
  await page.keyboard.type('+z');
  await expect
    .poll(() => field.evaluate((mathField) => mathField.mode))
    .toBe('math');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.type('y');
  await expect
    .poll(() =>
      field.evaluate(
        (mathField) =>
          mathField.shadowRoot?.querySelectorAll('.mixed-text-line-break')
            .length ?? 0,
      ),
    )
    .toBe(2);
  await expect(field).not.toHaveJSProperty('value', source);
  await expect
    .poll(() => field.evaluate((mathField) => mathField.errors.length))
    .toBe(0);
});

test('keeps math mode active after deleting every math character', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 420, bounds.y + 240);
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();
  await expect(page.locator('.inline-math-editor')).toHaveClass(/is-ready/);
  await page.keyboard.type('abc');
  await page.keyboard.press('Control+m');
  await page.keyboard.type('xy');

  const renderedParts = async (source: string) => {
    const block = page.getByRole('group', { name: source });
    await expect(block).toBeVisible();
    return block.evaluate((element) => ({
      contentClass: element.firstElementChild?.className ?? '',
      math: [...element.querySelectorAll('.ML__mathit')]
        .map((node) => node.textContent)
        .join(''),
      text:
        element.querySelector('.ML__text:not(.ML__base)')?.textContent ?? '',
    }));
  };

  expect(await renderedParts('abc$xy$')).toEqual({
    contentClass: 'mixed-text-element__content',
    math: 'xy',
    text: 'abc',
  });

  await page.keyboard.press('Backspace');
  expect(await renderedParts('abc$x$')).toEqual({
    contentClass: 'mixed-text-element__content',
    math: 'x',
    text: 'abc',
  });

  await page.keyboard.press('Backspace');
  await expect
    .poll(() => mathField.evaluate((field) => field.mode))
    .toBe('math');
  expect(await renderedParts('abc')).toEqual({
    contentClass: 'mixed-text-element__content',
    math: '',
    text: 'abc',
  });

  for (const [key, math] of [
    ['d', 'd'],
    ['e', 'de'],
    ['f', 'def'],
  ]) {
    await page.keyboard.type(key);
    await expect
      .poll(() => mathField.evaluate((field) => field.mode))
      .toBe('math');
    expect(await renderedParts(`abc$${math}$`)).toEqual({
      contentClass: 'mixed-text-element__content',
      math,
      text: 'abc',
    });
  }
});

test('preserves consecutive newlines as editable empty lines', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 420, bounds.y + 220);
  const mathField = page.locator('math-field');
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('First');
  await page.keyboard.press('Enter');
  const oneNewlineHeight = await mathField.evaluate(
    (field) => field.getBoundingClientRect().height,
  );
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      mathField.evaluate((field) => field.getBoundingClientRect().height),
    )
    .toBeGreaterThan(oneNewlineHeight + 20);
  await page.keyboard.type('Third');
  await finishEditing(page);

  const source = 'First\n\nThird';
  const rendered = page.getByRole('group', { name: source });
  await expect(rendered).toBeVisible();
  await expect(rendered.locator('.mixed-text-line-break')).toHaveCount(2);
  const lineBounds = await rendered
    .locator('.ML__text')
    .filter({ hasText: /^(First|Third)$/ })
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const bounds = node.getBoundingClientRect();
        return { text: node.textContent, y: bounds.y };
      }),
    );
  const first = lineBounds.find(({ text }) => text === 'First');
  const third = lineBounds.find(({ text }) => text === 'Third');
  assertValue(first, 'first rendered line');
  assertValue(third, 'third rendered line');
  expect(third.y - first.y).toBeGreaterThan(50);

  const renderedBounds = await rendered.boundingBox();
  assertValue(renderedBounds, 'rendered element bounds');
  await page.keyboard.down('Control');
  await page.mouse.move(renderedBounds.x - 12, renderedBounds.y - 12);
  await page.mouse.down();
  await page.mouse.move(
    renderedBounds.x + renderedBounds.width + 12,
    renderedBounds.y + renderedBounds.height + 12,
  );
  await page.mouse.up();
  await page.keyboard.up('Control');

  await expect(rendered.locator('.mixed-text-line-break')).toHaveCount(2);
  await expect
    .poll(async () => {
      const positions = await rendered
        .locator('.ML__text')
        .filter({ hasText: /^(First|Third)$/ })
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getBoundingClientRect().y),
        );
      return positions.length === 2 ? positions[1]! - positions[0]! : 0;
    })
    .toBeGreaterThan(50);
});

test('places the caret at the clicked horizontal position on any row', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds, canvas } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 420, bounds.y + 220);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  const mathField = page.locator('math-field');
  await page.keyboard.type('abcdef');
  await page.keyboard.press('Enter');
  await page.keyboard.type('uvwxyz');
  await page.keyboard.press('Enter');
  await page.keyboard.type('123456');

  const clickTextBoundary = async (
    source: string,
    line: string,
    offset: number,
  ) => {
    const rendered = page.getByRole('group', { name: source });
    await expect(rendered.locator('.mixed-text-line-break')).toHaveCount(2);
    const text = rendered.locator('.ML__text').filter({
      hasText: new RegExp(`^${line}$`),
    });
    await expect(text).toBeVisible();
    if ((await mathField.count()) === 0) {
      const [canvasBounds, textBounds] = await Promise.all([
        canvas.boundingBox(),
        text.boundingBox(),
      ]);
      assertValue(canvasBounds, 'drawing canvas bounds');
      assertValue(textBounds, 'rendered text bounds');
      await canvas.click({
        position: {
          x: textBounds.x + textBounds.width / 2 - canvasBounds.x,
          y: textBounds.y + textBounds.height / 2 - canvasBounds.y,
        },
      });
      await page.locator('.inline-math-editor.is-ready').waitFor();
    }
    const point = await activeMathFieldTextBoundaryPoint(
      mathField,
      line,
      offset,
    );
    await clickMathFieldAtPagePoint(mathField, point);
  };

  const initial = 'abcdef\nuvwxyz\n123456';
  await clickTextBoundary(initial, 'uvwxyz', 3);
  await page.keyboard.type('!');

  const afterSecond = 'abcdef\nuvw!xyz\n123456';
  await clickTextBoundary(afterSecond, 'abcdef', 2);
  await page.keyboard.type('?');
  await finishEditing(page);
  const afterFirst = 'ab?cdef\nuvw!xyz\n123456';
  await expect(page.getByRole('group', { name: afterFirst })).toBeVisible();

  await clickTextBoundary(afterFirst, '123456', 2);
  await page.keyboard.type('!');
  await finishEditing(page);
  await expect(
    page.getByRole('group', { name: 'ab?cdef\nuvw!xyz\n12!3456' }),
  ).toBeVisible();
});

test('places the caret at the nearest character or symbol boundary', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 420, bounds.y + 220);
  const mathField = page.locator('math-field');
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('abcdef');
  const text = page
    .getByRole('group', { name: 'abcdef' })
    .locator('.ML__text:not(.ML__base)')
    .filter({ hasText: /^abcdef$/ });
  await expect
    .poll(() =>
      text.evaluate((node) => {
        const textNode = [...node.childNodes].find(
          (child) => child.nodeType === Node.TEXT_NODE,
        );
        if (!(textNode instanceof Text)) return 0;
        const range = document.createRange();
        range.setStart(textNode, 2);
        range.setEnd(textNode, 3);
        const bounds = range.getBoundingClientRect();
        return bounds.width > 0 ? bounds.x : 0;
      }),
    )
    .toBeGreaterThan(0);
  const characterCenter = await activeMathFieldGlyphPoint(
    mathField,
    '.ML__text',
    'c',
  );
  await clickMathFieldAtPagePoint(mathField, characterCenter);
  await expect
    .poll(() => mathField.evaluate((field) => field.position))
    .toBeGreaterThanOrEqual(2);
  const textPosition = await mathField.evaluate((field) => field.position);
  expect(textPosition).toBeLessThanOrEqual(3);

  await page.keyboard.press('Control+m');
  await page.keyboard.type('xyz');
  const symbol = page
    .locator('[data-mixed-text-id] .ML__mathit')
    .filter({ hasText: /^y$/ });
  await expect(symbol).toBeVisible();
  await expect
    .poll(() => symbol.evaluate((element) => element.getBoundingClientRect().x))
    .toBeGreaterThan(0);
  const symbolCenter = await activeMathFieldGlyphPoint(
    mathField,
    '.ML__mathit',
    'y',
  );
  await clickMathFieldAtPagePoint(mathField, symbolCenter);
  await expect
    .poll(() => mathField.evaluate((field) => field.position))
    .toBeGreaterThan(textPosition);
  const { lastOffset, position: mathPosition } = await mathField.evaluate(
    (field) => ({ lastOffset: field.lastOffset, position: field.position }),
  );
  expect(mathPosition).toBeLessThan(lastOffset);
});
