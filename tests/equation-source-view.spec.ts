/** Canonical source-view editing, rendered/source caret synchronization, commit, cancel, and malformed recovery. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import { seedLocalBoard } from './helpers/seedLocalBoard.js';

const initialSource = 'Start $x$';
const finalSource = String.raw`Proof: $\begin{aligned}H(x)&=x^2\\H(y)&=\frac{a}{b}\end{aligned}$`;

test('renders text bracket commands without rewriting source', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForURL(/\/local\/[0-9a-f-]{36}$/i);
  await page.evaluate(() =>
    localStorage.setItem('chalkboard:equation-editing-view', 'source'),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const canvasBounds = await canvas.boundingBox();
  assertValue(canvasBounds, 'drawing canvas bounds');
  await page.mouse.click(
    canvasBounds.x + canvasBounds.width / 2,
    canvasBounds.y + canvasBounds.height / 2,
  );

  const source = String.raw`Atkin \lbrack2\rbrack, Knopp \lbrack4\rbrack`;
  const sourceEditor = page.getByRole('textbox', { name: 'Block source' });
  await sourceEditor.fill(source);
  await expect(sourceEditor).toHaveCSS('font-size', '27px');
  await expect(sourceEditor).toHaveCSS('font-family', /KaTeX_Main/u);
  await page.getByRole('button', { name: 'Use rendered editing view' }).click();
  const field = page.locator('math-field');
  await expect(field).toHaveCSS('font-size', '30px');
  await expect
    .poll(() =>
      field.evaluate((element) =>
        getComputedStyle(element).getPropertyValue('--text-font-family'),
      ),
    )
    .toContain('KaTeX_Main');
  await expect
    .poll(() =>
      field.evaluate(
        (element) =>
          element.shadowRoot?.querySelector('.ML__base')?.textContent ?? '',
      ),
    )
    .toBe('Atkin [2], Knopp [4]');

  await page.getByRole('button', { name: 'Selection tool' }).click();
  const rendered = page.getByRole('group', { name: source });
  await expect(rendered).toBeVisible();
  await expect
    .poll(() => rendered.locator('.ML__base').textContent())
    .toBe('Atkin [2], Knopp [4]');
});

test('places and semantically synchronizes the source caret', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForURL(/\/local\/[0-9a-f-]{36}$/i);
  await page.evaluate(() =>
    localStorage.setItem('chalkboard:equation-editing-view', 'source'),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const canvasBounds = await canvas.boundingBox();
  assertValue(canvasBounds, 'drawing canvas bounds');
  await page.mouse.click(
    canvasBounds.x + canvasBounds.width / 2,
    canvasBounds.y + canvasBounds.height / 2,
  );

  const source = String.raw`ab $\frac{x}{y}+z$ cd`;
  const sourceEditor = page.getByRole('textbox', { name: 'Block source' });
  await sourceEditor.fill(source);
  await sourceEditor.click({ position: { x: 4, y: 8 } });
  await expect
    .poll(() => sourceEditor.evaluate((editor) => editor.selectionStart))
    .toBeLessThanOrEqual(1);

  const yOffset = source.indexOf('y');
  await sourceEditor.press('Home');
  for (let offset = 0; offset < yOffset; offset += 1) {
    await sourceEditor.press('ArrowRight');
  }
  await page.getByRole('button', { name: 'Use rendered editing view' }).click();
  const field = page.locator('math-field');
  await expect.poll(() => field.evaluate((editor) => editor.position)).toBe(6);

  await field.evaluate((editor) => {
    editor.position = 9;
  });
  await page.getByRole('button', { name: 'Use source editing view' }).click();
  await expect(sourceEditor).toBeFocused();
  await expect
    .poll(() => sourceEditor.evaluate((editor) => editor.selectionStart))
    .toBe(source.indexOf('z'));
});

test('maps the visible formula boundary before a repeated fraction into source view', async ({
  page,
}) => {
  const product = String.raw`=\left(-\frac{1}{1+e^{-z}}\right)\left(-e^{-z}\right)`;
  const fraction = String.raw`=\frac{e^{-z}}{1+e^{-z}}`;
  const collapsed = `$${product}${fraction}\\text{}$`;
  const expectedSourceOffset = collapsed.indexOf('=', 2);
  await page.addInitScript(() => {
    localStorage.setItem('chalkboard:equation-editing-view', 'source');
    localStorage.setItem('chalkboard:input-mode', 'math');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const canvasBounds = await canvas.boundingBox();
  assertValue(canvasBounds, 'drawing canvas bounds');
  await page.mouse.click(
    canvasBounds.x + canvasBounds.width / 2,
    canvasBounds.y + canvasBounds.height / 2,
  );

  const sourceEditor = page.getByRole('textbox', { name: 'Block source' });
  await sourceEditor.fill(collapsed);
  await page.getByRole('button', { name: 'Use rendered editing view' }).click();
  const field = page.locator('math-field');
  await page.locator('.inline-math-editor.is-ready').waitFor();
  const boundary = await field.evaluate((mathField) => {
    const candidates: number[] = [];
    for (let offset = 0; offset <= mathField.lastOffset; offset += 1) {
      const right = mathField.getValue([offset, mathField.lastOffset]);
      if (right.includes(String.raw`=\frac`)) candidates.push(offset);
    }
    const offset = candidates.at(-1);
    if (offset === undefined)
      throw new Error('Formula boundary is unavailable');
    const bounds = mathField.getElementInfo(offset)?.bounds;
    if (bounds === undefined)
      throw new Error('Formula boundary has no geometry');
    return {
      offset,
      point: {
        x: bounds.right - 1,
        y: (bounds.top + bounds.bottom) / 2,
      },
    };
  });
  await page.mouse.click(boundary.point.x, boundary.point.y);
  await page.waitForTimeout(100);
  await expect
    .poll(() => field.evaluate((editor) => editor.position))
    .toBe(boundary.offset);

  await page.keyboard.press('Control+e');
  await expect
    .poll(() => sourceEditor.evaluate((editor) => editor.selectionStart))
    .toBe(expectedSourceOffset);

  await page.keyboard.press('Control+e');
  await expect(field).toBeFocused();
  await field.press('Enter');
  await expect
    .poll(() =>
      page.locator('[data-mixed-text-id]').first().getAttribute('aria-label'),
    )
    .toBe(`$${product}$\n$${fraction}$`);
});

test('round-trips the Ctrl+E caret through Enter and formula paste rows', async ({
  page,
}) => {
  const first = String.raw`$=\frac{e^{-z}}{1+e^{-z}}\text{}$`;
  const normalizedFirst = String.raw`$=\frac{e^{-z}}{1+e^{-z}}$`;
  const second = String.raw`$=\left(-\frac{1}{1+e^{-z}}\right)\left(-e^{-z}\right)$`;
  const collapsed = String.raw`$=\frac{e^{-z}}{1+e^{-z}}=\left(-\frac{1}{1+e^{-z}}\right)\left(-e^{-z}\right)\text{}$`;
  const collapsedBoundaryOffset = collapsed.indexOf('=', 2);
  const expected = `${normalizedFirst}\n${second}`;
  await page.addInitScript(() => {
    localStorage.setItem('chalkboard:equation-editing-view', 'source');
    localStorage.setItem('chalkboard:input-mode', 'math');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const canvasBounds = await canvas.boundingBox();
  assertValue(canvasBounds, 'drawing canvas bounds');
  await page.mouse.click(canvasBounds.x + 360, canvasBounds.y + 180);
  const sourceEditor = page.getByRole('textbox', { name: 'Block source' });
  const field = page.locator('math-field');

  // First reproduce the already-collapsed boundary from the preceding
  // interaction. Keep this in the same field so pointer, publication, and
  // caret state all survive into the Enter/paste sequence below.
  await sourceEditor.fill(collapsed);
  await page.getByRole('button', { name: 'Use rendered editing view' }).click();
  await expect(field).toBeFocused();
  const collapsedBoundary = await field.evaluate((mathField) => {
    const candidates: number[] = [];
    for (let offset = 0; offset <= mathField.lastOffset; offset += 1) {
      if (
        mathField
          .getValue([offset, mathField.lastOffset])
          .includes(String.raw`=\left`)
      ) {
        candidates.push(offset);
      }
    }
    const offset = candidates.at(-1);
    if (offset === undefined) throw new Error('Boundary unavailable');
    const bounds = mathField.getElementInfo(offset)?.bounds;
    if (bounds === undefined) throw new Error('Boundary geometry unavailable');
    return {
      x: bounds.right - 1,
      y: (bounds.top + bounds.bottom) / 2,
    };
  });
  await page.mouse.click(collapsedBoundary.x, collapsedBoundary.y);
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+e');
  await expect
    .poll(() => sourceEditor.evaluate((editor) => editor.selectionStart))
    .toBe(collapsedBoundaryOffset);

  await sourceEditor.fill(first);
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+e');
  await expect(field).toBeFocused();
  await expect
    .poll(() => field.evaluate((mathField) => mathField.mode))
    .toBe('math');
  await expect
    .poll(() => field.evaluate((mathField) => mathField.value))
    .toContain(String.raw`\frac{e^{-z}}{1+e^{-z}}`);
  const visualEnd = await field.evaluate((mathField) => {
    const base = mathField.shadowRoot?.querySelector('.ML__base');
    if (!(base instanceof HTMLElement)) throw new Error('Formula unavailable');
    const bounds = base.getBoundingClientRect();
    return { x: bounds.right - 1, y: bounds.top + bounds.height / 2 };
  });
  await page.mouse.click(visualEnd.x, visualEnd.y);
  await field.press('Enter');
  await page.waitForTimeout(100);

  await page.keyboard.press('Control+e');
  await expect(sourceEditor).toHaveValue(`${normalizedFirst}\n`);
  await expect
    .poll(() => sourceEditor.evaluate((editor) => editor.selectionStart))
    .toBe(normalizedFirst.length + 1);

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
  await field.evaluate((mathField, text) => {
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        getData: (format: string) => (format === 'text/plain' ? text : ''),
      },
    });
    mathField.dispatchEvent(paste);
  }, second);
  await expect
    .poll(() =>
      page.locator('[data-mixed-text-id]').first().getAttribute('aria-label'),
    )
    .toBe(expected);
  await page.waitForTimeout(100);

  await page.keyboard.press('Control+e');
  await expect(sourceEditor).toHaveValue(expected);
  await expect
    .poll(() => sourceEditor.evaluate((editor) => editor.selectionStart))
    .toBe(expected.length);
});

for (const scenario of [
  {
    joined: 'firstsecond',
    mode: 'text' as const,
    source: 'first\nsecond',
  },
  {
    joined: '$xy$',
    mode: 'math' as const,
    source: '$x$\n$y$',
  },
]) {
  test(`joins ${scenario.mode} rows from either side of the boundary`, async ({
    page,
  }) => {
    await page.addInitScript(({ mode }) => {
      localStorage.setItem('chalkboard:equation-editing-view', 'source');
      localStorage.setItem('chalkboard:input-mode', mode);
    }, scenario);
    await page.goto('/');
    await page.getByRole('button', { name: 'Mixed text block tool' }).click();
    const canvas = page.getByRole('application', {
      name: 'Chalkboard drawing canvas',
    });
    const canvasBounds = await canvas.boundingBox();
    assertValue(canvasBounds, 'drawing canvas bounds');
    await page.mouse.click(
      canvasBounds.x + canvasBounds.width / 2,
      canvasBounds.y + canvasBounds.height / 2,
    );

    const sourceEditor = page.getByRole('textbox', { name: 'Block source' });
    const field = page.locator('math-field');
    const boundary = scenario.source.indexOf('\n');
    const joinedCaret =
      scenario.mode === 'math' ? scenario.joined.indexOf('y') : boundary;
    await sourceEditor.fill(scenario.source);
    await sourceEditor.press('Home');
    await page.keyboard.press('Control+e');
    await page.locator('.inline-math-editor.is-ready').waitFor();
    await field.press('Backspace');
    await page.keyboard.press('Control+e');
    await expect(sourceEditor).toHaveValue(scenario.joined);
    await expect
      .poll(() => sourceEditor.evaluate((editor) => editor.selectionStart))
      .toBe(joinedCaret);

    await sourceEditor.fill(scenario.source);
    await sourceEditor.press('Home');
    await sourceEditor.press('ArrowLeft');
    await page.keyboard.press('Control+e');
    await field.press('Delete');
    await page.keyboard.press('Control+e');
    await expect(sourceEditor).toHaveValue(scenario.joined);
    await expect
      .poll(() => sourceEditor.evaluate((editor) => editor.selectionStart))
      .toBe(joinedCaret);
  });
}

test('starts a structured command in a restored terminal math row', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('chalkboard:equation-editing-view', 'source');
    localStorage.setItem('chalkboard:input-mode', 'math');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const canvasBounds = await canvas.boundingBox();
  assertValue(canvasBounds, 'drawing canvas bounds');
  await page.mouse.click(
    canvasBounds.x + canvasBounds.width / 2,
    canvasBounds.y + canvasBounds.height / 2,
  );

  const sourceEditor = page.getByRole('textbox', { name: 'Block source' });
  await sourceEditor.fill('$x$\n');
  await page.getByRole('button', { name: 'Use rendered editing view' }).click();
  const field = page.locator('math-field');
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('\\frac');
  await page.keyboard.press('Space');
  await expect
    .poll(() =>
      field.evaluate(
        (mathField) =>
          mathField.shadowRoot?.querySelectorAll(
            '.mixed-text-terminal-placeholder',
          ).length,
      ),
    )
    .toBe(0);
  await expect
    .poll(() =>
      field.evaluate(
        (mathField) =>
          [...(mathField.shadowRoot?.querySelectorAll('span') ?? [])].filter(
            (element) =>
              element.childElementCount === 0 &&
              element.textContent === '\u25a2',
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  await page.keyboard.type('a');
  await page.keyboard.press('Tab');
  await page.keyboard.type('b');
  await page.keyboard.press('Control+e');
  await expect(sourceEditor).toHaveValue('$x$\n$\\frac{a}{b}$');
});

test('preserves a terminal row across source, history, typing, and re-entry', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('chalkboard:equation-editing-view', 'source');
    localStorage.setItem('chalkboard:input-mode', 'math');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const canvasBounds = await canvas.boundingBox();
  assertValue(canvasBounds, 'drawing canvas bounds');
  await page.mouse.click(
    canvasBounds.x + canvasBounds.width / 2,
    canvasBounds.y + canvasBounds.height / 2,
  );

  const sourceEditor = page.getByRole('textbox', { name: 'Block source' });
  await sourceEditor.fill('$x$');
  await sourceEditor.press('End');
  await sourceEditor.press('Enter');
  await expect(sourceEditor).toHaveValue('$x$\n');
  await page.getByRole('button', { name: 'Use rendered editing view' }).click();

  const field = page.locator('math-field');
  const published = page.locator('[data-mixed-text-id]').first();
  const terminalAnchorPresentation = () =>
    field.evaluate((mathField) => {
      const anchors = [
        ...(mathField.shadowRoot?.querySelectorAll(
          '.mixed-text-terminal-placeholder',
        ) ?? []),
      ];
      return {
        count: anchors.length,
        widths: anchors.map((anchor) => anchor.getBoundingClientRect().width),
      };
    });
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await expect(field).toHaveJSProperty('defaultMode', 'text');
  await expect(published).toHaveAttribute('aria-label', '$x$\n');
  await expect
    .poll(() =>
      field.evaluate(
        (mathField) =>
          Array.from(
            { length: mathField.lastOffset },
            (_, offset) => offset,
          ).filter(
            (offset) =>
              mathField.getValue([offset, offset + 1]) ===
              String.fromCodePoint(0x2063),
          ).length,
      ),
    )
    .toBe(1);
  await expect.poll(terminalAnchorPresentation).toEqual({
    count: 1,
    widths: [0],
  });

  await page.keyboard.press('Control+z');
  await expect(published).toHaveAttribute('aria-label', 'x');
  await expect(field).toHaveJSProperty('defaultMode', 'text');
  await expect(field).toBeFocused();
  await page.keyboard.press('Control+y');
  await expect(published).toHaveAttribute('aria-label', '$x$\n');
  await expect(field).toHaveJSProperty('defaultMode', 'text');
  await expect
    .poll(() => field.evaluate((mathField) => mathField.position))
    .toBe(await field.evaluate((mathField) => mathField.lastOffset));
  await expect.poll(terminalAnchorPresentation).toEqual({
    count: 1,
    widths: [0],
  });

  await field.press('y');
  await expect(published).toHaveAttribute('aria-label', '$x$\n$y$');
  await page.getByRole('button', { name: 'Selection tool' }).click();
  const committed = page.getByRole('group', { name: '$x$\n$y$' });
  await expect(committed).toBeVisible();

  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const committedBounds = await committed.boundingBox();
  assertValue(committedBounds, 'committed multiline bounds');
  await page.mouse.click(
    committedBounds.x + committedBounds.width - 1,
    committedBounds.y + committedBounds.height - 1,
  );
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await expect(field).toHaveJSProperty('defaultMode', 'text');
  await page.keyboard.press('Control+e');
  await expect(sourceEditor).toHaveValue('$x$\n$y$');
});

test('edits canonical mixed text and LaTeX in a persistent source view', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForURL(/\/local\/[0-9a-f-]{36}$/i);
  const boardId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  await page.evaluate(() =>
    localStorage.setItem('chalkboard:equation-editing-view', 'rendered'),
  );
  await seedLocalBoard(page, boardId, [
    {
      backgroundColor: 'transparent',
      createdBy: 'local',
      fontSize: 40,
      height: 60,
      id: 'source-proof',
      lineSpacing: 1.2,
      opacity: 1,
      rotation: 0,
      source: initialSource,
      strokeColor: '#1f2937',
      strokeWidth: 2,
      type: 'equation',
      width: 180,
      x: -180,
      y: 0,
    },
    {
      backgroundColor: 'transparent',
      createdBy: 'local',
      fontSize: 36,
      height: 56,
      id: 'other-block',
      lineSpacing: 1.2,
      opacity: 1,
      rotation: 0,
      source: 'Other block',
      sourceFontSize: 33,
      strokeColor: '#1f2937',
      strokeWidth: 2,
      type: 'equation',
      width: 180,
      x: 220,
      y: 0,
    },
  ]);
  await page.reload();

  const rendered = page.getByRole('group', { name: initialSource });
  await expect(rendered).toBeVisible();
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const bounds = await rendered.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  const field = page.locator('math-field');
  const renderedEditor = page.locator('.inline-math-editor');
  await page.locator('.inline-math-editor.is-ready').waitFor();

  const editingView = page.getByRole('group', { name: 'Editing view' });
  await expect(
    editingView.getByRole('button', { name: 'Use rendered editing view' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Input mode' })).toBeVisible();
  await expect(field).toHaveCSS('font-size', '40px');
  const textStyleLabel = page.getByText('Text style', { exact: true });
  const editingViewLabel = page.getByText('Editing view', { exact: true });
  await expect
    .poll(async () => {
      const textStyleBox = await textStyleLabel.boundingBox();
      const editingViewBox = await editingViewLabel.boundingBox();
      return (editingViewBox?.y ?? 0) > (textStyleBox?.y ?? 0);
    })
    .toBe(true);

  await editingView
    .getByRole('button', { name: 'Use source editing view' })
    .click();
  const sourceEditor = page.getByRole('textbox', { name: 'Block source' });
  await expect(sourceEditor).toBeFocused();
  await expect(sourceEditor).toHaveValue(initialSource);
  await expect(sourceEditor).toHaveCSS('font-size', '37px');
  await expect(
    page.getByRole('spinbutton', { name: 'Text size input' }),
  ).toHaveValue('37');
  const sourceBounds = await sourceEditor.boundingBox();
  assertValue(sourceBounds, 'source editor bounds');
  expect(Math.abs(sourceBounds.x - bounds.x)).toBeLessThan(2);
  expect(Math.abs(sourceBounds.y - bounds.y)).toBeLessThan(2);
  await expect(page.locator('[data-mixed-text-id="source-proof"]')).toHaveCSS(
    'opacity',
    '0',
  );
  expect(
    await sourceEditor.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        background: style.backgroundColor,
        border: style.borderTopWidth,
        boxShadow: style.boxShadow,
        tagName: node.tagName,
      };
    }),
  ).toEqual({
    background: 'rgba(0, 0, 0, 0)',
    border: '0px',
    boxShadow: 'none',
    tagName: 'TEXTAREA',
  });
  await expect(page.getByText('Edit plain text and')).toHaveCount(0);
  // Source view has no math/text mode: delimiters are written out, not
  // switched into, so the inspector offers no mode to choose.
  await expect(page.getByRole('group', { name: 'Input mode' })).toHaveCount(0);
  const lineSpacingLabel = page.getByText('Line spacing', { exact: true });
  await expect
    .poll(async () => {
      const lineSpacingBox = await lineSpacingLabel.boundingBox();
      const editingViewBox = await editingViewLabel.boundingBox();
      return (editingViewBox?.y ?? 0) > (lineSpacingBox?.y ?? 0);
    })
    .toBe(true);
  const editingViewBounds = await editingView.boundingBox();
  const renderedButtonBounds = await editingView
    .getByRole('button', { name: 'Use rendered editing view' })
    .boundingBox();
  const sourceButtonBounds = await editingView
    .getByRole('button', { name: 'Use source editing view' })
    .boundingBox();
  expect(
    (renderedButtonBounds?.width ?? 0) + (sourceButtonBounds?.width ?? 0) + 6,
  ).toBeCloseTo(editingViewBounds?.width ?? 0, 0);

  const textSizeInput = page.getByRole('spinbutton', {
    name: 'Text size input',
  });
  await textSizeInput.fill('34');
  await expect(sourceEditor).toHaveCSS('font-size', '34px');
  const renderedToggle = editingView.getByRole('button', {
    name: 'Use rendered editing view',
  });
  await renderedToggle.click();
  // Both editors stay mounted, and the math-field keeps the rendered size in
  // either view, so its size proves nothing about which view is active. Wait
  // for the toggle itself before typing a size that depends on the answer.
  await expect(renderedToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(field).toHaveCSS('font-size', '40px');
  await textSizeInput.fill('44');
  await expect(field).toHaveCSS('font-size', '44px');
  await editingView
    .getByRole('button', { name: 'Use source editing view' })
    .click();
  await expect(sourceEditor).toHaveCSS('font-size', '34px');

  await sourceEditor.fill(finalSource);
  await expect(sourceEditor).toHaveValue(finalSource);
  await expect(renderedEditor).toHaveAttribute('aria-hidden', 'true');
  await expect(
    page.locator('[data-mixed-text-id="source-proof"]'),
  ).toHaveAttribute('aria-label', finalSource);

  await editingView
    .getByRole('button', { name: 'Use rendered editing view' })
    .click();
  await expect(sourceEditor).toBeHidden();
  await expect(renderedEditor).not.toHaveAttribute('aria-hidden');
  await expect
    .poll(() => field.evaluate((node) => document.activeElement === node))
    .toBe(true);

  await page.keyboard.press('Control+z');
  await expect(
    page.locator('[data-mixed-text-id="source-proof"]'),
  ).toHaveAttribute('aria-label', initialSource);
  await page.keyboard.press('Control+y');
  await expect(
    page.locator('[data-mixed-text-id="source-proof"]'),
  ).toHaveAttribute('aria-label', finalSource);

  await editingView
    .getByRole('button', { name: 'Use source editing view' })
    .click();
  await expect(sourceEditor).toHaveValue(finalSource);
  await sourceEditor.fill(String.raw`Incomplete $\frac{a}{`);
  await expect(sourceEditor).toHaveValue(String.raw`Incomplete $\frac{a}{`);
  await expect(
    page.getByRole('application', { name: 'Chalkboard drawing canvas' }),
  ).toBeVisible();
  await sourceEditor.fill(finalSource);

  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(field).toHaveCount(0);
  await expect(page.getByRole('group', { name: finalSource })).toBeVisible();
  await page.reload();
  const reloaded = page.getByRole('group', { name: finalSource });
  await expect(reloaded).toBeVisible();

  await page.getByRole('button', { name: 'Selection tool' }).click();
  const reloadedBounds = await reloaded.boundingBox();
  assertValue(reloadedBounds, 'element bounds after reload');
  await page.mouse.click(
    reloadedBounds.x + reloadedBounds.width / 2,
    reloadedBounds.y + reloadedBounds.height / 2,
  );
  await expect(page.getByRole('group', { name: 'Editing view' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('textbox', { name: 'Block source' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  await page.mouse.click(
    reloadedBounds.x + reloadedBounds.width / 2,
    reloadedBounds.y + reloadedBounds.height / 2,
  );
  await expect(
    page.getByRole('textbox', { name: 'Block source' }),
  ).toBeFocused();

  const sourceSizeSlider = page.getByRole('slider', {
    name: 'Text size slider',
  });
  await sourceSizeSlider.focus();
  await page.keyboard.press('ArrowRight');
  await editingView
    .getByRole('button', { name: 'Use rendered editing view' })
    .click();
  const other = page.getByRole('group', { name: 'Other block' });
  const otherBounds = await other.boundingBox();
  assertValue(otherBounds, 'other block bounds');
  await page.mouse.click(
    otherBounds.x + otherBounds.width / 2,
    otherBounds.y + otherBounds.height / 2,
  );
  await expect(field).toHaveJSProperty('value', 'Other block');
  await expect(field).toBeFocused();
  await page.waitForTimeout(500);
  await expect(field).toHaveJSProperty('value', 'Other block');
  await expect(field).toBeFocused();
});

test('keeps rendered and source defaults independent for the next block', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForURL(/\/local\/[0-9a-f-]{36}$/i);
  await page.evaluate(() =>
    localStorage.setItem('chalkboard:equation-editing-view', 'source'),
  );
  await page.reload();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');

  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  await page.mouse.click(bounds.x + 360, bounds.y + 170);
  const sourceEditor = page.getByRole('textbox', { name: 'Block source' });
  await sourceEditor.fill('First block');
  const size = page.getByRole('spinbutton', { name: 'Text size input' });
  await size.fill('44');
  await expect(sourceEditor).toHaveCSS('font-size', '44px');

  await page.getByRole('button', { name: 'Use rendered editing view' }).click();
  const field = page.locator('math-field');
  await expect(field).toHaveCSS('font-size', '30px');
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(field).toHaveCount(0);

  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  await page.mouse.click(bounds.x + 560, bounds.y + 330);
  await expect(field).toHaveCSS('font-size', '30px');
  await page.getByRole('button', { name: 'Use source editing view' }).click();
  await expect(page.getByRole('textbox', { name: 'Block source' })).toHaveCSS(
    'font-size',
    '44px',
  );
});

test('keeps the toolbar usable right after switching back to rendered view', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForURL(/\/local\/[0-9a-f-]{36}$/i);
  await page.evaluate(() =>
    localStorage.setItem('chalkboard:equation-editing-view', 'source'),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const canvasBounds = await canvas.boundingBox();
  assertValue(canvasBounds, 'drawing canvas bounds');
  await page.mouse.click(
    canvasBounds.x + canvasBounds.width / 2,
    canvasBounds.y + canvasBounds.height / 2,
  );
  const sourceEditor = page.getByRole('textbox', { name: 'Block source' });
  await expect(sourceEditor).toBeFocused();
  await sourceEditor.fill('Focus $x$');
  await expect(sourceEditor).toHaveValue('Focus $x$');

  const editingView = page.getByRole('group', { name: 'Editing view' });
  const renderedToggle = editingView.getByRole('button', {
    name: 'Use rendered editing view',
  });
  await renderedToggle.click();
  await expect(renderedToggle).toHaveAttribute('aria-pressed', 'true');

  // Returning to rendered view hands focus back to the block, and the block is
  // not always ready to take it, so the editor retries for about a second. The
  // writer owns that second too: reaching for the size box during it must not
  // have focus torn away, and the size typed there must stick.
  const textSizeInput = page.getByRole('spinbutton', {
    name: 'Text size input',
  });
  await textSizeInput.click();
  await expect(textSizeInput).toBeFocused();
  await textSizeInput.fill('44');
  await expect(textSizeInput).toBeFocused();
  const field = page.locator('math-field');
  await expect(field).toHaveCSS('font-size', '44px');
  // Well past the sixty-frame retry window, so a late frame cannot undo it.
  await page.waitForTimeout(1500);
  await expect(textSizeInput).toBeFocused();
  await expect(textSizeInput).toHaveValue('44');
  await expect(field).toHaveCSS('font-size', '44px');
});

test('a control taken while the block is focusing keeps focus and the keystroke', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForURL(/\/local\/[0-9a-f-]{36}$/i);
  await page.evaluate(() =>
    localStorage.setItem('chalkboard:equation-editing-view', 'source'),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const canvasBounds = await canvas.boundingBox();
  assertValue(canvasBounds, 'drawing canvas bounds');
  await page.mouse.click(
    canvasBounds.x + canvasBounds.width / 2,
    canvasBounds.y + canvasBounds.height / 2,
  );
  const sourceEditor = page.getByRole('textbox', { name: 'Block source' });
  await expect(sourceEditor).toBeFocused();
  await sourceEditor.fill('Steal $x$');
  await expect(sourceEditor).toHaveValue('Steal $x$');

  // MathLive schedules a re-focus of its own hidden input sixty milliseconds
  // after the block takes focus, and never rechecks whether focus should still
  // be there. Reaching for the size box inside that window is ordinary — the
  // block takes focus on its own when the view switches — but it used to cost
  // the writer both the focus and whatever they typed next. Take the box the
  // moment the block is focused so the window is open rather than raced for.
  await page.evaluate(() => {
    document.querySelector('math-field')?.addEventListener(
      'focusin',
      () => {
        window.setTimeout(() => {
          document
            .querySelector<HTMLElement>('input[aria-label="Text size input"]')
            ?.focus();
        }, 0);
      },
      { once: true },
    );
  });
  const editingView = page.getByRole('group', { name: 'Editing view' });
  await editingView
    .getByRole('button', { name: 'Use rendered editing view' })
    .click();

  const textSizeInput = page.getByRole('spinbutton', {
    name: 'Text size input',
  });
  await expect(textSizeInput).toBeFocused();
  // Well past the sixty-millisecond timer.
  await page.waitForTimeout(400);
  await expect(textSizeInput).toBeFocused();
  await textSizeInput.fill('52');
  await expect(page.locator('math-field')).toHaveCSS('font-size', '52px');
});

test('routes visible undo and redo controls through the active mixed block', async ({
  page,
}) => {
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
  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await expect(undo).toBeDisabled();
  await field.evaluate((mathField) => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: () => 'history' },
    });
    mathField.dispatchEvent(event);
  });
  await expect(field).toHaveJSProperty('value', 'history');
  await expect(undo).toBeEnabled();

  await undo.click();
  await expect(field).toHaveJSProperty('value', '');
  await expect(field).toHaveCount(1);
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();

  await redo.click();
  await expect(field).toHaveJSProperty('value', 'history');
  await expect(redo).toBeDisabled();

  await page.getByRole('button', { name: 'Use source editing view' }).click();
  const source = page.getByRole('textbox', { name: 'Block source' });
  await expect(source).toHaveValue('history');
  await source.fill('history source');
  await expect(undo).toBeEnabled();

  await undo.click();
  await expect(source).toHaveValue('history');
  await expect(source).toBeFocused();
  await expect(redo).toBeEnabled();

  await redo.click();
  await expect(source).toHaveValue('history source');
  await expect(source).toBeFocused();

  await source.press('Control+z');
  await expect(source).toHaveValue('history');
  await source.press('Control+y');
  await expect(source).toHaveValue('history source');
  await expect(field).toHaveCount(1);

  await page.getByRole('button', { name: 'Selection tool' }).click();
  const committed = page.getByRole('group', { name: 'history source' });
  await expect(field).toHaveCount(0);
  await expect(committed).toBeVisible();
  // Committing creates a board object, so global structure history remains
  // available after the block-local editor history closes.
  await expect(undo).toBeEnabled();

  await page.keyboard.press('Delete');
  await expect(committed).toHaveCount(0);
  await expect(undo).toBeEnabled();
  await undo.click();
  const restored = page.getByRole('group', { name: 'history source' });
  await expect(restored).toBeVisible();
  await redo.click();
  await expect(restored).toHaveCount(0);
  await undo.click();
  await expect(restored).toBeVisible();

  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const restoredBounds = await restored.boundingBox();
  assertValue(restoredBounds, 'restored mixed-block bounds');
  await page.mouse.click(
    restoredBounds.x + restoredBounds.width / 2,
    restoredBounds.y + restoredBounds.height / 2,
  );
  await expect(source).toBeFocused();
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(source).toHaveValue('history');
  await redo.click();
  await expect(source).toHaveValue('history source');
});
