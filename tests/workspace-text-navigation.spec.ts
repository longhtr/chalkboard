/** Caret, word/character selection, arrows, block movement, mode boundaries, pointer placement, and history. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import * as workspace from './helpers/workspace';

test('switches active blocks on empty clicks and deletes abandoned empty blocks', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 300, bounds.y + 220);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('Kept block');

  await page.mouse.click(bounds.x + 560, bounds.y + 360);
  await expect(page.locator('math-field')).toBeFocused();
  await expect(page.getByRole('group', { name: 'Kept block' })).toBeVisible();
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();

  await page.mouse.click(bounds.x + 700, bounds.y + 450);
  await expect(page.locator('math-field')).toBeFocused();
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await workspace.finishWorkspaceEditing(page);
  await expect(page.locator('math-field')).toHaveCount(0);
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
});

test('opens an existing block after abandoning a new empty block', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 300, bounds.y + 220);
  const mathField = page.locator('math-field');
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('Existing text');
  await workspace.finishWorkspaceEditing(page);

  const block = page.getByRole('group', { name: 'Existing text' });
  const text = block
    .locator('.ML__text:not(.ML__base)')
    .filter({ hasText: /^Existing text$/ });
  await expect(text).toBeVisible();
  await expect
    .poll(() =>
      text.evaluate((node) => {
        const textNode = [...node.childNodes].find(
          (child) => child.nodeType === Node.TEXT_NODE,
        );
        if (!(textNode instanceof Text)) return 0;
        const range = document.createRange();
        range.setStart(textNode, 5);
        range.setEnd(textNode, 6);
        return range.getBoundingClientRect().width;
      }),
    )
    .toBeGreaterThan(0);
  await page.mouse.click(bounds.x + 650, bounds.y + 420);
  await expect(mathField).toHaveJSProperty('value', '');
  await expect
    .poll(() =>
      text.evaluate((node) => {
        const textNode = [...node.childNodes].find(
          (child) => child.nodeType === Node.TEXT_NODE,
        );
        if (!(textNode instanceof Text)) return 0;
        const range = document.createRange();
        range.setStart(textNode, 5);
        range.setEnd(textNode, 6);
        return range.getBoundingClientRect().width;
      }),
    )
    .toBeGreaterThan(0);

  let point: { x: number; y: number } | null = null;
  await expect
    .poll(async () => {
      point = await text.evaluate((node) => {
        const textNode = [...node.childNodes].find(
          (child) => child.nodeType === Node.TEXT_NODE,
        );
        if (!(textNode instanceof Text)) return null;
        const range = document.createRange();
        range.setStart(textNode, 5);
        range.setEnd(textNode, 6);
        const character = range.getBoundingClientRect();
        if (character.width <= 0 || character.height <= 0) return null;
        return {
          x: character.x + character.width / 2,
          y: character.y + character.height / 2,
        };
      });
      return point?.x ?? 0;
    })
    .toBeGreaterThan(0);
  assertValue(point, 'caret point');
  await page.mouse.click(point.x, point.y);

  await expect(mathField).toBeFocused();
  await expect(mathField).toHaveJSProperty('value', 'Existing text');
  await expect
    .poll(() => mathField.evaluate((field) => field.position))
    .toBeGreaterThan(0);
  await page.keyboard.type('!');
  await workspace.finishWorkspaceEditing(page);
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await expect(page.getByRole('group', { name: /!/ })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { source?: string }[];
        return elements[0]?.source?.replace('!', '') ?? '';
      }),
    )
    .toBe('Existing text');
});

test('moves between blocks with Alt+Arrow and restores each caret', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify(
        [
          { id: 'left', source: 'left', x: -280, y: -100 },
          { id: 'right', source: 'right', x: 120, y: -100 },
          { id: 'down', source: 'down', x: 120, y: 150 },
        ].map((element) => ({
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 32,
          height: 42,
          opacity: 1,
          rotation: 0,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 100,
          ...element,
        })),
      ),
    );
  });
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const left = page.locator('[data-mixed-text-id="left"]');
  const leftBounds = await left.boundingBox();
  assertValue(leftBounds, 'left block bounds');
  await page.mouse.click(
    leftBounds.x + leftBounds.width / 2,
    leftBounds.y + leftBounds.height / 2,
  );
  const field = page.locator('math-field');
  const placeCaret = async (id: string, source: string, position: number) => {
    await expect(page.locator('.inline-math-editor.is-ready')).toBeVisible();
    const text = page
      .locator(`[data-mixed-text-id="${id}"] .ML__text:not(.ML__base)`)
      .filter({ hasText: new RegExp(`^${source}$`) });
    const point = await text.evaluate((element, offset) => {
      const textNode = [...element.childNodes].find(
        (child) => child.nodeType === Node.TEXT_NODE,
      );
      if (!(textNode instanceof Text)) return null;
      const range = document.createRange();
      range.setStart(textNode, offset);
      range.setEnd(textNode, offset);
      const bounds = range.getBoundingClientRect();
      const textBounds = element.getBoundingClientRect();
      return { x: bounds.x, y: textBounds.y + textBounds.height / 2 };
    }, position);
    assertValue(point, 'caret point');
    await page.mouse.click(point.x, point.y);
    await expect
      .poll(() => field.evaluate((mathField) => mathField.position))
      .toBe(position);
  };
  const expectActiveCaretAt = async (position: number) => {
    await expect(page.locator('.inline-math-editor.is-ready')).toBeVisible();
    await expect(field).toBeFocused();
    await expect(field).toHaveJSProperty('position', position);
    await expect
      .poll(() => workspace.activeCaretState(page))
      .toMatchObject({
        visibility: 'visible',
      });
  };

  await expect(field).toHaveJSProperty('value', 'left');
  await placeCaret('left', 'left', 2);
  await expectActiveCaretAt(2);

  await page.keyboard.press('Alt+ArrowRight');
  await expect(field).toHaveJSProperty('value', 'right');
  await placeCaret('right', 'right', 1);
  await expectActiveCaretAt(1);
  await page.keyboard.press('Alt+ArrowDown');
  await expect(field).toHaveJSProperty('value', 'down');
  await placeCaret('down', 'down', 2);
  await expectActiveCaretAt(2);

  await page.keyboard.press('Alt+ArrowUp');
  await expect(field).toHaveJSProperty('value', 'right');
  await expectActiveCaretAt(1);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(field).toHaveJSProperty('value', 'left');
  await expectActiveCaretAt(2);
  await page.keyboard.press('Alt+ArrowRight');
  await expect(field).toHaveJSProperty('value', 'right');
  await expectActiveCaretAt(1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          localStorage.getItem(
            `chalkboard:caret-positions:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '{}',
        ),
      ),
    )
    .toMatchObject({ left: 2, right: 1 });

  await page.reload();
  await workspace.selectMixedTextTool(page);
  const reloadedRight = page.locator('[data-mixed-text-id="right"]');
  const reloadedBounds = await reloadedRight.boundingBox();
  assertValue(reloadedBounds, 'element bounds after reload');
  await page.mouse.click(
    reloadedBounds.x + reloadedBounds.width - 2,
    reloadedBounds.y + reloadedBounds.height / 2,
  );
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(field).toHaveJSProperty('value', 'left');
  await expectActiveCaretAt(2);
});

test('uses reciprocal axis ordering for directional block navigation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify(
        [
          { id: 'block-4', source: 'block 4', x: 299.4, y: -161.4 },
          { id: 'block-5', source: 'block 5', x: -61.2, y: 35.4 },
          { id: 'block-6', source: 'block 6', x: 220.2, y: 179.4 },
        ].map((element) => ({
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 32,
          height: 39,
          opacity: 1,
          rotation: 0,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 101,
          ...element,
        })),
      ),
    );
  });
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const block5 = page.locator('[data-mixed-text-id="block-5"]');
  const bounds = await block5.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );

  const field = page.locator('math-field');
  await expect(field).toHaveJSProperty('value', 'block 5');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(field).toHaveJSProperty('value', 'block 6');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(field).toHaveJSProperty('value', 'block 5');
});

test('keeps every block reachable through both axis orderings', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify(
        [
          { id: 'a', source: 'a', x: 90, y: 160 },
          { id: 'b', source: 'b', x: 10, y: 180 },
          { id: 'c', source: 'c', x: 20, y: 70 },
          { id: 'd', source: 'd', x: 130, y: 70 },
        ].map((element) => ({
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 32,
          height: 39,
          opacity: 1,
          rotation: 0,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 30,
          ...element,
        })),
      ),
    );
  });
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const blockB = page.locator('[data-mixed-text-id="b"]');
  const bounds = await blockB.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );

  const field = page.locator('math-field');
  for (const value of ['b', 'c', 'a', 'd']) {
    await expect(field).toHaveJSProperty('value', value);
    if (value !== 'd') await page.keyboard.press('Alt+ArrowRight');
  }
  for (const value of ['d', 'a', 'c', 'b']) {
    await expect(field).toHaveJSProperty('value', value);
    if (value !== 'b') await page.keyboard.press('Alt+ArrowLeft');
  }
  for (const value of ['b', 'a', 'd', 'c']) {
    await expect(field).toHaveJSProperty('value', value);
    if (value !== 'c') await page.keyboard.press('Alt+ArrowUp');
  }
  for (const value of ['c', 'd', 'a', 'b']) {
    await expect(field).toHaveJSProperty('value', value);
    if (value !== 'b') await page.keyboard.press('Alt+ArrowDown');
  }
});

test('places the caret inside a block whose color covered its whole source', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 32,
          height: 39,
          id: 'whole-color-block',
          opacity: 1,
          rotation: 0,
          source: String.raw`\textcolor{#1f2937}{block 1}`,
          strokeColor: '#e03131',
          strokeWidth: 2,
          type: 'equation',
          width: 96.73,
          x: -282.6,
          y: -220.2,
        },
      ]),
    );
  });
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const rendered = page.locator('[data-mixed-text-id="whole-color-block"]');
  const bounds = await rendered.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.click(
    bounds.x + bounds.width - 2,
    bounds.y + bounds.height / 2,
  );
  const field = page.locator('math-field');
  await expect(page.locator('.inline-math-editor.is-ready')).toBeVisible();
  await expect(field).toHaveJSProperty('value', 'block 1');

  const text = rendered
    .locator('.ML__text:not(.ML__base)')
    .filter({ hasText: /^block 1$/ });
  for (const position of [1, 3, 5]) {
    const point = await text.evaluate((element, offset) => {
      const textNode = [...element.childNodes].find(
        (child) => child.nodeType === Node.TEXT_NODE,
      );
      if (!(textNode instanceof Text)) return null;
      const range = document.createRange();
      range.setStart(textNode, offset);
      range.setEnd(textNode, offset);
      const rangeBounds = range.getBoundingClientRect();
      const textBounds = element.getBoundingClientRect();
      return { x: rangeBounds.x, y: textBounds.y + textBounds.height / 2 };
    }, position);
    assertValue(point, 'caret point');
    await page.mouse.click(point.x, point.y);
    await expect
      .poll(() => field.evaluate((mathField) => mathField.position))
      .toBe(position);
  }

  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { source?: string; strokeColor?: string }[];
        return {
          source: elements[0]?.source,
          strokeColor: elements[0]?.strokeColor,
        };
      }),
    )
    .toEqual({ source: 'block 1', strokeColor: '#1f2937' });
});

test('keeps the style panel aligned left while editing nearby text', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 52,
          height: 71,
          id: 'panel-overlap-block',
          opacity: 1,
          rotation: 0,
          source: 'block 1',
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 180,
          x: -560,
          y: -250,
        },
      ]),
    );
  });
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const rendered = page.locator('[data-mixed-text-id="panel-overlap-block"]');
  const renderedBounds = await rendered.boundingBox();
  assertValue(renderedBounds, 'rendered element bounds');
  await page.mouse.click(
    renderedBounds.x + renderedBounds.width - 2,
    renderedBounds.y + renderedBounds.height / 2,
  );
  const field = page.locator('math-field');
  await expect(page.locator('.inline-math-editor.is-ready')).toBeVisible();
  const panelBounds = await page
    .getByRole('complementary', { name: 'Element style' })
    .boundingBox();
  assertValue(panelBounds, 'style panel bounds');
  expect(panelBounds.x).toBe(16);
  await expect(field).toBeFocused();
});

test('creates a block in visual whitespace inside multiline bounds', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 300, bounds.y + 220);
  await page.keyboard.type('A very long first line');
  await page.keyboard.press('Enter');
  await page.keyboard.type('x');
  await workspace.finishWorkspaceEditing(page);

  const multiline = page
    .locator('.math-element')
    .filter({ hasText: 'A very long first line' });
  await expect(multiline).toHaveAttribute(
    'aria-label',
    'A very long first line\nx',
  );
  await expect(multiline.locator('.mixed-text-line-break')).toHaveCount(1);
  const multilineBounds = await multiline.boundingBox();
  const secondLineBounds = await multiline
    .locator('.ML__text')
    .filter({ hasText: /^x$/ })
    .boundingBox();
  assertValue(multilineBounds, 'multiline block bounds');
  assertValue(secondLineBounds, 'second line bounds');

  await page.mouse.click(
    multilineBounds.x + multilineBounds.width - 3,
    secondLineBounds.y + secondLineBounds.height / 2,
  );
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type('New block');
  await workspace.finishWorkspaceEditing(page);

  await expect(multiline).toBeVisible();
  await expect(page.getByRole('group', { name: 'New block' })).toBeVisible();
});

test('shows a cursor on every consecutive empty-canvas click', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');

  const points = [
    { x: 280, y: 180 },
    { x: 480, y: 180 },
    { x: 680, y: 180 },
    { x: 280, y: 380 },
    { x: 480, y: 380 },
    { x: 680, y: 380 },
  ];
  for (const point of points) {
    await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
    await expect(page.locator('math-field')).toBeFocused();
    const caret = await workspace.activeCaretState(page);
    assertValue(caret, 'caret point');
    expect(caret.visibility).toBe('visible');
    expect(Math.abs(caret.x - (bounds.x + point.x))).toBeLessThan(2);
    const editorBounds = await page
      .locator('.inline-math-editor')
      .boundingBox();
    assertValue(editorBounds, 'active editor bounds');
    expect(
      Math.abs(editorBounds.y + editorBounds.height / 2 - (bounds.y + point.y)),
    ).toBeLessThan(2);
  }
});

test('keeps the native caret aligned when entering math mode', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 360, bounds.y + 240);
  await expect(page.locator('math-field')).toBeFocused();
  const emptyCaret = await workspace.activeCaretState(page);
  assertValue(emptyCaret, 'empty text caret');
  expect(emptyCaret).toMatchObject({
    className: 'ML__text-caret',
    transform: 'none',
    visibility: 'visible',
  });

  await page.keyboard.type('Text');
  const textCaret = await workspace.activeCaretState(page);
  assertValue(textCaret, 'populated text caret');
  await page.keyboard.press('Control+m');
  await expect
    .poll(() => workspace.activeCaretState(page))
    .toMatchObject({
      bottom: textCaret.bottom,
      className: 'ML__caret',
      height: textCaret.height,
      transform: 'none',
      visibility: 'visible',
    });
  expect(emptyCaret.bottom).toBe(textCaret.bottom);
  expect(emptyCaret.height).toBe(textCaret.height);
  await expect
    .poll(() =>
      page
        .locator('math-field')
        .evaluate((field) => field.value.includes('\\placeholder{}')),
    )
    .toBe(false);
  await expect(page.locator('.inline-math-editor__empty-caret')).toHaveCount(0);
});

test('captures typing immediately for every new block', async ({ page }) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');

  const points = [
    { x: bounds.width * 0.28, y: bounds.height * 0.32 },
    { x: bounds.width * 0.52, y: bounds.height * 0.32 },
    { x: bounds.width * 0.76, y: bounds.height * 0.32 },
    { x: bounds.width * 0.28, y: bounds.height * 0.7 },
    { x: bounds.width * 0.52, y: bounds.height * 0.7 },
    { x: bounds.width * 0.76, y: bounds.height * 0.7 },
  ];
  for (const [offset, point] of points.entries()) {
    const index = offset + 1;
    await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
    const field = page.locator('math-field');
    await expect(field).toBeFocused();
    await expect(page.locator('.inline-math-editor')).toHaveClass(/is-ready/);
    await expect
      .poll(() => workspace.activeCaretState(page))
      .toMatchObject({
        visibility: 'visible',
      });
    await page.keyboard.type(`Block ${index}`);
    await expect(field).toHaveJSProperty('value', `Block ${index}`);
  }
  await workspace.finishWorkspaceEditing(page);

  for (let index = 1; index <= 6; index += 1) {
    await expect(
      page.getByRole('group', { name: `Block ${index}` }),
    ).toBeVisible();
  }
});

test('creates another mixed-text block after keyboard selection and deselection', async ({
  page,
}) => {
  await page.goto('/');
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');

  await page.keyboard.press('Control+5');
  await page.mouse.click(bounds.x + 360, bounds.y + 260);
  await page.keyboard.type('abc');
  await page.keyboard.press('Control+1');
  await page.mouse.click(bounds.x + 620, bounds.y + 300);
  await expect(page.locator('math-field')).toHaveCount(0);
  await page.keyboard.press('Control+5');
  await page.mouse.click(bounds.x + 620, bounds.y + 420);
  await expect(
    page.getByRole('button', { name: 'Mixed text block tool' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('math-field')).toBeFocused();
  await expect(page.locator('.inline-math-editor.is-ready')).toBeVisible();
  await page.keyboard.type('def');
  await expect(page.locator('math-field')).toHaveJSProperty('value', 'def');
});

test('creates another mixed-text block after briefly using selection', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 360, bounds.y + 260);
  await page.keyboard.type('Alpha');
  await page.evaluate(() => {
    const selectionTool = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Selection tool"]',
    );
    const mixedTextTool = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Mixed text block tool"]',
    );
    if (selectionTool === null || mixedTextTool === null) {
      throw new Error('Expected both workspace tool buttons');
    }
    selectionTool.click();
    mixedTextTool.click();
  });
  await expect(page.locator('math-field')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Mixed text block tool' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(bounds.x + 620, bounds.y + 420);
  await expect(page.locator('math-field')).toHaveCount(1);
  await expect(page.locator('math-field')).toHaveJSProperty('value', '');
});

test('mixed text edits blocks while selection only selects them', async ({
  page,
}) => {
  await page.goto('/');
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 360, bounds.y + 260);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('Alpha');
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(page.locator('math-field')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Delete selection' }),
  ).toBeEnabled();
  const alpha = page.getByRole('group', { name: 'Alpha' });
  const alphaBounds = await alpha.boundingBox();
  assertValue(alphaBounds, 'alphaBounds');

  await page.mouse.click(
    alphaBounds.x + alphaBounds.width / 2,
    alphaBounds.y + alphaBounds.height / 2,
  );
  await expect(page.locator('math-field')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Delete selection' }),
  ).toBeEnabled();

  await workspace.selectMixedTextTool(page);
  await page.mouse.click(
    alphaBounds.x + alphaBounds.width / 2,
    alphaBounds.y + alphaBounds.height / 2,
  );
  await expect(page.locator('math-field')).toBeFocused();
  await expect(page.locator('math-field')).toHaveJSProperty('value', 'Alpha');

  await page.getByRole('button', { name: 'Selection tool' }).click();
  await page.mouse.click(
    alphaBounds.x + alphaBounds.width / 2,
    alphaBounds.y + alphaBounds.height / 2,
  );
  await workspace.selectMixedTextTool(page);
  await page.mouse.click(bounds.x + 620, bounds.y + 420);
  await expect(page.locator('math-field')).toBeFocused();
  await expect(page.locator('math-field')).toHaveJSProperty('value', '');
});
