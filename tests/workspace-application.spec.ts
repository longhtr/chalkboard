/** Application startup, top bar, dialogs, shortcuts, preferences, errors, and account-shell browser stories. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import * as workspace from './helpers/workspace';

declare global {
  interface Window {
    __chalkboardIndexedDbBlocker?: IDBDatabase;
  }
}

test('reorders tools and their shortcuts by dragging', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(50);

  const toolbarTools = page.locator('[data-toolbar-tool]');
  const toolNames = () =>
    toolbarTools.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label')),
    );
  const selectionBounds = await page
    .getByRole('button', { name: 'Selection tool' })
    .boundingBox();
  const mixedTextBounds = await page
    .getByRole('button', { name: 'Mixed text block tool' })
    .boundingBox();
  assertValue(selectionBounds, 'selection tool bounds');
  assertValue(mixedTextBounds, 'mixed-text tool bounds');
  await page.mouse.move(
    selectionBounds.x + selectionBounds.width / 2,
    selectionBounds.y + selectionBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    mixedTextBounds.x + mixedTextBounds.width / 2,
    mixedTextBounds.y + mixedTextBounds.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();

  await expect
    .poll(toolNames)
    .toEqual([
      'Drag canvas tool',
      'Shape tool',
      'Line / curve tool',
      'Mixed text block tool',
      'Selection tool',
    ]);
  await expect(toolbarTools.locator('.tool-shortcut')).toHaveText([
    '1',
    '2',
    '3',
    '4',
    '5',
  ]);

  await page.keyboard.press('Control+1');
  await expect(
    page.getByRole('button', { name: 'Drag canvas tool' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+5');
  await expect(
    page.getByRole('button', { name: 'Selection tool' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect
    .poll(toolNames)
    .toEqual([
      'Drag canvas tool',
      'Shape tool',
      'Line / curve tool',
      'Mixed text block tool',
      'Selection tool',
    ]);
});

test('changes tools from shortcuts and the editor chrome', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(50);
  await expect(
    page
      .getByRole('toolbar', { name: 'Drawing tools' })
      .locator('.tool-shortcut'),
  ).toHaveText(['1', '2', '3', '4', '5']);

  await page.keyboard.press('Control+2');
  await expect(
    page.getByRole('button', { name: 'Drag canvas tool' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+3');
  await expect(
    page.getByRole('button', { name: 'Shape tool' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+4');
  await expect(
    page.getByRole('button', { name: 'Line / curve tool' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+5');
  await expect(
    page.getByRole('button', { name: 'Mixed text block tool' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+1');
  await expect(
    page.getByRole('button', { name: 'Selection tool' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByRole('button', { name: '110%' })).toBeVisible();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect(page.getByRole('button', { name: '100%' })).toBeVisible();

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Grid' }).click();
  const gridToggle = page.getByRole('switch', { name: 'Grid' });
  await expect(gridToggle).toHaveAttribute('aria-checked', 'false');
  await gridToggle.click();
  await expect(gridToggle).toHaveAttribute('aria-checked', 'true');
});

test('migrates legacy singleton cache state to one generated board ID', async ({
  page,
}) => {
  await page.route('**/legacy-migration-fixture', async (route) => {
    await route.fulfill({
      body: '<!doctype html><title>Legacy migration fixture</title>',
      contentType: 'text/html',
      status: 200,
    });
  });
  await page.goto('/legacy-migration-fixture');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('chalkboard-local');
      request.addEventListener('success', () => resolve());
      request.addEventListener('error', () => reject(request.error));
      request.addEventListener('blocked', () =>
        reject(new Error('Legacy fixture database deletion was blocked')),
      );
    });
    localStorage.clear();
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 30,
          height: 40,
          id: 'legacy-equation',
          lineSpacing: 1.2,
          opacity: 1,
          rotation: 0,
          source: 'Legacy content',
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 180,
          x: -90,
          y: -20,
        },
      ]),
    );
    localStorage.setItem('chalkboard:local-title', 'Legacy board');
    localStorage.setItem(
      'chalkboard:caret-positions',
      JSON.stringify({ 'legacy-equation': 4 }),
    );
    localStorage.setItem('chalkboard:last-local-board', 'local');
  });
  await page.unroute('**/legacy-migration-fixture');

  await page.goto('/local');
  await expect(page).toHaveURL(/\/local\/[0-9a-f-]{36}$/i);
  const migratedUrl = page.url();
  await expect(page.getByRole('textbox', { name: 'Board title' })).toHaveValue(
    'Legacy board',
  );
  await expect(
    page.getByRole('group', { name: 'Legacy content' }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        legacyDocument: localStorage.getItem('chalkboard:local-document'),
        localBoards: [...Array(localStorage.length).keys()].filter((index) =>
          localStorage.key(index)?.startsWith('chalkboard:local-document:'),
        ).length,
      })),
    )
    .toEqual({ legacyDocument: null, localBoards: 1 });

  await page.reload();
  await expect(page).toHaveURL(migratedUrl);
  await expect(
    page.getByRole('group', { name: 'Legacy content' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Open boards' }).click();
  await expect(
    page.getByRole('button', { exact: true, name: 'Open Legacy board' }),
  ).toHaveCount(1);
});

test('recovers after an IndexedDB upgrade is blocked by another tab', async ({
  page,
}) => {
  const blocker = await page.context().newPage();
  await blocker.route('**/indexeddb-blocker', async (route) => {
    await route.fulfill({
      body: '<!doctype html><title>IndexedDB blocker</title>',
      contentType: 'text/html',
      status: 200,
    });
  });
  await blocker.goto('/indexeddb-blocker');
  await blocker.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('chalkboard-local', 4);
        request.addEventListener('upgradeneeded', () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('boards')) {
            database.createObjectStore('boards', { keyPath: 'id' });
          }
          if (!database.objectStoreNames.contains('images')) {
            database.createObjectStore('images', { keyPath: 'id' });
          }
        });
        request.addEventListener('error', () => reject(request.error));
        request.addEventListener('success', () => {
          window.__chalkboardIndexedDbBlocker = request.result;
          resolve();
        });
      }),
  );

  await page.goto('/local');
  await expect(page.getByText('Local storage needs attention')).toBeVisible();
  await blocker.evaluate(() => {
    const database = window.__chalkboardIndexedDbBlocker;
    if (database === undefined) {
      throw new Error('Expected the IndexedDB blocker connection');
    }
    database.close();
  });
  await blocker.close();
  await page.getByRole('button', { name: 'Try again' }).click();

  await expect(
    page.getByRole('application', { name: 'Chalkboard drawing canvas' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/local\/[0-9a-f-]{36}$/i);
  await expect
    .poll(() => workspace.readLocalDatabaseLayout(page))
    .toEqual({ hasBoardImageIndex: true, version: 5 });
});

test('silently replaces a missing local-board link with the current board', async ({
  page,
}) => {
  await page.goto('/local/missing-board');
  await expect(page).toHaveURL(/\/local\/(?!missing-board)[^/]+$/u);
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await expect(page.getByText('Board link unavailable')).toHaveCount(0);

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Open boards' }).click();
  const library = page.getByRole('dialog', { name: 'Boards' });
  await expect(
    library.getByRole('button', { name: /^Open Untitled board$/u }),
  ).toHaveCount(1);
  await expect(library.getByText('missing-board')).toHaveCount(0);
  await library.getByRole('button', { name: 'Close boards' }).click();
  const currentBoardUrl = page.url();

  await page.evaluate(() => {
    window.history.pushState(null, '', '/local/missing-from-history');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(currentBoardUrl);
  await expect(page.getByText('Board link unavailable')).toHaveCount(0);
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
});

test('preserves a corrupt local record while silently using the current board', async ({
  page,
}) => {
  await page.goto('/local');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('chalkboard-local');
      request.addEventListener('error', () => reject(request.error));
      request.addEventListener('success', () => {
        const database = request.result;
        const transaction = database.transaction('boards', 'readwrite');
        transaction.objectStore('boards').put({
          elements: [],
          id: 'local:corrupt-board',
          schemaVersion: 999,
          title: 'Do not overwrite',
          updatedAt: 1,
        });
        transaction.addEventListener('complete', () => {
          database.close();
          resolve();
        });
        transaction.addEventListener('error', () => reject(transaction.error));
      });
    });
  });

  await page.goto('/local/corrupt-board');
  await expect(page).toHaveURL(/\/local\/(?!corrupt-board)[^/]+$/u);
  await expect(page.getByText('Board link unavailable')).toHaveCount(0);
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number | null>((resolve, reject) => {
            const request = indexedDB.open('chalkboard-local');
            request.addEventListener('error', () => reject(request.error));
            request.addEventListener('success', () => {
              const database = request.result;
              const transaction = database.transaction('boards', 'readonly');
              const recordRequest = transaction
                .objectStore('boards')
                .get('local:corrupt-board');
              recordRequest.addEventListener('success', () => {
                const record = recordRequest.result as
                  { schemaVersion?: number } | undefined;
                database.close();
                resolve(record?.schemaVersion ?? null);
              });
              recordRequest.addEventListener('error', () =>
                reject(recordRequest.error),
              );
            });
          }),
      ),
    )
    .toBe(999);
});

test('lists the pristine default local board before the first edit', async ({
  page,
}) => {
  await page.goto('/local');
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Open boards' }).click();
  const library = page.getByRole('dialog', { name: 'Boards' });
  const deviceHeading = library.getByRole('heading', {
    name: 'On this device',
  });
  const cloudHeading = library.getByRole('heading', { name: 'On the cloud' });
  await expect(deviceHeading).toBeVisible();
  await expect(deviceHeading).toHaveCSS('color', 'rgb(34, 102, 71)');
  await expect(cloudHeading).toBeVisible();
  await expect(cloudHeading).toHaveCSS('color', 'rgb(52, 85, 164)');
  await expect(library.getByText('You are not signed in.')).toBeVisible();
  await expect(
    library.getByRole('button', { exact: true, name: 'Open Untitled board' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close boards' }).click();
  await page.reload();
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
});

test('creates and reopens multiple local boards without an account', async ({
  page,
}) => {
  await page.goto('/local');
  await page.getByRole('textbox', { name: 'Board title' }).fill('First board');
  const firstBoardUrl = page.url();
  await workspace.selectMixedTextTool(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.click(bounds.x + 420, bounds.y + 280);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('First content');
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(
    page.getByRole('group', { name: 'First content' }),
  ).toBeVisible();

  const secondPage = await workspace.openNewBoardTab(page);
  await expect(page).toHaveURL(firstBoardUrl);
  await expect(
    page.getByRole('group', { name: 'First content' }),
  ).toBeVisible();
  await expect(
    secondPage.getByRole('textbox', { name: 'Board title' }),
  ).toHaveValue('Untitled board');
  await expect(secondPage.getByText('Canvas contains 0 objects')).toBeVisible();
  await secondPage
    .getByRole('textbox', { name: 'Board title' })
    .fill('Second board');

  await secondPage.getByRole('button', { name: 'Open board menu' }).click();
  await secondPage.getByRole('button', { name: 'Open boards' }).click();
  const library = secondPage.getByRole('dialog', { name: 'Boards' });
  await expect(library).toBeVisible();
  await expect(
    library.getByRole('button', { exact: true, name: 'Open First board' }),
  ).toBeVisible();
  await expect(
    library.getByRole('button', { exact: true, name: 'Open Second board' }),
  ).toBeVisible();

  await library
    .getByRole('button', { exact: true, name: 'Open First board' })
    .click();
  await expect(secondPage).toHaveURL(firstBoardUrl);
  await expect(
    secondPage.getByRole('textbox', { name: 'Board title' }),
  ).toHaveValue('First board');
  await expect(
    secondPage.getByRole('group', { name: 'First content' }),
  ).toBeVisible();

  await secondPage.getByRole('button', { name: 'Open board menu' }).click();
  await secondPage.getByRole('button', { name: 'Open boards' }).click();
  const firstBoardEntry = secondPage.locator(
    '.local-board-library__entry.is-current',
  );
  await firstBoardEntry.getByRole('button', { name: 'Rename' }).click();
  await firstBoardEntry
    .getByRole('textbox', { name: 'Rename First board' })
    .fill('Renamed first board');
  await firstBoardEntry.getByRole('button', { name: 'Save' }).click();
  await expect(
    secondPage.getByRole('button', {
      exact: true,
      name: 'Open Renamed first board',
    }),
  ).toBeVisible();
  await secondPage.getByRole('button', { name: 'Close boards' }).click();
  await expect(
    secondPage.getByRole('textbox', { name: 'Board title' }),
  ).toHaveValue('Renamed first board');
  await secondPage.reload();
  await expect(
    secondPage.getByRole('textbox', { name: 'Board title' }),
  ).toHaveValue('Renamed first board');
  await expect(
    secondPage.getByRole('group', { name: 'First content' }),
  ).toBeVisible();

  await secondPage.getByRole('button', { name: 'Open board menu' }).click();
  await secondPage.getByRole('button', { name: 'Open boards' }).click();
  await expect(
    secondPage.getByRole('textbox', { name: 'New board' }),
  ).toHaveCount(0);
  await secondPage.getByRole('button', { name: 'Close boards' }).click();
  const previousBoardUrl = secondPage.url();
  const thirdPage = await workspace.openNewBoardTab(secondPage);
  await expect(secondPage).toHaveURL(previousBoardUrl);
  await thirdPage
    .getByRole('textbox', { name: 'Board title' })
    .fill('Third board');
  await expect(
    thirdPage.getByRole('textbox', { name: 'Board title' }),
  ).toHaveValue('Third board');
  await expect(thirdPage.getByText('Canvas contains 0 objects')).toBeVisible();
  await Promise.all([secondPage.close(), thirdPage.close()]);
});

test('moves local boards through durable trash, restores all, and empties trash', async ({
  page,
}) => {
  await page.goto('/local');
  await page.getByRole('textbox', { name: 'Board title' }).fill('Recover me');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const boardId = window.location.pathname.split('/').at(-1) ?? '';
        return localStorage.getItem(`chalkboard:local-title:${boardId}`) ?? '';
      }),
    )
    .toBe('Recover me');

  const recoverBoardUrl = page.url();
  const keepPage = await workspace.openNewBoardTab(page);
  await expect(page).toHaveURL(recoverBoardUrl);
  await keepPage.getByRole('textbox', { name: 'Board title' }).fill('Keep me');

  const openLibrary = async () => {
    await keepPage.getByRole('button', { name: 'Open board menu' }).click();
    await keepPage.getByRole('button', { name: 'Open boards' }).click();
    return keepPage.getByRole('dialog', { name: 'Boards' });
  };
  let library = await openLibrary();
  const recoverEntry = library
    .getByRole('button', { exact: true, name: 'Open Recover me' })
    .locator('..');
  await recoverEntry.getByRole('button', { name: 'Trash' }).click();
  await expect(
    library.locator('.local-board-library__announcement'),
  ).toHaveText('Moved Recover me to trash.');
  await expect(
    library.getByRole('button', { exact: true, name: 'Open Recover me' }),
  ).toHaveCount(0);
  await expect(library.getByRole('list', { name: 'Device trash' })).toHaveCount(
    0,
  );
  await library.getByRole('button', { name: 'Device trash (1)' }).click();
  await expect(
    library.getByRole('list', { name: 'Device trash' }).getByText('Recover me'),
  ).toBeVisible();

  await keepPage.getByRole('button', { name: 'Close boards' }).click();
  await keepPage.reload();
  library = await openLibrary();
  await library.getByRole('button', { name: 'Device trash (1)' }).click();
  const trash = library.getByRole('list', { name: 'Device trash' });
  await expect(trash.getByText('Recover me')).toBeVisible();
  await library.getByRole('button', { name: 'Restore all' }).click();
  await expect(
    library.locator('.local-board-library__announcement'),
  ).toHaveText('Restored all trashed boards.');
  await expect(library.getByRole('list', { name: 'Device trash' })).toHaveCount(
    0,
  );
  await library.getByRole('button', { name: '← Back to boards' }).click();
  await expect(
    library.getByRole('button', { exact: true, name: 'Open Recover me' }),
  ).toBeVisible();

  const restoredEntry = library
    .getByRole('button', { exact: true, name: 'Open Recover me' })
    .locator('..');
  await restoredEntry.getByRole('button', { name: 'Trash' }).click();
  await library.getByRole('button', { name: 'Device trash (1)' }).click();
  await library.getByRole('button', { name: 'Empty trash' }).click();
  await expect(
    library.locator('.local-board-library__announcement'),
  ).toHaveText('Emptied trash.');
  await expect(
    library.getByRole('button', { exact: true, name: 'Open Recover me' }),
  ).toHaveCount(0);
  await expect(library.getByRole('list', { name: 'Device trash' })).toHaveCount(
    0,
  );

  await keepPage.getByRole('button', { name: 'Close boards' }).click();
  await keepPage.reload();
  library = await openLibrary();
  await expect(library.getByText('Recover me')).toHaveCount(0);
  await keepPage.close();
});

test('keeps board selection out of account settings and offers cloud creation beside New board', async ({
  page,
}) => {
  const boards = [
    {
      id: 'owned-board',
      role: 'owner',
      title: 'Owned workspace',
      updatedAt: new Date(0).toISOString(),
    },
    {
      id: 'shared-board',
      role: 'viewer',
      title: 'Shared workspace',
      updatedAt: new Date(0).toISOString(),
    },
  ];
  await page.route('**/api/session', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          displayName: 'Ada Dashboard',
          email: 'ada@example.com',
          id: 'dashboard-user',
          isDemo: false,
        },
      }),
    }),
  );
  await page.route('**/api/boards/trash', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ boards: [] }),
    }),
  );
  await page.route('**/api/boards', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ boards }),
    }),
  );
  await page.goto('/local');
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Open boards' }).click();
  const boardLibrary = page.getByRole('dialog', { name: 'Boards' });
  await expect(
    boardLibrary.getByRole('list', { name: 'On the cloud' }),
  ).toBeVisible();
  await expect(
    boardLibrary.getByRole('button', {
      exact: true,
      name: 'Open cloud board Owned workspace',
    }),
  ).toBeVisible();
  await expect(
    boardLibrary.getByRole('button', { name: 'Copy to local' }),
  ).toHaveCount(2);
  await expect(
    boardLibrary.getByRole('button', { name: 'Copy to cloud' }),
  ).toBeVisible();
  await boardLibrary.getByRole('button', { name: 'Close boards' }).click();

  const accountButton = page.getByRole('button', {
    exact: true,
    name: 'Open account',
  });
  await accountButton.click();

  const account = page.getByRole('dialog', { name: 'Account' });
  await expect(account).toBeVisible();
  await expect(account.getByLabel('Account email')).toHaveValue(
    'ada@example.com',
  );
  await expect(account.getByText('Owned workspace')).toHaveCount(0);
  await expect(account.getByText('Shared workspace')).toHaveCount(0);
  await account.getByRole('button', { name: 'Close account panel' }).click();

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'New board' }).click();
  const storageMenu = page.getByRole('menu', {
    name: 'Choose board storage',
  });
  await expect(storageMenu).toBeVisible();
  await expect(
    storageMenu.getByRole('menuitem', { name: /Local/u }),
  ).toBeVisible();
  await expect(
    storageMenu.getByRole('menuitem', { name: /Cloud/u }),
  ).toBeVisible();
});

test('supports keyboard-only account validation and restores focus on close', async ({
  page,
}) => {
  await page.goto('/');
  const accountButton = page.getByRole('button', {
    exact: true,
    name: 'Open account',
  });
  await accountButton.click();
  const createAccountSwitch = page.getByRole('button', {
    name: 'Create account',
  });
  await expect(createAccountSwitch).toBeVisible();
  const email = page.getByLabel('Email');
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute('autocomplete', 'off');
  await email.evaluate((input) => {
    input.dataset.blurEvents = '0';
    input.dataset.focusEvents = '0';
    input.addEventListener('blur', () => {
      input.dataset.blurEvents = String(Number(input.dataset.blurEvents) + 1);
    });
    input.addEventListener('focus', () => {
      input.dataset.focusEvents = String(Number(input.dataset.focusEvents) + 1);
    });
  });
  await email.pressSequentially('a');
  await expect(email).toHaveAttribute('autocomplete', 'email');
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute('data-blur-events', '1');
  await expect(email).toHaveAttribute('data-focus-events', '1');
  await email.pressSequentially('b');
  await expect(email).toHaveValue('ab');
  await email.fill('');
  await createAccountSwitch.focus();
  await page.keyboard.press('Enter');
  const displayName = page.getByLabel('Display name');
  await expect(displayName).toBeFocused();
  const humanVerification = page.getByLabel('I am not a robot');
  await humanVerification.focus();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Create account' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('Enter the name people will see on shared boards.'),
  ).toBeVisible();
  await displayName.fill('Ada Keyboard');
  await expect(
    page.getByText('Enter the name people will see on shared boards.'),
  ).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(accountButton).toBeFocused();
});

test('keeps grid preferences separate by theme and grid style', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await expect(page.getByRole('slider', { name: 'Grid spacing' })).toHaveCount(
    0,
  );
  const gridButton = page.getByRole('button', { name: 'Grid' });
  await gridButton.click();
  const spacing = page.getByRole('slider', { name: 'Grid spacing' });
  const gridPopover = page.getByRole('dialog', { name: 'Grid options' });
  const [gridButtonBounds, gridPopoverBounds] = await Promise.all([
    gridButton.boundingBox(),
    gridPopover.boundingBox(),
  ]);
  assertValue(gridButtonBounds, 'grid button bounds');
  assertValue(gridPopoverBounds, 'grid popover bounds');
  if (gridButtonBounds !== null && gridPopoverBounds !== null) {
    expect(Math.abs(gridButtonBounds.y - gridPopoverBounds.y)).toBeLessThan(2);
    expect(gridPopoverBounds.x).toBeGreaterThan(
      gridButtonBounds.x + gridButtonBounds.width,
    );
  }

  const gridVisibility = page.getByRole('switch', { name: 'Grid' });
  await gridVisibility.click();
  await expect(gridVisibility).toHaveAttribute('aria-checked', 'true');
  await expect(spacing).toHaveValue('20');
  await expect(spacing).toHaveAttribute('min', '8');
  await expect(spacing).toHaveAttribute('max', '100');
  const dotSize = page.getByRole('slider', { name: 'Grid dot size' });
  await expect(dotSize).toHaveValue('1');
  await expect(dotSize).toHaveAttribute('min', '0.5');
  await expect(dotSize).toHaveAttribute('max', '3');
  await spacing.fill('37');
  await dotSize.fill('2.25');
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem('chalkboard:grid-spacing:light:dots'),
      ),
    )
    .toBe('37');
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem('chalkboard:grid-dot-size:light'),
      ),
    )
    .toBe('2.25');

  await page.getByRole('button', { name: 'Lines' }).click();
  await expect(spacing).toHaveValue('20');
  const lineOpacity = page.getByRole('slider', { name: 'Grid line opacity' });
  await spacing.fill('51');
  await lineOpacity.fill('0.65');
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem('chalkboard:grid-spacing:light:lines'),
      ),
    )
    .toBe('51');

  await gridButton.click();
  const themeButton = page.getByRole('button', { name: 'Theme' });
  await themeButton.click();
  await page.getByRole('button', { name: 'Dark' }).click();
  await themeButton.click();
  await gridButton.click();
  await expect(gridVisibility).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('button', { name: 'Dots' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(spacing).toHaveValue('20');
  await spacing.fill('62');
  await page.getByRole('slider', { name: 'Grid dot size' }).fill('1.5');
  await page.getByRole('button', { name: 'Lines' }).click();
  await expect(spacing).toHaveValue('20');
  await spacing.fill('73');
  await page.getByRole('slider', { name: 'Grid line opacity' }).fill('0.8');

  await gridButton.click();
  await themeButton.click();
  await page.getByRole('button', { name: 'Light' }).click();
  await themeButton.click();
  await gridButton.click();
  await expect(gridVisibility).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Lines' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(spacing).toHaveValue('51');
  await expect(lineOpacity).toHaveValue('0.65');
  await page.getByRole('button', { name: 'Dots' }).click();
  await expect(spacing).toHaveValue('37');
  await expect(dotSize).toHaveValue('2.25');

  await gridButton.click();
  await themeButton.click();
  await page.getByRole('button', { name: 'Dark' }).click();
  await themeButton.click();
  await gridButton.click();
  await expect(page.getByRole('button', { name: 'Lines' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(spacing).toHaveValue('73');
  await expect(lineOpacity).toHaveValue('0.8');
  await page.getByRole('button', { name: 'Dots' }).click();
  await expect(spacing).toHaveValue('62');
  await expect(dotSize).toHaveValue('1.5');

  await page.reload();
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Grid' }).click();
  await expect(page.getByRole('button', { name: 'Dots' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('slider', { name: 'Grid spacing' })).toHaveValue(
    '62',
  );
  await expect(page.getByRole('slider', { name: 'Grid dot size' })).toHaveValue(
    '1.5',
  );
});
