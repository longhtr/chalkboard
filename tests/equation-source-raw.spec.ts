/**
 * Source view is a raw text editor.
 *
 * It used to re-parse the whole block on every keystroke: an unbalanced `$`
 * reinterpreted the rest of the block as math, `expandTextColors` then injected
 * markers against that reading, and `setValue` rebuilt the document before the
 * next character arrived. Half-typed states are normal while writing, so the
 * characters typed are now held exactly as typed and parsed once, on the way
 * back to the rendered view.
 */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';

const SEED = 'Alpha $x^2$ beta\nSecond $y$ line';

// Every one of these is a legal intermediate state while writing source:
// an unbalanced delimiter, an unclosed group, blank lines, a bare `$$`.
const RAW = 'Raw $ unbalanced \\frac{ and\nnewline $a$ tail\n\n$$ x';

async function openSeededSource(page: import('@playwright/test').Page) {
  await page.addInitScript((source) => {
    localStorage.setItem('chalkboard:equation-editing-view', 'source');
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 24,
          height: 120,
          id: 'src-block',
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
  }, SEED);
  await page.goto('/');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const rendered = page.locator('[data-mixed-text-id="src-block"]');
  await rendered.waitFor();
  const box = await rendered.boundingBox();
  assertValue(box, 'block box');
  await page.mouse.click(box.x + 30, box.y + 12);
  return page.getByRole('textbox', { name: 'Block source' });
}

test('keeps half-typed source exactly as written', async ({ page }) => {
  const editor = await openSeededSource(page);
  await expect(editor).toBeVisible();

  await editor.fill(RAW);
  await expect(editor).toHaveValue(RAW);

  // The block carries the characters typed, not a reinterpretation of them.
  await expect(
    page.locator('[data-mixed-text-id="src-block"]'),
  ).toHaveAttribute('aria-label', RAW);

  // Round-tripping through the rendered view must not rewrite the source.
  await page.getByRole('button', { name: 'Use rendered editing view' }).click();
  await page.getByRole('button', { name: 'Use source editing view' }).click();
  await expect(editor).toHaveValue(RAW);
});

test('leaves the rendered field alone until source view is left', async ({
  page,
}) => {
  const editor = await openSeededSource(page);
  await expect(editor).toBeVisible();
  const field = page.locator('math-field');
  const fieldValue = () =>
    field.evaluate((node) => (node as unknown as { value: string }).value);
  const before = await fieldValue();

  await editor.fill(RAW);
  await page.waitForTimeout(300);

  // Re-parsing each keystroke rebuilt the whole document through `setValue`,
  // which is both the source of the half-typed reinterpretation and the cost
  // that made a large block lag while typing.
  expect(await fieldValue()).toBe(before);

  await page.getByRole('button', { name: 'Use rendered editing view' }).click();
  await expect.poll(fieldValue).not.toBe(before);
});

test('types a newline and a dollar sign literally in source view', async ({
  page,
}) => {
  const editor = await openSeededSource(page);
  await editor.fill('');
  await editor.click();

  await page.keyboard.type('one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('two$three');
  await expect(editor).toHaveValue('one\ntwo$three');
});

test('keeps source undo history as one rendered transaction', async ({
  page,
}) => {
  const editor = await openSeededSource(page);
  await editor.press('End');
  await editor.pressSequentially('Z');
  await expect(editor).toHaveValue(`${SEED}Z`);

  await editor.press('Control+z');
  await expect(editor).toHaveValue(SEED);
  await editor.press('Control+y');
  await expect(editor).toHaveValue(`${SEED}Z`);

  await page.getByRole('button', { name: 'Use rendered editing view' }).click();
  const published = page.locator('[data-mixed-text-id="src-block"]');
  await expect(published).toHaveAttribute('aria-label', `${SEED}Z`);
  await page.keyboard.press('Control+z');
  await expect(published).toHaveAttribute('aria-label', SEED);
  await page.keyboard.press('Control+y');
  await expect(published).toHaveAttribute('aria-label', `${SEED}Z`);
});

test('drops the math and text input mode while editing source', async ({
  page,
}) => {
  const editor = await openSeededSource(page);
  await expect(editor).toBeVisible();

  // No math/text mode applies to raw characters, so the tool reports source
  // and the inspector offers no mode to choose.
  await expect(page.locator('.mixed-text-tool-mode')).toHaveText('S');
  await expect(page.getByText('Input mode', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Input mode' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Use rendered editing view' }).click();
  await expect(page.locator('.mixed-text-tool-mode')).not.toHaveText('S');
  await expect(page.getByRole('group', { name: 'Input mode' })).toBeVisible();
});
