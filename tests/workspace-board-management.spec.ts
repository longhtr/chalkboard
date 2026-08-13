/** Local board workflows plus readable board, export, and keyboard dialog presentation. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import * as workspace from './helpers/workspace';

test('keeps the board window open when the open board is trashed', async ({
  page,
}) => {
  await page.goto('/local');
  await page.getByRole('textbox', { name: 'Board title' }).fill('First board');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const boardId = window.location.pathname.split('/').at(-1) ?? '';
        return localStorage.getItem(`chalkboard:local-title:${boardId}`);
      }),
    )
    .toBe('First board');
  const firstBoardUrl = page.url();
  const openBoardPage = await workspace.openNewBoardTab(page);
  await expect(page).toHaveURL(firstBoardUrl);
  await expect(
    openBoardPage.getByRole('textbox', { name: 'Board title' }),
  ).toHaveValue('Untitled board');
  await openBoardPage
    .getByRole('textbox', { name: 'Board title' })
    .fill('Open board');
  await expect
    .poll(() =>
      openBoardPage.evaluate(() => {
        const boardId = window.location.pathname.split('/').at(-1) ?? '';
        return localStorage.getItem(`chalkboard:local-title:${boardId}`);
      }),
    )
    .toBe('Open board');
  const secondOpenBoardPage = await page.context().newPage();
  await secondOpenBoardPage.goto(openBoardPage.url());
  await expect(
    secondOpenBoardPage.getByRole('textbox', { name: 'Board title' }),
  ).toHaveValue('Open board');
  await openBoardPage.getByRole('button', { name: 'Open board menu' }).click();
  await openBoardPage.getByRole('button', { name: 'Open boards' }).click();

  const library = openBoardPage.getByRole('dialog', { name: 'Boards' });
  const currentEntry = library.locator(
    '.local-board-library__entry.is-current',
  );
  await expect(
    currentEntry.getByRole('button', { exact: true, name: 'Open Open board' }),
  ).toBeVisible();
  await currentEntry.getByRole('button', { name: 'Trash' }).click();

  await expect(library).toBeVisible();
  await expect(
    library
      .locator('.local-board-library__entry.is-current')
      .getByRole('button', { exact: true, name: 'Open First board' }),
  ).toBeVisible();
  await expect(
    openBoardPage.getByRole('textbox', { name: 'Board title' }),
  ).toHaveValue('First board');
  await expect(
    secondOpenBoardPage.getByRole('textbox', { name: 'Board title' }),
  ).toHaveValue('First board');
  await expect(secondOpenBoardPage).toHaveURL(firstBoardUrl);
  await secondOpenBoardPage.close();
  await openBoardPage.close();
});

test('creates a replacement after the only open local board is trashed', async ({
  page,
}) => {
  await page.goto('/local');
  await page.getByRole('textbox', { name: 'Board title' }).fill('Only board');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const boardId = window.location.pathname.split('/').at(-1) ?? '';
        return localStorage.getItem(`chalkboard:local-title:${boardId}`);
      }),
    )
    .toBe('Only board');
  const trashedUrl = page.url();

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Open boards' }).click();
  const library = page.getByRole('dialog', { name: 'Boards' });
  const currentEntry = library.locator(
    '.local-board-library__entry.is-current',
  );
  const trash = currentEntry.getByRole('button', { name: 'Trash' });
  await expect(trash).toBeEnabled();
  await trash.click();

  await expect(library).toHaveCount(0);
  await expect(page).not.toHaveURL(trashedUrl);
  await expect(page).toHaveURL(/\/local\/[^/]+$/u);
  await expect(page.getByRole('textbox', { name: 'Board title' })).toHaveValue(
    'Untitled board',
  );
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Open boards' }).click();
  const reopenedLibrary = page.getByRole('dialog', { name: 'Boards' });
  await expect(
    reopenedLibrary
      .getByRole('list', { name: 'On this device' })
      .locator('.local-board-library__open'),
  ).toHaveCount(1);
  await expect(
    reopenedLibrary.getByRole('button', { name: 'Device trash (1)' }),
  ).toBeVisible();
});

test('closes the board menu when the canvas is clicked', async ({ page }) => {
  await page.goto('/');
  const menuButton = page.getByRole('button', { name: 'Open board menu' });
  await menuButton.click();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Grid' }).click();
  await expect(page.getByRole('switch', { name: 'Grid' })).toBeVisible();

  await page
    .getByRole('application', { name: 'Chalkboard drawing canvas' })
    .click({ position: { x: 700, y: 500 } });

  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('switch', { name: 'Grid' })).toHaveCount(0);
  await menuButton.click();
  await expect(page.getByRole('button', { name: 'Grid' })).toBeVisible();
});

test('opens a rendered MathLive and LaTeX cheatsheet from the board menu', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Math / LaTeX cheatsheet' }).click();

  const dialog = page.getByRole('dialog', {
    name: 'MathLive / LaTeX cheatsheet',
  });
  await expect(dialog).toBeVisible();
  for (const heading of [
    'Basics & structure',
    'Greek & constants',
    'Operators & relations',
    'Sets & logic',
    'Calculus & functions',
    'Accents & annotations',
    'Fonts & spacing',
    'Matrices & layouts',
    'Trigonometry & functions',
    'Geometry & vectors',
    'Probability & statistics',
    'Delimiters & sizing',
  ]) {
    await expect(dialog.getByRole('heading', { name: heading })).toBeVisible();
  }
  await expect(dialog.locator('.latex-cheatsheet-entry')).toHaveCount(136);
  const fractionSource = dialog
    .locator('code')
    .filter({ hasText: String.raw`\frac{a}{b}` });
  await expect(fractionSource).toBeVisible();
  await expect(fractionSource).toHaveCSS('user-select', 'text');
  const selectedSource = await fractionSource.evaluate((code) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(code);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.addEventListener(
      'copy',
      () => {
        document.body.dataset.copiedCheatsheetText =
          window.getSelection()?.toString() ?? '';
      },
      { once: true },
    );
    return selection?.toString();
  });
  expect(selectedSource).toBe(String.raw`\frac{a}{b}`);
  await page.keyboard.press('Control+c');
  await expect
    .poll(() => page.evaluate(() => document.body.dataset.copiedCheatsheetText))
    .toBe(String.raw`\frac{a}{b}`);
  await expect(
    dialog.locator('.latex-cheatsheet-entry__preview .ML__latex'),
  ).toHaveCount(136);
  await expect(
    dialog.locator('.latex-cheatsheet-entry__preview .ML__error'),
  ).toHaveCount(0);
  await expect(
    dialog.locator('.latex-cheatsheet-entry code').first(),
  ).toHaveCSS('font-size', '14px');
  const firstPreview = dialog
    .locator('.latex-cheatsheet-entry__preview')
    .first();
  await expect(firstPreview).toHaveCSS('font-size', '24px');
  await expect(firstPreview).toHaveCSS('user-select', 'text');
  await expect
    .poll(() =>
      dialog
        .locator('.latex-cheatsheet-entry__preview')
        .evaluateAll((previews) =>
          previews.every((preview) => {
            const rendering = preview.querySelector('.ML__latex');
            if (!(rendering instanceof HTMLElement)) return false;
            const bounds = preview.getBoundingClientRect();
            const renderedBounds = rendering.getBoundingClientRect();
            const tolerance = 1;
            return (
              renderedBounds.left >= bounds.left - tolerance &&
              renderedBounds.right <= bounds.right + tolerance &&
              renderedBounds.top >= bounds.top - tolerance &&
              renderedBounds.bottom <= bounds.bottom + tolerance
            );
          }),
        ),
    )
    .toBe(true);
  const search = page.getByRole('searchbox', {
    name: 'Search MathLive / LaTeX cheatsheet',
  });
  await search.fill('conditional probability');
  await expect(dialog.locator('.latex-cheatsheet-entry')).toHaveCount(1);
  await expect(dialog.getByText('Conditional probability')).toBeVisible();
  await search.fill('');
  await expect(dialog.locator('.latex-cheatsheet-entry')).toHaveCount(136);
  await expect(
    page.getByRole('button', { name: 'Close MathLive / LaTeX cheatsheet' }),
  ).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('navigates and selects board objects without canvas hit-testing', async ({
  page,
}) => {
  await workspace.seedRectangles(page, 2);
  await page.goto('/');

  const navigator = page.getByRole('complementary', {
    name: 'Board objects',
  });
  await expect(navigator).toHaveCount(0);
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(navigator).toBeVisible();
  await navigator.getByRole('button', { name: 'Close board objects' }).click();
  await expect(navigator).toHaveCount(0);
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(navigator).toHaveCount(0);
  await page.getByRole('button', { name: 'Board objects' }).click();
  await expect(navigator).toBeVisible();
  await expect(navigator.getByText('2 objects')).toBeVisible();
  await expect(navigator.getByText('Topmost first')).toHaveCount(0);
  await expect(
    navigator.getByRole('heading', { name: 'Board objects' }),
  ).toHaveCSS('font-size', '17px');
  await expect(
    navigator.locator('.object-navigator__details strong').first(),
  ).toHaveCSS('font-size', '14px');

  await page.keyboard.press('Control+1');
  await expect(navigator).toHaveCount(0);
  await page.keyboard.press('Control+1');
  await expect(navigator).toBeVisible();

  await navigator
    .getByRole('button', { name: 'Sort by vertical position' })
    .click();
  await expect(
    navigator.getByRole('button', {
      name: 'Rectangle shape, object 1, position -240, -100',
    }),
  ).toBeVisible();
  await expect(
    navigator.getByRole('heading', { name: 'Layer order' }),
  ).toHaveCount(0);
  await expect(navigator.locator('.object-navigator__drag-handle')).toHaveCount(
    0,
  );
  await navigator.getByRole('button', { name: 'Sort by layer' }).click();

  const first = navigator.getByRole('button', {
    name: 'Rectangle shape, object 1, position 80, -100',
  });
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');

  const boardTitle = page.getByRole('textbox', { name: 'Board title' });
  await boardTitle.fill('Board');
  await boardTitle.press('Backspace');
  await expect(boardTitle).toHaveValue('Boar');
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const canvasBounds = await canvas.boundingBox();
  assertValue(canvasBounds, 'drawing canvas bounds');
  const secondCanvasPoint = {
    x: canvasBounds.x + canvasBounds.width / 2 - 320,
    y: canvasBounds.y + canvasBounds.height / 2 + 40,
  };
  await page.keyboard.down('Shift');
  await page.mouse.click(secondCanvasPoint.x, secondCanvasPoint.y);
  await page.keyboard.up('Shift');
  const second = navigator.getByRole('button', {
    name: 'Rectangle shape, object 2, position -240, -100',
  });
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(second).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.down('Shift');
  await page.mouse.click(secondCanvasPoint.x, secondCanvasPoint.y);
  await page.keyboard.up('Shift');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(second).toHaveAttribute('aria-pressed', 'false');

  await first.click();
  await navigator.getByRole('button', { name: 'Move down one' }).click();
  const movedSelection = navigator.getByRole('button', {
    name: 'Rectangle shape, object 2, position 80, -100',
  });
  await expect(movedSelection).toHaveAttribute('aria-pressed', 'true');
  await movedSelection
    .locator('..')
    .dragTo(navigator.locator('.object-navigator__drop-edge').first());
  const restoredTop = navigator.getByRole('button', {
    name: 'Rectangle shape, object 1, position 80, -100',
  });
  const restoredBottom = navigator.getByRole('button', {
    name: 'Rectangle shape, object 2, position -240, -100',
  });
  await expect(restoredTop).toHaveAttribute('aria-pressed', 'true');

  await restoredBottom.click({ modifiers: ['Shift'] });
  await expect(restoredTop).toHaveAttribute('aria-pressed', 'true');
  await expect(restoredBottom).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Delete');
  await expect(navigator.getByText('0 objects')).toBeVisible();
  await expect(navigator.getByRole('status')).toHaveText(
    'This board has no objects yet.',
  );
  await page.keyboard.press('Escape');
  await expect(navigator).toHaveCount(0);
});

test('renders and reorders image, text, and vector layers in one visual stack', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#1463ff"/></svg>';
    const common = {
      createdBy: 'local',
      height: 200,
      opacity: 1,
      rotation: 0,
      strokeStyle: 'solid',
      strokeWidth: 2,
      width: 200,
      x: -100,
      y: -100,
    };
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          ...common,
          backgroundColor: 'transparent',
          id: 'layer-image',
          name: 'Blue layer',
          source: `data:image/svg+xml;base64,${btoa(svg)}`,
          strokeColor: 'transparent',
          type: 'image',
        },
        {
          ...common,
          backgroundColor: 'transparent',
          fontSize: 25,
          id: 'layer-text',
          lineSpacing: 1.2,
          source: 'Layer text',
          strokeColor: '#1f2937',
          type: 'equation',
        },
        {
          ...common,
          backgroundColor: '#e03131',
          id: 'layer-shape',
          strokeColor: '#e03131',
          type: 'rectangle',
        },
      ]),
    );
  });
  await page.goto('/');

  const image = page.getByAltText('Blue layer');
  const textLayer = page.locator('.math-element');
  const vectorLayer = page.locator('.content-layer-run');
  await expect(image).toHaveCSS('z-index', '1');
  await expect(textLayer).toHaveCSS('z-index', '2');
  await expect(vectorLayer).toHaveCSS('z-index', '3');

  await page.getByRole('button', { name: 'Board objects' }).click();
  const navigator = page.getByRole('complementary', {
    name: 'Board objects',
  });
  await navigator.getByRole('button', { name: /Image: Blue layer/ }).click();
  await navigator.getByRole('button', { name: 'Move to top' }).click();

  await expect(image).toHaveCSS('z-index', '3');
  await expect(textLayer).toHaveCSS('z-index', '1');
  await expect(vectorLayer).toHaveCSS('z-index', '2');
  await expect(
    navigator.locator('[data-object-id]').first(),
  ).toHaveAccessibleName(/Image: Blue layer/);
});

test('clears the bottom-right storage warning after persistence recovers', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      value: unknown,
      key?: IDBValidKey,
    ) {
      const controls = window as typeof window & {
        failNextBoardWrite?: boolean;
      };
      if (
        controls.failNextBoardWrite === true &&
        this.name === 'boards' &&
        typeof value === 'object' &&
        value !== null &&
        'id' in value &&
        String(value.id).startsWith('local:')
      ) {
        controls.failNextBoardWrite = false;
        throw new DOMException(
          'Temporary storage failure',
          'InvalidStateError',
        );
      }
      return key === undefined
        ? put.call(this, value)
        : put.call(this, value, key);
    };
  });
  await page.goto('/');

  const title = page.getByRole('textbox', { name: 'Board title' });
  await expect(title).toBeVisible();
  await page.evaluate(() => {
    (
      window as typeof window & { failNextBoardWrite?: boolean }
    ).failNextBoardWrite = true;
  });
  await title.fill('A');

  const warning = page.getByRole('alert');
  await expect(warning).toContainText('Browser storage is unavailable');
  // Every transient notice shares one fixed container so two of them stack
  // instead of overlapping, so the corner anchor belongs to that container.
  await expect(page.locator('.status-stack')).toHaveCSS('position', 'fixed');
  expect(
    await warning.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        bottom: Math.round(window.innerHeight - bounds.bottom),
        right: Math.round(window.innerWidth - bounds.right),
      };
    }),
  ).toEqual({ bottom: 16, right: 16 });

  await title.fill('B');
  await expect(warning).toHaveCount(0);
});

test('selects every board object between two selected entries', async ({
  page,
}) => {
  await workspace.seedRectangles(page, 3);
  await page.goto('/');
  await page.getByRole('button', { name: 'Board objects' }).click();

  const navigator = page.getByRole('complementary', {
    name: 'Board objects',
  });
  await navigator
    .getByRole('button', { name: 'Sort by vertical position' })
    .click();
  const first = navigator.getByRole('button', {
    name: 'Rectangle shape, object 1, position -240, -100',
  });
  const middle = navigator.getByRole('button', {
    name: 'Rectangle shape, object 2, position 80, -100',
  });
  const last = navigator.getByRole('button', {
    name: 'Rectangle shape, object 3, position 400, -100',
  });

  await first.click();
  await last.click({ modifiers: ['Shift'] });
  await expect(middle).toHaveAttribute('aria-pressed', 'false');
  await navigator.getByRole('button', { name: 'Select all between' }).click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(middle).toHaveAttribute('aria-pressed', 'true');
  await expect(last).toHaveAttribute('aria-pressed', 'true');
});

test('keeps board, export, and keyboard dialog text readable', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();

  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('width', '750px');
  await expect(dialog.getByRole('heading', { name: 'Tools' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Editing' })).toBeVisible();
  await expect(
    dialog.getByRole('heading', { name: 'Mixed text' }),
  ).toBeVisible();
  const switchInputMode = dialog.getByText('Switch input mode');
  await expect(switchInputMode).toBeVisible();
  await expect(switchInputMode).toHaveCSS('font-size', '16px');
  await expect(dialog.getByText(/Use Ctrl on Windows/u)).toHaveCSS(
    'font-size',
    '13px',
  );
  await expect(
    page.getByRole('button', { name: 'Close keyboard shortcuts' }),
  ).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Export image' }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export image' });
  await expect(exportDialog).toHaveCSS('width', '528px');
  await expect(
    exportDialog.getByText('Whole board', { exact: true }),
  ).toHaveCSS('font-size', '14px');
  const selectionOption = exportDialog.getByText('Selection', { exact: true });
  await expect(selectionOption).toHaveCSS('cursor', 'not-allowed');
  await selectionOption.hover();
  const selectionTooltip = exportDialog.locator('.export-option-tooltip');
  await expect(selectionTooltip).toHaveText(
    'Exports only selected board objects. This option is available when one or more objects are selected before opening Export image.',
  );
  await expect(selectionTooltip).toHaveCSS('width', '300px');
  await expect(selectionTooltip).toHaveCSS('font-size', '14px');
  await expect(exportDialog.getByText('Top', { exact: true })).toHaveCSS(
    'font-size',
    '12px',
  );
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Open boards' }).click();
  const boardDialog = page.getByRole('dialog', { name: 'Boards' });
  await expect(
    boardDialog.locator('.local-board-library__open strong').first(),
  ).toHaveCSS('font-size', '15px');
  await expect(
    boardDialog.locator('.local-board-library__open small').first(),
  ).toHaveCSS('font-size', '12px');
  await expect(
    boardDialog.getByRole('button', { name: 'Rename' }).first(),
  ).toHaveCSS('font-size', '13px');
});

test('keeps the Information chooser open between dismissible pages', async ({
  page,
}) => {
  await page.goto('/');
  const menuButton = page.getByRole('button', { name: 'Open board menu' });
  await menuButton.click();
  await page.getByRole('button', { name: 'Information' }).click();

  const chooser = page.getByRole('menu', { name: 'Public information' });
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole('menuitem', { name: 'Privacy' })).toHaveCSS(
    'font-size',
    '13px',
  );
  await chooser.getByRole('menuitem', { name: 'Privacy' }).click();

  const privacyDialog = page.getByRole('dialog', { name: 'Privacy' });
  await expect(privacyDialog).toBeVisible();
  await expect(privacyDialog.locator('p').first()).toHaveCSS(
    'font-size',
    '16px',
  );
  await expect(
    privacyDialog.getByRole('heading', { level: 3 }).first(),
  ).toHaveCSS('font-size', '19px');
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  await expect(chooser).toBeVisible();

  await page
    .locator('.public-information-dialog-backdrop')
    .click({ position: { x: 8, y: 8 } });
  await expect(privacyDialog).toHaveCount(0);
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  await expect(chooser).toBeVisible();

  await chooser.getByRole('menuitem', { name: 'Terms' }).click();
  const termsDialog = page.getByRole('dialog', { name: 'Terms of use' });
  await expect(termsDialog).toBeVisible();
  await page.getByRole('button', { name: 'Close public information' }).click();
  await expect(termsDialog).toHaveCount(0);
  await expect(chooser).toBeVisible();
});
