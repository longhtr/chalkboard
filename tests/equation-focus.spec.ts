/** Active equation focus, blur, toolbar interaction, outside clicks, remount, and teardown regression stories. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import {
  activeMathLatex,
  canvasBounds,
  createEmptyMathRegion,
  finishEditing,
} from './helpers/equationEditor';

import { activeMathFieldCaretStyle } from './helpers/mathField';
test('keeps touch editing active while using the MathLive keyboard', async ({
  browser,
}) => {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    viewport: { height: 600, width: 800 },
  });
  const page = await context.newPage();
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  if (bounds === null) {
    await context.close();
    throw new Error('Expected drawing canvas bounds on the touch page');
  }

  await createEmptyMathRegion(page, bounds.x + 400, bounds.y + 250, {
    touch: true,
  });
  const mathField = page.locator('math-field');
  const keyboard = page.locator('.ML__keyboard.is-visible');
  await expect(mathField).toBeAttached();
  await expect(keyboard).toBeVisible();

  const xKey = keyboard.locator('.MLK__keycap[aria-label="x"]').first();
  await xKey.dispatchEvent('pointerdown', {
    bubbles: true,
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: 'touch',
  });
  await xKey.dispatchEvent('pointerup', {
    bubbles: true,
    button: 0,
    buttons: 0,
    pointerId: 1,
    pointerType: 'touch',
  });
  await expect(mathField).toBeAttached();
  await expect.poll(() => activeMathLatex(mathField)).toBe('x');

  await finishEditing(page);
  await expect(mathField).toHaveCount(0);
  const rendered = page.getByRole('math', { name: 'x' });
  await expect(rendered).toBeVisible();
  const renderedBounds = await rendered.boundingBox();
  if (renderedBounds !== null) {
    await page.touchscreen.tap(
      renderedBounds.x + renderedBounds.width / 2,
      renderedBounds.y + renderedBounds.height / 2,
    );
    await expect(mathField).toBeFocused();
    await expect
      .poll(() =>
        mathField.evaluate((field) => {
          const caret = field.shadowRoot?.querySelector(
            '.ML__caret, .ML__text-caret, .ML__latex-caret',
          );
          if (caret === null || caret === undefined) return null;
          const style = getComputedStyle(caret, '::after');
          return [style.opacity, style.visibility];
        }),
      )
      .toEqual(['1', 'visible']);
  }
  await context.close();
});

test('keeps a new draft active when its field temporarily misses pointer input', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await page.mouse.click(bounds.x + 420, bounds.y + 240);
  const mathField = page.locator('math-field');
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('draft');
  const fieldBounds = await mathField.boundingBox();
  assertValue(fieldBounds, 'active field bounds');

  await mathField.evaluate((field) => {
    field.style.pointerEvents = 'none';
  });
  await page.mouse.click(
    fieldBounds.x + fieldBounds.width / 2,
    fieldBounds.y + fieldBounds.height / 2,
  );
  await expect(mathField).toBeFocused();
  await page.keyboard.type('!');
  await finishEditing(page);

  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await expect(page.getByRole('group', { name: /!/u })).toBeVisible();
});

test('keeps an active equation mounted while it moves outside the viewport', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 420, bounds.y + 240);
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();
  await page.keyboard.type('x+1');
  const latex = await activeMathLatex(mathField);

  await page.mouse.move(bounds.x + 700, bounds.y + 450);
  for (let index = 0; index < 4; index += 1) {
    await page.mouse.wheel(1000, 0);
  }
  await expect(mathField).toBeAttached();

  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(mathField).toHaveCount(0);
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
    .toBe(`$${latex}$`);
});

test('waits for fonts and stable MathLive focus before revealing re-entry', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalLoad = document.fonts.load.bind(document.fonts);
    const pendingLoads: (() => void)[] = [];
    Object.defineProperty(document.fonts, 'load', {
      configurable: true,
      value: (...args: Parameters<FontFaceSet['load']>) =>
        new Promise<FontFace[]>((resolve, reject) => {
          pendingLoads.push(() => originalLoad(...args).then(resolve, reject));
        }),
    });
    Object.defineProperty(window, '__resolveWorkspaceFontLoads', {
      value: () => pendingLoads.splice(0).forEach((load) => load()),
    });
  });
  await page.goto('/');
  await page
    .getByRole('application', { name: 'Chalkboard drawing canvas' })
    .waitFor();
  await page.evaluate(async () => {
    const boardId = window.location.pathname.split('/').at(-1) ?? '';
    const elements = [
      {
        backgroundColor: 'transparent',
        createdBy: 'local',
        fontSize: 32,
        height: 50,
        id: 'font-race-equation',
        source: String.raw`$\frac{x}{y}=1$`,
        opacity: 1,
        rotation: 0,
        strokeColor: '#1f2937',
        strokeWidth: 2,
        type: 'equation',
        width: 120,
        x: 0,
        y: 0,
      },
    ];
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('chalkboard-local');
      request.addEventListener('error', () => reject(request.error));
      request.addEventListener('success', () => {
        const database = request.result;
        const transaction = database.transaction('boards', 'readwrite');
        transaction.objectStore('boards').put({
          createdAt: Date.now(),
          elements,
          id: `local:${boardId}`,
          schemaVersion: 2,
          title: 'Untitled board',
          updatedAt: Date.now(),
        });
        transaction.addEventListener('complete', () => {
          database.close();
          resolve();
        });
        transaction.addEventListener('error', () => reject(transaction.error));
      });
    });
    localStorage.setItem(
      `chalkboard:local-document:${boardId}`,
      JSON.stringify(elements),
    );
  });
  await page.reload();
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();

  const rendered = page.getByRole('math', {
    name: String.raw`\frac{x}{y}=1`,
  });
  await expect(rendered).toBeVisible();
  const renderedBounds = await rendered.boundingBox();
  assertValue(renderedBounds, 'rendered element bounds');
  await page.mouse.click(
    renderedBounds.x + renderedBounds.width / 2,
    renderedBounds.y + renderedBounds.height / 2,
  );

  const mathField = page.locator('math-field');
  await expect(mathField).toBeAttached();
  await page.waitForTimeout(80);
  await expect(page.locator('.inline-math-editor')).toHaveCSS('opacity', '0');
  await expect(rendered).toBeVisible();
  await expect(page.locator('.pending-math-caret')).toHaveCount(0);

  await page.evaluate(() => {
    (
      window as typeof window & {
        __resolveWorkspaceFontLoads(): void;
      }
    ).__resolveWorkspaceFontLoads();
  });
  await expect(page.locator('.inline-math-editor')).toHaveCSS('opacity', '1');
  await expect(mathField).toBeFocused();
  await expect
    .poll(() =>
      mathField.evaluate((field) => ({
        fonts: document.fonts.status,
        keyboardSink:
          field.shadowRoot?.activeElement?.classList.contains(
            'ML__keyboard-sink',
          ),
      })),
    )
    .toEqual({ fonts: 'loaded', keyboardSink: true });
});

test('re-entry caret lands on atom boundaries and remains movable', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 430, bounds.y + 250);
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();
  await mathField.evaluate((field) => {
    field.value = 'x=123';
    field.dispatchEvent(
      new InputEvent('input', { bubbles: true, composed: true }),
    );
  });
  await finishEditing(page);
  await expect(mathField).toHaveCount(0);

  const rendered = page.getByRole('math', { name: 'x=123' });
  const equals = rendered.locator('.ML__cmr', { hasText: '=' });
  const equalsBounds = await equals.boundingBox();
  assertValue(equalsBounds, 'equals-sign bounds');
  await page.mouse.click(
    equalsBounds.x + equalsBounds.width / 2,
    equalsBounds.y + equalsBounds.height / 2,
  );
  await expect(mathField).toBeFocused();
  await expect(page.locator('.inline-math-editor')).toHaveCSS('opacity', '1');

  const caretDistanceFromEqualsEdge = await mathField.evaluate((field) => {
    const atoms = [...(field.shadowRoot?.querySelectorAll('.ML__cmr') ?? [])];
    const equalsAtom = atoms.find((atom) => atom.textContent === '=');
    const caret = field.shadowRoot?.querySelector(
      '.ML__caret, .ML__text-caret, .ML__latex-caret',
    );
    if (equalsAtom === undefined || caret === null || caret === undefined) {
      return Number.POSITIVE_INFINITY;
    }
    const atomBounds = equalsAtom.getBoundingClientRect();
    const caretBounds = caret.getBoundingClientRect();
    return Math.min(
      Math.abs(caretBounds.x - atomBounds.left),
      Math.abs(caretBounds.x - atomBounds.right),
    );
  });
  expect(caretDistanceFromEqualsEdge).toBeLessThan(1);

  const latexBounds = await mathField.evaluate((field) => {
    const latex = field.shadowRoot?.querySelector('.ML__latex');
    if (latex === null || latex === undefined) return null;
    const box = latex.getBoundingClientRect();
    return { height: box.height, width: box.width, x: box.x, y: box.y };
  });
  assertValue(latexBounds, 'rendered LaTeX bounds');
  await page.mouse.click(
    latexBounds.x + 1,
    latexBounds.y + latexBounds.height / 2,
  );
  const leftPosition = await mathField.evaluate((field) => field.position);
  await page.mouse.click(
    latexBounds.x + latexBounds.width - 1,
    latexBounds.y + latexBounds.height / 2,
  );
  await expect
    .poll(() => mathField.evaluate((field) => field.position))
    .toBeGreaterThan(leftPosition);
  await expect
    .poll(() =>
      mathField.evaluate((field) =>
        field.shadowRoot?.activeElement?.classList.contains(
          'ML__keyboard-sink',
        ),
      ),
    )
    .toBe(true);
});

test('continues a complex equation after committing it half-finished', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 500, bounds.y + 300);
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();

  await page.keyboard.type('a/');
  const halfFinished = await activeMathLatex(mathField);
  expect(halfFinished).toBe(String.raw`\frac{a}{}`);
  await page.mouse.click(bounds.x + 80, bounds.y + bounds.height - 50);
  await expect(mathField).toHaveCount(0);

  const partialRendering = page.getByRole('math', { name: halfFinished });
  await expect(partialRendering).toBeVisible();
  const denominator = partialRendering
    .locator('.ML__mfrac > .ML__vlist-t > .ML__vlist-r')
    .nth(1);
  await expect(denominator).toBeAttached();
  await expect.poll(() => denominator.boundingBox()).not.toBeNull();
  const denominatorBounds = await denominator.boundingBox();
  assertValue(denominatorBounds, 'denominator bounds');
  await page.mouse.click(
    denominatorBounds.x + denominatorBounds.width / 2,
    denominatorBounds.y + denominatorBounds.height / 2,
  );
  await expect(mathField).toBeFocused();
  await expect(page.locator('.inline-math-editor')).toHaveCSS('opacity', '1');
  await expect
    .poll(() => mathField.evaluate((field) => field.position))
    .toBe(3);

  await page.keyboard.type('b');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('+sqrtx^2');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('+1');
  const completed = await activeMathLatex(mathField);
  expect(completed).toBe(String.raw`\frac{a}{b}+\sqrt{x^2}+1`);

  await page.mouse.click(bounds.x + 80, bounds.y + bounds.height - 50);
  await expect(mathField).toHaveCount(0);
  await expect(page.getByRole('math', { name: completed })).toBeVisible();
});

test('window focus changes neither commit nor repair a broken caret', async ({
  context,
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 430, bounds.y + 250);
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();
  await page.keyboard.type('x=123');
  await page.mouse.click(bounds.x + 700, bounds.y + 500);
  const rendered = page.getByRole('math', { name: 'x=123' });
  const renderedBounds = await rendered.boundingBox();
  assertValue(renderedBounds, 'rendered element bounds');
  await page.mouse.click(
    renderedBounds.x + renderedBounds.width / 2,
    renderedBounds.y + renderedBounds.height / 2,
  );
  await expect(mathField).toBeFocused();
  await expect(page.locator('.inline-math-editor')).toHaveCSS('opacity', '1');

  const otherPage = await context.newPage();
  await otherPage.goto('about:blank');
  await otherPage.bringToFront();
  await page.waitForTimeout(180);
  await expect(mathField).toBeAttached();

  await page.bringToFront();
  await expect(mathField).toBeFocused();
  const latexBounds = await mathField.evaluate((field) => {
    const latex = field.shadowRoot?.querySelector('.ML__latex');
    if (latex === null || latex === undefined) return null;
    const box = latex.getBoundingClientRect();
    return { height: box.height, width: box.width, x: box.x, y: box.y };
  });
  assertValue(latexBounds, 'rendered LaTeX bounds');
  await page.mouse.click(
    latexBounds.x + 1,
    latexBounds.y + latexBounds.height / 2,
  );
  const leftPosition = await mathField.evaluate((field) => field.position);
  await page.mouse.click(
    latexBounds.x + latexBounds.width - 1,
    latexBounds.y + latexBounds.height / 2,
  );
  await expect
    .poll(() => mathField.evaluate((field) => field.position))
    .toBeGreaterThan(leftPosition);
  await otherPage.close();
});

test('keeps a caret visible after clicking outside and back into an equation', async ({
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
  await page.mouse.click(bounds.x + 700, bounds.y + 500);
  await expect(mathField).toBeFocused();
  await expect.poll(() => activeMathLatex(mathField)).toBe('');

  const rendered = page.getByRole('math', { name: latex });
  await expect(rendered).toBeVisible();
  const renderedBounds = await rendered.boundingBox();
  assertValue(renderedBounds, 'rendered element bounds');
  await page.mouse.move(renderedBounds.x + 8, renderedBounds.y + 8);
  await page.mouse.down();
  await page.mouse.move(renderedBounds.x + 10, renderedBounds.y + 9);
  await page.mouse.up();

  await expect(page.locator('.pending-math-caret')).toHaveCount(0);
  await expect(mathField).toBeFocused();
  const caretPosition = await mathField.evaluate((field) => ({
    lastOffset: field.lastOffset,
    position: field.position,
  }));
  expect(caretPosition.position).toBeLessThan(caretPosition.lastOffset);
  await page.waitForTimeout(1200);
  await expect
    .poll(() => activeMathFieldCaretStyle(mathField))
    .toMatchObject({
      animationDuration: '1s',
      animationIterationCount: 'infinite',
      animationName: 'chalkboard-caret-blink',
      visibility: 'visible',
    });
});
