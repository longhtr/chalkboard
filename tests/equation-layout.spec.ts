/** Active/inactive equation geometry, caret placement, selection overlay, camera transform, and alignment stories. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import {
  activeMathLatex,
  canvasBounds,
  createEmptyMathRegion,
  finishEditing,
} from './helpers/equationEditor';
import { waitForPaint } from './helpers/presentation';

type Bounds = Record<'height' | 'width' | 'x' | 'y', number>;

function expectAlignedBounds(
  editable: Bounds,
  rendered: Bounds,
  widthTolerance = 0.1,
) {
  for (const property of ['height', 'width', 'x', 'y'] as const) {
    const tolerance = property === 'width' ? widthTolerance : 0.1;
    expect(
      Math.abs(editable[property] - rendered[property]),
      property,
    ).toBeLessThan(tolerance);
  }
}

async function editableLatexBounds(page: import('@playwright/test').Page) {
  return page.locator('math-field').evaluate((field) => {
    const latex = field.shadowRoot?.querySelector('.ML__latex');
    if (!(latex instanceof HTMLElement)) return null;
    const { height, width, x, y } = latex.getBoundingClientRect();
    return { height, width, x, y };
  });
}

test('keeps rendered and editable layout identical across equation structures', async ({
  page,
}) => {
  test.slow();
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  const formulas = [
    'x^2+1',
    String.raw`\frac{a}{b}`,
    String.raw`\sqrt{x+1}`,
    String.raw`\frac{1}{1+\frac{1}{x}}`,
    String.raw`\sum_{i=1}^{n}i`,
    String.raw`\int_0^\infty e^{-x^2}dx`,
    String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`,
    String.raw`\begin{cases}x^2&x>0\\-x&x\leq0\end{cases}`,
    String.raw`\mathbb{R}\to\mathcal{F}`,
    String.raw`\text{hello world}+\alpha`,
  ];

  await createEmptyMathRegion(page, bounds.x + 480, bounds.y + 260);
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();

  for (const source of formulas) {
    await mathField.evaluate((field, latex) => {
      field.value = latex;
      field.dispatchEvent(
        new InputEvent('input', { bubbles: true, composed: true }),
      );
    }, source);
    const latex = await activeMathLatex(mathField);
    await finishEditing(page);

    const rendered = page.getByRole('math', { name: latex });
    await expect(rendered).toBeVisible();
    const renderedLatexBounds = await rendered
      .locator('.ML__latex')
      .boundingBox();
    const renderedBounds = await rendered.boundingBox();
    assertValue(renderedLatexBounds, 'rendered LaTeX bounds');
    assertValue(renderedBounds, 'rendered equation bounds');

    await page.mouse.click(
      renderedBounds.x + renderedBounds.width / 2,
      renderedBounds.y + renderedBounds.height / 2,
    );
    await expect(mathField).toBeFocused();
    await expect(page.locator('.inline-math-editor')).toHaveCSS('opacity', '1');
    const editableBounds = await editableLatexBounds(page);
    assertValue(editableBounds, 'active editor bounds');
    expectAlignedBounds(editableBounds, renderedLatexBounds, 0.6);
  }

  await finishEditing(page);
});

test('keeps rendered and editable layout aligned across zoom levels', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 500, bounds.y + 300);
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();
  await mathField.evaluate((field) => {
    field.value = String.raw`\frac{1}{1+\frac{1}{x}}`;
    field.dispatchEvent(
      new InputEvent('input', { bubbles: true, composed: true }),
    );
  });
  const latex = await activeMathLatex(mathField);

  await finishEditing(page);

  for (const zoomButton of [
    page.getByRole('button', { name: 'Zoom in' }),
    page.getByRole('button', { name: 'Zoom out' }),
  ]) {
    await zoomButton.click();
    await waitForPaint(page);
    const rendered = page.getByRole('math', { name: latex });
    const renderedBounds = await rendered.boundingBox();
    const renderedLatexBounds = await rendered
      .locator('.ML__latex')
      .boundingBox();
    assertValue(renderedBounds, 'rendered equation bounds');
    assertValue(renderedLatexBounds, 'rendered LaTeX bounds');
    await page.mouse.click(
      renderedBounds.x + renderedBounds.width / 2,
      renderedBounds.y + renderedBounds.height / 2,
    );
    await expect(mathField).toBeFocused();
    await expect(page.locator('.inline-math-editor')).toHaveCSS('opacity', '1');
    const editableBounds = await editableLatexBounds(page);
    assertValue(editableBounds, 'active editor bounds');
    expectAlignedBounds(editableBounds, renderedLatexBounds);
    await finishEditing(page);
  }
});
