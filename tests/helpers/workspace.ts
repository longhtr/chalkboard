/** Opens a ready local workspace and exposes stable visible actions shared by browser stories. */
import { expect, type Page } from '@playwright/test';

export { readLocalDatabaseLayout } from './indexedDb';
export { openNewBoardTab } from './localBoards';
export { waitForPaint } from './presentation';

export async function seedRectangles(page: Page, count = 1): Promise<void> {
  await page.addInitScript((rectangleCount) => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify(
        Array.from({ length: rectangleCount }, (_, index) => ({
          backgroundColor: 'transparent',
          createdBy: 'local',
          height: 80,
          id: `seeded-rectangle-${index}`,
          opacity: 1,
          rotation: 0,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'rectangle',
          width: 120,
          x: -240 + index * 320,
          y: -100,
        })),
      ),
    );
  }, count);
}

export async function selectMixedTextTool(page: Page): Promise<void> {
  const tool = page.getByRole('button', { name: 'Mixed text block tool' });
  await tool.click();
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
}

export async function finishWorkspaceEditing(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(page.locator('math-field')).toHaveCount(0);
  await selectMixedTextTool(page);
}

export function activeCaretState(page: Page) {
  return page.locator('math-field').evaluate((field) => {
    const caret = field.shadowRoot?.querySelector(
      '.ML__caret, .ML__text-caret, .ML__latex-caret',
    );
    if (!(caret instanceof HTMLElement)) return null;
    const bounds = caret.getBoundingClientRect();
    const style = getComputedStyle(caret, '::after');
    return {
      bottom: style.bottom,
      className: caret.className,
      height: style.height,
      transform: style.transform,
      visibility: style.visibility,
      x: bounds.x,
    };
  });
}
