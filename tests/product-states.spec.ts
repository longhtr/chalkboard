/** Visible empty, loading, offline, read-only, incompatible, storage-failure, and recovery states. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';

test('ignores a remembered cloud board when no account session exists', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chalkboard:last-cloud-board',
      JSON.stringify({
        id: 'deleted-cloud-board',
        role: 'owner',
        title: 'Deleted cloud board',
      }),
    );
  });

  await page.goto('/');

  await expect(page).toHaveURL(/\/local\/[0-9a-f-]+$/u);
  await expect(page.getByRole('button', { name: 'Share' })).toHaveCount(0);
  await expect(page.getByText(/Sign in to open this cloud board/u)).toHaveCount(
    0,
  );
});

test('opens and creates locally when secure-context randomUUID is unavailable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto('/local');
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  await page.getByRole('button', { name: 'Shape tool' }).click();
  await page.mouse.move(bounds.x + 420, bounds.y + 180);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 540, bounds.y + 260);
  await page.mouse.up();
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await expect(page.getByText('Local storage needs attention')).toHaveCount(0);
});

test('undoes and redoes consecutive shape creations in order', async ({
  page,
}) => {
  await page.goto('/local');
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  await page.getByRole('button', { name: 'Shape tool' }).click();

  for (const offset of [0, 180]) {
    await page.mouse.move(bounds.x + 420 + offset, bounds.y + 180);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 540 + offset, bounds.y + 260);
    await page.mouse.up();
  }
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();

  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
});

test('keeps local editing available when localStorage is blocked', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked by browser policy', 'SecurityError');
      },
    });
  });
  await page.goto('/local');

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  await expect(canvas).toBeVisible();
  await expect(page.getByText('Local storage needs attention')).toHaveCount(0);

  await page.getByRole('button', { name: 'Shape tool' }).click();
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.move(bounds.x + 360, bounds.y + 220);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 470, bounds.y + 300);
  await page.mouse.up();

  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
});

test('presents an unobstructed empty canvas for the first action', async ({
  page,
}) => {
  await page.goto('/local');
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  await expect(page.locator('#workspace-empty-state')).toHaveCount(0);

  await page.getByRole('button', { name: 'Shape tool' }).click();
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.move(bounds.x + 420, bounds.y + 220);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 520, bounds.y + 300);
  await page.mouse.up();

  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
});

test('announces an empty reference search with recovery guidance', async ({
  page,
}) => {
  await page.goto('/local');
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page
    .getByRole('button', { name: 'MathLive / LaTeX cheatsheet' })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'MathLive / LaTeX cheatsheet',
  });
  await dialog
    .getByRole('searchbox', { name: 'Search MathLive / LaTeX cheatsheet' })
    .fill('definitely-no-such-command');
  await expect(dialog.getByRole('status')).toHaveText(
    'No matching commands. Try a broader term.',
  );
});

test('keeps the mobile account prompt and action on one line', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/local');
  await page.getByRole('button', { name: 'Open account' }).click();

  const modeSwitch = page.locator('.account-mode-switch');
  const [promptTop, actionTop] = await modeSwitch.evaluate((element) => {
    const prompt = element.firstChild;
    const action = element.querySelector('button')?.firstChild;
    if (prompt === null || action === null) {
      throw new Error('Account mode switch text is missing');
    }
    return [prompt, action].map((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().top;
    });
  });

  expect(Math.abs((promptTop ?? 0) - (actionTop ?? 0))).toBeLessThanOrEqual(1);
});

test('fits ellipse and spline options before scrolling on phones', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/local');
  const styleContent = page.locator('.style-panel__content');
  const expectNoStyleOverflow = async () => {
    expect(
      await styleContent.evaluate((content) => content.scrollHeight),
    ).toBeLessThanOrEqual(
      (await styleContent.evaluate((content) => content.clientHeight)) + 1,
    );
  };

  await page.getByRole('button', { name: 'Line / curve tool' }).click();
  await page.getByRole('button', { name: 'Open element style' }).click();
  await page.getByRole('button', { name: 'Use spline path' }).click();
  await expectNoStyleOverflow();

  await page.getByRole('button', { name: 'Close element style' }).click();
  await page.getByRole('button', { name: 'Shape tool' }).click();
  await page.getByRole('button', { name: 'Open element style' }).click();
  await page
    .getByRole('button', {
      name: 'Use circle / ellipse shape',
    })
    .click();
  await expectNoStyleOverflow();
});

test('starts Board objects closed and remembers its choice on phones', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/local');
  const navigator = page.getByRole('complementary', {
    name: 'Board objects',
  });
  await page.getByRole('button', { name: 'Shape tool' }).click();
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(navigator).toHaveCount(0);

  await page.getByRole('button', { name: 'Board objects' }).click();
  await expect(navigator).toBeVisible();
  await page.keyboard.press('Control+3');
  await expect(navigator).toHaveCount(0);
  await page.keyboard.press('Control+1');
  await expect(navigator).toBeVisible();

  await navigator.getByRole('button', { name: 'Close board objects' }).click();
  await page.keyboard.press('Control+3');
  await page.keyboard.press('Control+1');
  await expect(navigator).toHaveCount(0);
});

test('grows Board objects with its list before scrolling on phones', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/local');
  const shapeTool = page.getByRole('button', { name: 'Shape tool' });
  const selectionTool = page.getByRole('button', { name: 'Selection tool' });
  const navigator = page.getByRole('complementary', {
    name: 'Board objects',
  });
  const drawShape = async (index: number) => {
    const x = 60 + (index % 3) * 80;
    const y = 180 + Math.floor(index / 3) * 100;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 50, y + 40);
    await page.mouse.up();
  };
  const openNavigator = async () => {
    if (await navigator.count()) return;
    await selectionTool.click();
    if (!(await navigator.count())) {
      await page.getByRole('button', { name: 'Board objects' }).click();
    }
    await expect(navigator).toBeVisible();
  };

  await shapeTool.click();
  await drawShape(0);
  await openNavigator();
  const compactBounds = await navigator.boundingBox();
  assertValue(compactBounds, 'compact Board objects bounds');
  const compactList = navigator.locator('.object-navigator__list');
  expect(
    await compactList.evaluate((list) => list.scrollHeight),
  ).toBeLessThanOrEqual(
    (await compactList.evaluate((list) => list.clientHeight)) + 1,
  );

  await navigator.getByRole('button', { name: 'Close board objects' }).click();
  await shapeTool.click();
  for (let index = 1; index < 10; index += 1) await drawShape(index);
  await openNavigator();
  const expandedBounds = await navigator.boundingBox();
  assertValue(expandedBounds, 'expanded Board objects bounds');
  expect(expandedBounds.height).toBeGreaterThan(compactBounds.height);
  expect(expandedBounds.y).toBeGreaterThanOrEqual(0);
  expect(expandedBounds.y + expandedBounds.height).toBeLessThanOrEqual(844);
  const expandedList = navigator.locator('.object-navigator__list');
  expect(
    await expandedList.evaluate((list) => list.scrollHeight),
  ).toBeGreaterThan(await expandedList.evaluate((list) => list.clientHeight));
});

test('keeps primary controls separated and reachable on a narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/local');
  const menu = page.getByRole('button', { name: 'Open board menu' });
  const account = page.getByRole('button', { name: 'Open account' });
  const toolbar = page.getByRole('toolbar', { name: 'Drawing tools' });
  const [menuBounds, accountBounds, toolbarBounds] = await Promise.all([
    menu.boundingBox(),
    account.boundingBox(),
    toolbar.boundingBox(),
  ]);
  assertValue(menuBounds, 'board menu bounds');
  assertValue(accountBounds, 'account control bounds');
  assertValue(toolbarBounds, 'toolbar bounds');
  await expect(page.getByRole('button', { name: 'Share' })).toHaveCount(0);
  expect(menuBounds.x + menuBounds.width).toBeLessThan(accountBounds.x);
  expect(toolbarBounds.y).toBeGreaterThan(700);
  expect(toolbarBounds.x).toBeGreaterThanOrEqual(0);
  expect(toolbarBounds.x + toolbarBounds.width).toBeLessThanOrEqual(390);

  await menu.click();
  const boardMenu = page.locator('.board-menu');
  await expect(boardMenu).toBeVisible();
  expect(
    await boardMenu.evaluate((panel) => panel.scrollHeight),
  ).toBeLessThanOrEqual(
    (await boardMenu.evaluate((panel) => panel.clientHeight)) + 1,
  );
  await expect(
    page.getByRole('button', { name: 'Export image' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Export image' }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export image' });
  await expect(exportDialog).toBeVisible();
  const dialogBounds = await exportDialog.boundingBox();
  assertValue(dialogBounds, 'dialog bounds');
  if (dialogBounds !== null) {
    expect(dialogBounds.x).toBeGreaterThanOrEqual(0);
    expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(390);
  }
});
