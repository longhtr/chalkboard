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
  await expect(sourceEditor).toHaveCSS('font-size', '30px');
  await expect(sourceEditor).toHaveCSS('font-family', /KaTeX_Main/u);
  await page.getByRole('button', { name: 'Use rendered editing view' }).click();
  const field = page.locator('math-field');
  await expect(field).toHaveCSS('font-size', '35px');
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
  await expect(sourceEditor).toHaveCSS('font-size', '35px');
  await expect(
    page.getByRole('spinbutton', { name: 'Text size input' }),
  ).toHaveValue('35');
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
  await expect(page.getByRole('group', { name: 'Input mode' })).toBeVisible();
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
  await editingView
    .getByRole('button', { name: 'Use rendered editing view' })
    .click();
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
