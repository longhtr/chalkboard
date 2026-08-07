/** Switching equations, tools, modes, and source view without duplicate fields, stale focus, or lost publication. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import {
  activeMathLatex,
  canvasBounds,
  createEmptyMathRegion,
  finishEditing,
} from './helpers/equationEditor';

import { activeMathFieldCaretStyle } from './helpers/mathField';
test('edits rendered mathematics directly and restores it locally', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 480, bounds.y + 260);

  const mathField = page.locator('math-field');
  await expect(mathField).toBeVisible();
  await expect(page.locator('.latex-editor')).toHaveCount(0);
  await expect(mathField).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => document.fonts.check('italic 16px KaTeX_Math')),
    )
    .toBe(true);
  await expect.poll(() => activeMathLatex(mathField)).toBe('');

  await page.keyboard.type('a');
  await expect.poll(() => activeMathLatex(mathField)).toContain('a');
  await page.keyboard.type('/b=c');
  const latex = await activeMathLatex(mathField);
  expect(latex).toContain('a');
  expect(latex).toContain('b');
  expect(latex).toContain('c');

  await finishEditing(page);
  await expect(mathField).toHaveCount(0);
  await expect(page.getByRole('math', { name: latex })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const renderedMath = page.getByRole('math', { name: latex });
  const renderedId = await renderedMath.getAttribute('data-mixed-text-id');
  assertValue(renderedId, 'rendered equation identity');
  await expect(renderedMath).toBeVisible();
  await expect(renderedMath.locator('.ML__latex')).toBeVisible();
  await expect(renderedMath.locator('svg')).toHaveCount(0);
  await expect
    .poll(() =>
      renderedMath.evaluate((element) =>
        Number.parseFloat(
          element.closest<HTMLElement>('[data-mixed-text-id]')?.style.left ??
            '',
        ),
      ),
    )
    .toBeGreaterThan(0);
  const renderedBounds = await renderedMath.boundingBox();
  assertValue(renderedBounds, 'rendered element bounds');
  await page.mouse.click(
    renderedBounds.x + Math.min(8, renderedBounds.width / 2),
    renderedBounds.y + Math.min(8, renderedBounds.height / 2),
  );
  await expect(mathField).toBeVisible();
  await expect(mathField).toBeFocused();
  await expect
    .poll(() => activeMathFieldCaretStyle(mathField))
    .toMatchObject({
      animationDuration: '1s',
      animationIterationCount: 'infinite',
      animationName: 'chalkboard-caret-blink',
      visibility: 'visible',
    });
  const observedCaretOpacities = new Set<string>();
  await expect
    .poll(async () => {
      observedCaretOpacities.add(
        (await activeMathFieldCaretStyle(mathField))?.opacity ?? '',
      );
      return observedCaretOpacities.size;
    })
    .toBe(2);
  expect(observedCaretOpacities).toEqual(new Set(['0', '1']));
  await page.keyboard.type('+1');
  await expect.poll(() => activeMathLatex(mathField)).not.toBe(latex);
  let updatedLatex: string | null = null;
  await expect
    .poll(async () => {
      updatedLatex = await page
        .locator(`[data-mixed-text-id="${renderedId ?? ''}"]`)
        .getAttribute('aria-label');
      return updatedLatex;
    })
    .toContain('1');
  expect(updatedLatex).toContain('+');
  await finishEditing(page);
  await expect(mathField).toHaveCount(0);
  await expect(
    page.getByRole('math', { name: updatedLatex ?? '' }),
  ).toBeVisible();
});

test('renders mixed text and edits only the clicked delimited math region', async ({
  page,
}) => {
  const source = String.raw`Energy $E=mc^2$ and $\sum_{i=1}^{n}i$ remain in one block.`;
  await page.addInitScript((mixedSource) => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 32,
          height: 120,
          id: 'mixed-block',
          source: mixedSource,
          opacity: 1,
          rotation: 0,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 600,
          x: -250,
          y: -60,
        },
      ]),
    );
  }, source);
  await page.goto('/');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  await page.keyboard.press('Control+m');

  const block = page.getByRole('group', { name: source });
  await expect(block).toBeVisible();
  const inlineMath = block.locator('.ML__mathit').filter({ hasText: /^E$/ });
  const displayMath = block.locator('.ML__op-group');
  await expect(inlineMath).toBeVisible();
  await expect(displayMath).toBeVisible();

  const inlineBounds = await inlineMath.boundingBox();
  assertValue(inlineBounds, 'inline element bounds');
  await page.mouse.click(
    inlineBounds.x + inlineBounds.width / 2,
    inlineBounds.y + inlineBounds.height / 2,
  );
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();
  await expect.poll(() => activeMathLatex(mathField)).toBe('E=mc^2');
  await expect
    .poll(() => mathField.evaluate((field) => field.shadowRoot?.textContent))
    .toContain('Energy');
  await finishEditing(page);

  const bounds = await displayMath.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await expect(mathField).toBeFocused();
  await expect
    .poll(() => activeMathLatex(mathField, 1))
    .toBe(String.raw`\sum_{i=1}^{n}i`);

  await page.keyboard.type('+1');
  let updatedSource: string | null = null;
  await expect
    .poll(async () => {
      updatedSource = await page
        .locator('[data-mixed-text-id="mixed-block"]')
        .getAttribute('aria-label');
      return updatedSource;
    })
    .toContain('+1');
  expect(updatedSource).toContain('$E=mc^2$');
  expect(
    [...updatedSource.matchAll(/\${1,2}([\s\S]*?)\${1,2}/gu)][1]?.[1],
  ).toContain('+1');

  await finishEditing(page);
  await expect(page.locator('math-field')).toHaveCount(0);
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
    .toBe(updatedSource);
});

test('discards a new empty mixed text block when editing finishes', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 360, bounds.y + 220);
  await expect(page.locator('math-field')).toBeVisible();

  await finishEditing(page);
  await expect(page.locator('math-field')).toHaveCount(0);
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
});

test('commits from the active mixed text tool without adding a multiline wrapper', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 420, bounds.y + 240);
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();
  await page.keyboard.type('RR');
  const latex = await activeMathLatex(mathField);
  expect(latex).toBe(String.raw`\mathbb{R}`);

  await finishEditing(page);
  await expect(mathField).toHaveCount(0);
  await expect(page.getByRole('math', { name: latex })).toBeVisible();
  expect(latex).not.toContain('displaylines');
});

test('recovers an equation draft when the page reloads during editing', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 420, bounds.y + 240);
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();
  await page.keyboard.type('q+7');
  const latex = await activeMathLatex(mathField);

  await page.reload();
  await expect(page.getByRole('math', { name: latex })).toBeVisible();
});

test('switches directly between equations while committing the first', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  const createEquation = async (x: number, source: string) => {
    await createEmptyMathRegion(page, x, bounds.y + 280);
    const field = page.locator('math-field');
    await expect(field).toBeFocused();
    await page.keyboard.type(source);
    const latex = await activeMathLatex(field);
    await finishEditing(page);
    return latex;
  };

  const firstLatex = await createEquation(bounds.x + 350, 'a+1');
  const secondLatex = await createEquation(bounds.x + 650, 'b+2');
  const first = page.getByRole('math', { name: firstLatex });
  const firstId = await first.getAttribute('data-mixed-text-id');
  assertValue(firstId, 'first equation identity');
  const firstBounds = await first.boundingBox();
  assertValue(firstBounds, 'first element bounds');
  await page.mouse.click(
    firstBounds.x + firstBounds.width,
    firstBounds.y + firstBounds.height / 2,
  );
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();
  await page.keyboard.type('+c');
  const changedFirstLatex = await page
    .locator(`[data-mixed-text-id="${firstId ?? ''}"]`)
    .getAttribute('aria-label');
  assertValue(changedFirstLatex, 'changed first equation source');

  const second = page.getByRole('math', { name: secondLatex });
  const secondBounds = await second.boundingBox();
  assertValue(secondBounds, 'second element bounds');
  await page.mouse.click(
    secondBounds.x + secondBounds.width / 2,
    secondBounds.y + secondBounds.height / 2,
  );
  await expect(mathField).toBeFocused();
  await expect.poll(() => activeMathLatex(mathField)).toBe(secondLatex);
  await expect(
    page.getByRole('math', { name: changedFirstLatex ?? '' }),
  ).toBeVisible();
});

test('writes and independently resumes two equations at different positions', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');
  const mathField = page.locator('math-field');

  const beginEquation = async (x: number, y: number) => {
    await createEmptyMathRegion(page, x, y);
    await expect(mathField).toBeFocused();
    await expect(page.locator('.inline-math-editor')).toHaveCSS('opacity', '1');
  };

  await beginEquation(bounds.x + 320, bounds.y + 220);
  await page.keyboard.type('a/b');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('+c/d');
  const firstLatex = await activeMathLatex(mathField);
  expect(firstLatex).toBe(String.raw`\frac{a}{b}+\frac{c}{d}`);
  await page.mouse.click(bounds.x + 80, bounds.y + bounds.height - 50);
  await expect(mathField).toHaveCount(0);

  await beginEquation(bounds.x + 680, bounds.y + 420);
  await page.keyboard.type('sqrtx^2');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('+y/2');
  const secondLatex = await activeMathLatex(mathField);
  expect(secondLatex).toBe(String.raw`\sqrt{x^2}+\frac{y}{2}`);
  await page.mouse.click(bounds.x + 80, bounds.y + bounds.height - 50);
  await expect(mathField).toHaveCount(0);

  const first = page.getByRole('math', { name: firstLatex });
  const second = page.getByRole('math', { name: secondLatex });
  const firstId = await first.getAttribute('data-mixed-text-id');
  const secondId = await second.getAttribute('data-mixed-text-id');
  assertValue(firstId, 'first equation identity');
  assertValue(secondId, 'second equation identity');
  const firstBounds = await first.boundingBox();
  const secondBounds = await second.boundingBox();
  assertValue(firstBounds, 'first equation bounds');
  assertValue(secondBounds, 'second equation bounds');
  expect(Math.abs(firstBounds.x - secondBounds.x)).toBeGreaterThan(250);
  expect(Math.abs(firstBounds.y - secondBounds.y)).toBeGreaterThan(150);

  await page.mouse.click(
    firstBounds.x + firstBounds.width - 1,
    firstBounds.y + firstBounds.height / 2,
  );
  await expect(mathField).toBeFocused();
  await page.keyboard.type('+1');
  const updatedFirst = await page
    .locator(`[data-mixed-text-id="${firstId ?? ''}"]`)
    .getAttribute('aria-label');
  assertValue(updatedFirst, 'updated first equation source');

  const currentSecondBounds = await second.boundingBox();
  assertValue(currentSecondBounds, 'currentSecondBounds');
  await page.mouse.click(
    currentSecondBounds.x + currentSecondBounds.width - 1,
    currentSecondBounds.y + currentSecondBounds.height / 2,
  );
  await expect(mathField).toBeFocused();
  await expect.poll(() => activeMathLatex(mathField)).toBe(secondLatex);
  await page.keyboard.type('=0');
  const updatedSecond = await page
    .locator(`[data-mixed-text-id="${secondId ?? ''}"]`)
    .getAttribute('aria-label');
  assertValue(updatedSecond, 'updated second equation source');
  await page.mouse.click(bounds.x + 80, bounds.y + bounds.height - 50);
  await expect(mathField).toHaveCount(0);

  await expect(
    page.getByRole('math', { name: updatedFirst ?? '' }),
  ).toBeVisible();
  await expect(
    page.getByRole('math', { name: updatedSecond ?? '' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('math', { name: updatedFirst ?? '' }),
  ).toBeVisible();
  await expect(
    page.getByRole('math', { name: updatedSecond ?? '' }),
  ).toBeVisible();
});

test('alternates between two equations one symbol at a time', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');
  const mathField = page.locator('math-field');

  const createEquation = async (x: number, y: number, symbol: string) => {
    await createEmptyMathRegion(page, x, y);
    await expect(mathField).toBeFocused();
    await page.locator('.inline-math-editor.is-ready').waitFor();
    await page.keyboard.type(symbol);
    const latex = await activeMathLatex(mathField);
    await page.mouse.click(bounds.x + 80, bounds.y + bounds.height - 50);
    await expect(mathField).toHaveCount(0);
    return latex;
  };

  let firstLatex = await createEquation(bounds.x + 320, bounds.y + 220, 'a');
  let secondLatex = await createEquation(bounds.x + 680, bounds.y + 420, 'x');
  const steps = [
    { symbol: '+', target: 'first' },
    { symbol: '-', target: 'second' },
    { symbol: 'b', target: 'first' },
    { symbol: 'y', target: 'second' },
    { symbol: '=', target: 'first' },
    { symbol: '=', target: 'second' },
    { symbol: 'c', target: 'first' },
    { symbol: '2', target: 'second' },
  ] as const;

  for (const { symbol, target } of steps) {
    const latex = target === 'first' ? firstLatex : secondLatex;
    const rendered = page.getByRole('math', { name: latex });
    const renderedBounds = await rendered.boundingBox();
    assertValue(renderedBounds, 'rendered element bounds');
    await page.mouse.click(
      renderedBounds.x + renderedBounds.width - 1,
      renderedBounds.y + renderedBounds.height / 2,
    );
    await expect(mathField).toBeFocused();
    await page.locator('.inline-math-editor.is-ready').waitFor();
    await expect.poll(() => activeMathLatex(mathField)).toBe(latex);
    await page.keyboard.type(symbol);
    const updated = await activeMathLatex(mathField);
    if (target === 'first') firstLatex = updated;
    else secondLatex = updated;
  }

  await page.mouse.click(bounds.x + 80, bounds.y + bounds.height - 50);
  await expect(mathField).toHaveCount(0);
  expect(firstLatex).toBe('a+b=c');
  expect(secondLatex).toBe('x-y=2');
  await expect(page.getByRole('math', { name: firstLatex })).toBeVisible();
  await expect(page.getByRole('math', { name: secondLatex })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('math', { name: firstLatex })).toBeVisible();
  await expect(page.getByRole('math', { name: secondLatex })).toBeVisible();
});

test('alternates rightward caret clicks between two equations without arrow keys', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');
  const mathField = page.locator('math-field');

  const createEquation = async (x: number, y: number, source: string) => {
    await createEmptyMathRegion(page, x, y);
    await expect(mathField).toBeFocused();
    await page.keyboard.type(source);
    const latex = await activeMathLatex(mathField);
    await page.mouse.click(bounds.x + 80, bounds.y + bounds.height - 50);
    await expect(mathField).toHaveCount(0);
    return latex;
  };

  const firstLatex = await createEquation(
    bounds.x + 300,
    bounds.y + 220,
    'a+b=c+d',
  );
  const secondLatex = await createEquation(
    bounds.x + 620,
    bounds.y + 420,
    'x-y=2z+3',
  );

  for (const clickMode of ['single', 'double'] as const) {
    const results: Record<
      'first' | 'second',
      { caretX: number; position: number }[]
    > = { first: [], second: [] };

    for (const ratio of [0.08, 0.28, 0.48, 0.68, 0.92]) {
      for (const [target, latex] of [
        ['first', firstLatex],
        ['second', secondLatex],
      ] as const) {
        const rendered = page.getByRole('math', { name: latex });
        const renderedBounds = await rendered.boundingBox();
        assertValue(renderedBounds, 'rendered element bounds');
        const point = {
          x: renderedBounds.x + renderedBounds.width * ratio,
          y: renderedBounds.y + renderedBounds.height / 2,
        };
        if (clickMode === 'double') {
          await page.mouse.dblclick(point.x, point.y, { delay: 30 });
        } else {
          await page.mouse.click(point.x, point.y);
        }
        await expect(mathField).toBeFocused();
        const editor = page.locator('.inline-math-editor');
        await expect(editor).toHaveCSS('opacity', '1');
        await expect(editor).toHaveClass(/is-ready/);
        await expect
          .poll(() =>
            mathField.evaluate((field) => ({
              caretCount: field.shadowRoot?.querySelectorAll(
                '.ML__caret, .ML__text-caret, .ML__latex-caret',
              ).length,
              selectionIsCollapsed: field.selectionIsCollapsed,
            })),
          )
          .toEqual({ caretCount: 1, selectionIsCollapsed: true });
        results[target].push(
          await mathField.evaluate((field) => {
            const caret = field.shadowRoot?.querySelector(
              '.ML__caret, .ML__text-caret, .ML__latex-caret',
            );
            if (caret === null || caret === undefined) {
              return { caretX: Number.NaN, position: field.position };
            }
            return {
              caretX: caret.getBoundingClientRect().x,
              position: field.position,
            };
          }),
        );
      }
    }

    await page.mouse.click(bounds.x + 80, bounds.y + bounds.height - 50);
    await expect(mathField).toHaveCount(0);
    for (const equationResults of [results.first, results.second]) {
      for (let index = 1; index < equationResults.length; index += 1) {
        const previous = equationResults[index - 1];
        const current = equationResults[index];
        assertValue(previous, 'previous equation caret result');
        assertValue(current, 'current equation caret result');
        expect(current.position).toBeGreaterThan(previous.position);
        expect(current.caretX).toBeGreaterThan(previous.caretX);
      }
    }
  }
});

test('double-clicking an active equation keeps a caret instead of selecting a symbol', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 500, bounds.y + 300);
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();
  await page.keyboard.type('a+b=c+d');
  await page.mouse.click(bounds.x + 80, bounds.y + bounds.height - 50);
  await expect(mathField).toHaveCount(0);

  const rendered = page.getByRole('math', { name: 'a+b=c+d' });
  const renderedBounds = await rendered.boundingBox();
  assertValue(renderedBounds, 'rendered element bounds');
  await page.mouse.click(
    renderedBounds.x + renderedBounds.width / 2,
    renderedBounds.y + renderedBounds.height / 2,
  );
  await expect(mathField).toBeFocused();
  const fieldBounds = await mathField.boundingBox();
  assertValue(fieldBounds, 'active field bounds');

  for (let index = 0; index < 10; index += 1) {
    await page.mouse.dblclick(
      fieldBounds.x + fieldBounds.width / 2,
      fieldBounds.y + fieldBounds.height / 2,
      { delay: 30 },
    );
    await expect
      .poll(() =>
        mathField.evaluate((field) => ({
          caretCount: field.shadowRoot?.querySelectorAll(
            '.ML__caret, .ML__text-caret, .ML__latex-caret',
          ).length,
          selectionIsCollapsed: field.selectionIsCollapsed,
          selectedCount:
            field.shadowRoot?.querySelectorAll('.ML__selected').length,
        })),
      )
      .toEqual({
        caretCount: 1,
        selectedCount: 0,
        selectionIsCollapsed: true,
      });
  }

  await page.keyboard.type('Q');
  await expect.poll(() => activeMathLatex(mathField)).toBe('a+b=Qc+d');
});

test('editing keys cannot delete an existing board equation', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 430, bounds.y + 250);
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();
  await page.keyboard.type('abc');
  await finishEditing(page);

  const rendered = page.getByRole('math', { name: 'abc' });
  const renderedBounds = await rendered.boundingBox();
  assertValue(renderedBounds, 'rendered element bounds');
  await page.mouse.click(
    renderedBounds.x + renderedBounds.width - 2,
    renderedBounds.y + renderedBounds.height / 2,
  );
  await expect(mathField).toBeFocused();

  await page.keyboard.press('Backspace');
  await expect.poll(() => activeMathLatex(mathField)).toBe('ab');
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect.poll(() => activeMathLatex(mathField)).toBe('abc');
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
});

test('clicking selected equation resize corners still opens its editor', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 430, bounds.y + 250);
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();
  await page.keyboard.type('x^2+1');
  const latex = await activeMathLatex(mathField);
  await finishEditing(page);

  for (const [xRatio, yRatio] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    const rendered = page.getByRole('math', { name: latex });
    const renderedBounds = await rendered.boundingBox();
    assertValue(renderedBounds, 'rendered element bounds');
    const point = {
      x: renderedBounds.x + renderedBounds.width * xRatio,
      y: renderedBounds.y + renderedBounds.height * yRatio,
    };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 2, point.y + 1);
    await page.mouse.up();

    await expect(mathField).toBeFocused();
    await expect
      .poll(() =>
        mathField.evaluate((field) =>
          field.shadowRoot?.querySelector(
            '.ML__caret, .ML__text-caret, .ML__latex-caret',
          ) === null
            ? 'missing'
            : 'visible',
        ),
      )
      .toBe('visible');
    await finishEditing(page);
  }
});
