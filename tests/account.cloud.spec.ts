/**
 * PostgreSQL-backed cloud-board product stories: roles, members, invitations,
 * copies, assets, trash, revocation, independent authorization, and restart.
 */
import { rm } from 'node:fs/promises';

import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import {
  assertValue,
  requiredArray,
  requiredObject,
  requiredString,
  requiredValue,
} from './helpers/assertions';
import {
  expectCloudReady,
  registerCloudAccount,
  uniqueEmail,
} from './helpers/cloudAccount';
import { padPngToBytes } from './helpers/pngFixture.js';
import { temporaryDirectory } from './helpers/temporaryDirectory';

const CLOUD_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const MAXIMUM_CLOUD_IMAGE = padPngToBytes(CLOUD_IMAGE, 2_500_000);

async function readCloudCache(
  page: Page,
  boardId: string,
): Promise<{ elements: number; pending: boolean; pendingUpdates: number }> {
  return page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('chalkboard-local');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const request = database
            .transaction('boards', 'readonly')
            .objectStore('boards')
            .get(`cloud:${id}`);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const record = request.result as
              | {
                  elements?: unknown[];
                  pending?: boolean;
                  pendingUpdates?: unknown[];
                }
              | undefined;
            resolve({
              elements: record?.elements?.length ?? 0,
              pending: record?.pending === true,
              pendingUpdates: record?.pendingUpdates?.length ?? 0,
            });
            database.close();
          };
        };
      }),
    boardId,
  );
}

test('copies a local board and its image to a durable cloud destination', async ({
  browser,
  context,
  page,
}) => {
  const email = uniqueEmail('local-cloud-copy');
  await registerCloudAccount(context.request, {
    displayName: 'Copy Browser',
    email,
    password: 'copy password',
  });
  await page.addInitScript(() => {
    localStorage.setItem('chalkboard:local-title', 'Local cloud source');
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 30,
          height: 44,
          id: 'local-cloud-equation',
          lineSpacing: 1.2,
          opacity: 1,
          rotation: 0,
          source: String.raw`Copied $x^2$`,
          strokeColor: '#111827',
          strokeWidth: 2,
          type: 'equation',
          width: 180,
          x: -100,
          y: -22,
        },
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          height: 80,
          id: 'local-cloud-image',
          name: 'cloud-copy.png',
          opacity: 1,
          rotation: 0,
          source:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          strokeColor: 'transparent',
          strokeWidth: 0,
          type: 'image',
          width: 80,
          x: 120,
          y: -40,
        },
      ]),
    );
  });
  await page.goto('/');
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Copy to cloud' }).click();

  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/u);
  await expectCloudReady(page);
  await expect(page.getByRole('textbox', { name: 'Board title' })).toHaveValue(
    'Local cloud source',
  );
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
  const cloudImage = page.getByRole('img', { name: 'cloud-copy.png' });
  await expect(cloudImage).toBeVisible();
  await expect(cloudImage).toHaveAttribute(
    'src',
    /\/api\/boards\/[0-9a-f-]+\/assets\/[0-9a-f-]+$/u,
  );
  await expect(
    page.locator('[data-mixed-text-id="local-cloud-equation"]'),
  ).toHaveCount(0);

  const destinationUrl = page.url();
  const freshPage = await context.newPage();
  await freshPage.goto(destinationUrl);
  await expectCloudReady(freshPage);
  await expect(freshPage.getByText('Canvas contains 2 objects')).toBeVisible();
  await expect(
    freshPage.getByRole('img', { name: 'cloud-copy.png' }),
  ).toBeVisible();
  await freshPage.close();

  const observerContext = await browser.newContext();
  const observerEmail = uniqueEmail('copy-observer');
  await registerCloudAccount(observerContext.request, {
    displayName: 'Copy Observer',
    email: observerEmail,
    password: 'observer password',
  });
  const boardId = destinationUrl.split('/').at(-1);
  expect(boardId).toBeTruthy();
  const addedObserver = await context.request.post(
    `/api/boards/${boardId}/members`,
    { data: { email: observerEmail, role: 'viewer' } },
  );
  expect(addedObserver.ok()).toBe(true);
  const observerPage = await observerContext.newPage();
  await observerPage.goto(destinationUrl);
  await expect(observerPage.getByText('View only')).toBeVisible();
  await expect(
    observerPage.getByText('Canvas contains 2 objects'),
  ).toBeVisible();
  await expect(
    observerPage.getByRole('img', { name: 'cloud-copy.png' }),
  ).toBeVisible();
  await observerContext.close();

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Open boards' }).click();
  const boardLibrary = page.getByRole('dialog', { name: 'Boards' });
  await boardLibrary.getByRole('button', { name: 'Copy to local' }).click();
  await expect(
    boardLibrary.locator('.local-board-library__announcement'),
  ).toHaveText('Copied Local cloud source to local boards.');
  // Exact, because every entry also carries an "Open <title> in a new tab"
  // button and a cloud entry carries "Open cloud board <title>". Accessible
  // name matching is substring by default, so the loose form counted three
  // new-tab buttons alongside the two local boards and reported five.
  const localCopies = boardLibrary.getByRole('button', {
    exact: true,
    name: 'Open Local cloud source',
  });
  await expect(localCopies).toHaveCount(2);
  await localCopies.first().click();
  await expect(page).toHaveURL(/\/local\/[0-9a-f-]+$/u);
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'cloud-copy.png' }),
  ).toHaveAttribute('src', /^data:image\/png;base64,/u);
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Open boards' }).click();
  await page
    .getByRole('dialog', { name: 'Boards' })
    .getByRole('button', { exact: true, name: 'Open Local cloud source' })
    .last()
    .click();
  await expect(
    page.locator('[data-mixed-text-id="local-cloud-equation"]'),
  ).toBeVisible();
  await page.goto(destinationUrl);
  await expectCloudReady(page);

  const boards = await context.request.get('/api/boards');
  expect(boards.ok()).toBe(true);
  expect((await boards.json()).boards).toEqual([
    expect.objectContaining({ title: 'Local cloud source' }),
  ]);

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Open boards' }).click();
  await page
    .getByRole('dialog', { name: 'Boards' })
    .getByRole('list', { name: 'On this device' })
    .locator('.local-board-library__open')
    .first()
    .click();
  await expect(page).toHaveURL(/\/local\/[0-9a-f-]+$/u);
  await expect(
    page.getByRole('group', { name: 'Copied $x^2$', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'cloud-copy.png' }),
  ).toHaveAttribute('src', /^data:image\/png;base64,/u);

  const localUrl = page.url();
  await page.route('**/api/boards/*/assets', (route) =>
    route.fulfill({
      body: JSON.stringify({ error: 'Simulated asset failure' }),
      contentType: 'application/json',
      status: 500,
    }),
  );
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Copy to cloud' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Simulated asset failure',
  );
  await expect(page).toHaveURL(localUrl);
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
  await expect
    .poll(async () => {
      const response = await context.request.get('/api/boards');
      return requiredArray((await response.json()).boards, 'owner board list')
        .length;
    })
    .toBe(1);

  await page.unroute('**/api/boards/*/assets');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/u);
  await expectCloudReady(page);
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
  await expect
    .poll(async () => {
      const response = await context.request.get('/api/boards');
      return requiredArray(
        (await response.json()).boards,
        'observer board list',
      ).length;
    })
    .toBe(2);
});

test('synchronizes a shared cloud board between authenticated accounts', async ({
  browser,
}) => {
  const ownerContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const editorContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const editorPage = await editorContext.newPage();
  const viewerPage = await viewerContext.newPage();
  const ownerEmail = uniqueEmail('owner');
  const editorEmail = uniqueEmail('editor');
  const viewerEmail = uniqueEmail('viewer');
  const boardTitle = `Shared board ${crypto.randomUUID().slice(0, 8)}`;

  await registerCloudAccount(ownerContext.request, {
    displayName: 'Owner Browser',
    email: ownerEmail,
    password: 'owner password',
  });
  await registerCloudAccount(editorContext.request, {
    displayName: 'Editor Browser',
    email: editorEmail,
    password: 'editor password',
  });
  await registerCloudAccount(viewerContext.request, {
    displayName: 'Viewer Browser',
    email: viewerEmail,
    password: 'viewer password',
  });

  const created = await ownerContext.request.post('/api/boards', {
    data: { title: boardTitle },
  });
  expect(created.ok()).toBe(true);
  const boardId = requiredString(
    (await created.json()).board?.id,
    'shared board identifier',
  );

  await ownerPage.goto('/');
  await ownerPage.getByRole('button', { name: 'Open board menu' }).click();
  await ownerPage.getByRole('button', { name: 'Open boards' }).click();
  await ownerPage
    .getByRole('dialog', { name: 'Boards' })
    .getByRole('button', { name: `Open cloud board ${boardTitle}` })
    .click();
  await expectCloudReady(ownerPage);
  await ownerPage.getByRole('button', { name: 'Share' }).click();
  await expect(
    ownerPage.getByRole('region', { name: `Manage ${boardTitle}` }),
  ).toBeVisible();
  await expect(ownerPage.getByLabel('Member email')).toBeFocused();
  await ownerPage
    .getByRole('button', { name: 'Copy read-and-edit link' })
    .click();
  await expect(
    ownerPage.getByRole('button', { name: 'Copied read-and-edit link' }),
  ).toBeVisible();
  const editorInviteUrl = await ownerPage.evaluate(() =>
    navigator.clipboard.readText(),
  );
  await ownerPage.getByRole('button', { name: 'Copy read-only link' }).click();
  await expect
    .poll(() => ownerPage.evaluate(() => navigator.clipboard.readText()))
    .not.toBe(editorInviteUrl);
  const viewerInviteUrl = await ownerPage.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(editorInviteUrl).not.toBe(viewerInviteUrl);
  expect(editorInviteUrl).toContain('#invite=');
  expect(viewerInviteUrl).toContain('#invite=');
  await ownerPage.getByRole('button', { name: 'Close sharing' }).click();

  await editorPage.goto(editorInviteUrl);
  await viewerPage.goto(viewerInviteUrl);

  await expectCloudReady(ownerPage);
  await expectCloudReady(editorPage);
  await expect(viewerPage.getByText('View only')).toBeVisible();
  await expect(ownerPage).toHaveURL(`/boards/${boardId}`);
  await expect(editorPage).toHaveURL(`/boards/${boardId}`);
  await expect(viewerPage).toHaveURL(`/boards/${boardId}`);
  await expect(ownerPage.getByRole('button', { name: 'Share' })).toBeVisible();
  await expect(editorPage.getByRole('button', { name: 'Share' })).toBeVisible();
  await expect(viewerPage.getByRole('button', { name: 'Share' })).toBeVisible();
  await expect(
    viewerPage.getByRole('button', { name: 'Shape tool' }),
  ).toHaveCount(0);
  await expect(
    viewerPage.getByRole('button', { name: 'Import image / SVG' }),
  ).toHaveCount(0);
  await expect(
    viewerPage.getByRole('button', { name: 'Delete selection' }),
  ).toHaveCount(0);
  await expect(
    viewerPage.getByRole('textbox', { name: 'Board title' }),
  ).toHaveAttribute('readonly', '');
  await expect(
    ownerPage.getByLabel('Editor Browser is collaborating'),
  ).toBeVisible();
  await expect(
    ownerPage.getByLabel('Viewer Browser is collaborating'),
  ).toBeVisible();
  await expect(
    editorPage.getByLabel('Owner Browser is collaborating'),
  ).toBeVisible();
  await expect(
    viewerPage.getByLabel('Editor Browser is collaborating'),
  ).toBeVisible();

  const accountRenamedTitle = `${boardTitle} from board`;
  const titleSaved = ownerPage.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/api/boards/${boardId}`),
  );
  await ownerPage
    .getByRole('textbox', { name: 'Board title' })
    .fill(accountRenamedTitle);
  await ownerPage.getByRole('textbox', { name: 'Board title' }).blur();
  await titleSaved;
  await expect(
    editorPage.getByRole('textbox', { name: 'Board title' }),
  ).toHaveValue(accountRenamedTitle);
  await expect(
    viewerPage.getByRole('textbox', { name: 'Board title' }),
  ).toHaveValue(accountRenamedTitle);
  await expect
    .poll(async () => {
      const response = await ownerContext.request.get(`/api/boards/${boardId}`);
      return response.ok()
        ? requiredString(
            (await response.json()).board?.title,
            'account-renamed board title',
          )
        : null;
    })
    .toBe(accountRenamedTitle);
  const anonymousContext = await browser.newContext();
  const anonymousPage = await anonymousContext.newPage();
  await anonymousPage.goto(ownerPage.url());
  await expect(
    anonymousPage.getByText('Sign in to open this cloud board'),
  ).toBeVisible();
  await expect(anonymousPage).toHaveURL(`/boards/${boardId}`);
  await anonymousPage.getByRole('button', { name: 'Use local board' }).click();
  await expect(anonymousPage).toHaveURL(/\/local\/[^/]+$/u);
  await anonymousContext.close();

  const ownerCanvas = ownerPage.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const ownerCanvasBounds = await ownerCanvas.boundingBox();
  assertValue(ownerCanvasBounds, 'owner drawing canvas bounds');
  if (ownerCanvasBounds !== null) {
    const start = {
      x: ownerCanvasBounds.x + 320,
      y: ownerCanvasBounds.y + 260,
    };
    await ownerPage.getByRole('button', { name: 'Line / curve tool' }).click();
    await ownerPage.getByRole('button', { name: 'Use freehand path' }).click();
    await ownerPage.mouse.move(start.x, start.y);
    await ownerPage.mouse.down();
    await ownerPage.mouse.move(start.x + 40, start.y - 25, { steps: 8 });
    await ownerPage.mouse.move(start.x + 90, start.y + 10, { steps: 8 });
    await ownerPage.mouse.up();
    await expect(
      editorPage.getByText('Canvas contains 1 object'),
    ).toBeVisible();
    await expect(
      viewerPage.getByText('Canvas contains 1 object'),
    ).toBeVisible();
    await expect(ownerPage.getByText(/^Synced$/u)).toBeVisible();

    await viewerPage.getByRole('button', { name: 'Drag canvas tool' }).click();
    const viewerCanvas = viewerPage.getByRole('application', {
      name: 'Chalkboard drawing canvas',
    });
    const viewerCanvasBounds = await viewerCanvas.boundingBox();
    assertValue(viewerCanvasBounds, 'viewer drawing canvas bounds');
    if (viewerCanvasBounds !== null) {
      const viewerStart = {
        x: viewerCanvasBounds.x + 300,
        y: viewerCanvasBounds.y + 240,
      };
      await viewerPage.mouse.move(viewerStart.x, viewerStart.y);
      await viewerPage.mouse.down();
      await expect(viewerPage.locator('.canvas-viewport')).toHaveClass(
        /is-grabbing/,
      );
      await viewerPage.mouse.move(viewerStart.x + 80, viewerStart.y + 40);
      await viewerPage.mouse.up();
      await expect(viewerPage.locator('.canvas-viewport')).toHaveClass(
        /is-grab/,
      );
    }
    await viewerPage.getByRole('button', { name: 'Zoom in' }).click();
    await expect(viewerPage.locator('.zoom-value')).toHaveText('110%');
    await viewerPage.getByRole('button', { name: 'Open board menu' }).click();
    await expect(
      viewerPage.getByRole('button', { name: 'Clear canvas' }),
    ).toHaveCount(0);
    await viewerPage.getByRole('button', { name: 'Open board menu' }).click();
    await viewerPage.getByRole('button', { name: 'Selection tool' }).click();
    const viewerNavigator = viewerPage.getByRole('complementary', {
      name: 'Board objects',
    });
    await expect(viewerNavigator.getByText('1 objects')).toBeVisible();
    await viewerNavigator
      .getByRole('button', { name: /Freehand stroke, object 1/ })
      .click();
    await viewerPage.keyboard.press('Escape');
    await viewerPage.keyboard.press('Control+c');
    await expect
      .poll(() =>
        viewerPage.evaluate(() =>
          localStorage.getItem('chalkboard:object-clipboard'),
        ),
      )
      .not.toBeNull();
    await viewerPage.keyboard.press('Delete');
    await expect(
      viewerPage.getByText('Canvas contains 1 object'),
    ).toBeVisible();
  }

  const editorCanvas = editorPage.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const editorCanvasBounds = await editorCanvas.boundingBox();
  assertValue(editorCanvasBounds, 'editor drawing canvas bounds');
  if (editorCanvasBounds !== null) {
    await editorPage.mouse.move(
      editorCanvasBounds.x + 420,
      editorCanvasBounds.y + 220,
    );
    await expect(
      ownerPage.locator('.collaborator-cursor-name', {
        hasText: 'Editor Browser',
      }),
    ).toBeVisible();
    await editorPage.getByRole('button', { name: 'Selection tool' }).click();
    await editorPage
      .getByRole('button', { name: /Freehand stroke, object 1/ })
      .click();
    await expect(
      ownerPage.locator(
        `.collaborator-selection[title="Editor Browser's selection"]`,
      ),
    ).toBeVisible();
    await editorPage.keyboard.press('Escape');
    await editorPage.getByRole('button', { name: 'Shape tool' }).click();
    const shapeStart = {
      x: editorCanvasBounds.x + 600,
      y: editorCanvasBounds.y + 300,
    };
    await editorPage.mouse.move(shapeStart.x, shapeStart.y);
    await editorPage.mouse.down();
    await editorPage.mouse.move(shapeStart.x + 100, shapeStart.y + 70);
    await editorPage.mouse.up();
  }
  await expect(ownerPage.getByText('Canvas contains 2 objects')).toBeVisible();
  await expect(viewerPage.getByText('Canvas contains 2 objects')).toBeVisible();
  await expect(editorPage.getByText(/^Synced$/u)).toBeVisible();

  await ownerPage.keyboard.press('Control+z');
  await expect(ownerPage.getByText('Canvas contains 1 object')).toBeVisible();
  await expect(editorPage.getByText('Canvas contains 1 object')).toBeVisible();
  await expect(viewerPage.getByText('Canvas contains 1 object')).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Selection tool' }).click();
  const ownerNavigator = ownerPage.getByRole('complementary', {
    name: 'Board objects',
  });
  await expect(ownerNavigator.getByText('Rectangle shape')).toBeVisible();
  await expect(ownerNavigator.getByText('Freehand stroke')).toHaveCount(0);
  await ownerPage.keyboard.press('Escape');

  await ownerPage.keyboard.press('Control+Shift+z');
  await expect(ownerPage.getByText('Canvas contains 2 objects')).toBeVisible();
  await expect(editorPage.getByText('Canvas contains 2 objects')).toBeVisible();
  await expect(viewerPage.getByText('Canvas contains 2 objects')).toBeVisible();

  const ownerBounds = await ownerCanvas.boundingBox();
  assertValue(ownerBounds, 'owner canvas bounds');
  if (ownerBounds !== null) {
    await ownerPage
      .getByRole('button', { name: 'Mixed text block tool' })
      .click();
    await ownerPage.mouse.click(ownerBounds.x + 440, ownerBounds.y + 180);
    await expect(ownerPage.locator('math-field')).toBeFocused();
    await ownerPage.locator('.inline-math-editor.is-ready').waitFor();
    await ownerPage.keyboard.type('Shared ');
    await ownerPage.keyboard.press('Control+m');
    await ownerPage.keyboard.type('x');
    await ownerPage.keyboard.press('Control+m');
    await ownerPage.getByRole('button', { name: 'Selection tool' }).click();
    await expect(
      editorPage.getByRole('group', { name: /Shared.*x/ }),
    ).toBeVisible();

    await ownerPage
      .getByRole('button', { name: 'Mixed text block tool' })
      .click();
    await editorPage
      .getByRole('button', { name: 'Mixed text block tool' })
      .click();
    const ownerEquationBounds = await ownerPage
      .getByRole('group', { name: /Shared.*x/ })
      .boundingBox();
    const editorEquationBounds = await editorPage
      .getByRole('group', { name: /Shared.*x/ })
      .boundingBox();
    assertValue(ownerEquationBounds, 'owner equation bounds');
    assertValue(editorEquationBounds, 'editor equation bounds');
    if (ownerEquationBounds === null || editorEquationBounds === null) {
      throw new Error('Shared equation is not measurable');
    }
    await ownerPage.mouse.click(
      ownerEquationBounds.x + ownerEquationBounds.width / 2,
      ownerEquationBounds.y + ownerEquationBounds.height / 2,
    );
    await editorPage.mouse.click(
      editorEquationBounds.x + editorEquationBounds.width / 2,
      editorEquationBounds.y + editorEquationBounds.height / 2,
    );
    const ownerField = ownerPage.locator('math-field');
    const editorField = editorPage.locator('math-field');
    await expect(ownerField).toBeFocused();
    await expect(editorField).toBeFocused();
    await Promise.all([
      ownerPage.locator('.inline-math-editor.is-ready').waitFor(),
      editorPage.locator('.inline-math-editor.is-ready').waitFor(),
    ]);
    await ownerField.evaluate((field) => {
      field.position = field.lastOffset;
    });
    await editorField.evaluate((field) => {
      field.position = field.lastOffset;
    });
    await ownerPage.keyboard.press('Control+m');
    await Promise.all([
      ownerPage.keyboard.type('q'),
      editorPage.keyboard.type('B'),
    ]);
    await ownerPage.keyboard.press('Control+m');
    let stableConvergenceChecks = 0;
    let previousConvergenceValue = '';
    let convergenceValues = { editor: '', owner: '' };
    try {
      await expect
        .poll(
          async () => {
            convergenceValues = {
              editor: await editorField.evaluate((field) => field.value),
              owner: await ownerField.evaluate((field) => field.value),
            };
            const converged =
              convergenceValues.editor === convergenceValues.owner &&
              convergenceValues.owner.includes('q') &&
              convergenceValues.owner.includes('B') &&
              convergenceValues.owner.includes('x');
            if (
              converged &&
              convergenceValues.owner === previousConvergenceValue
            ) {
              stableConvergenceChecks += 1;
            } else {
              stableConvergenceChecks = converged ? 1 : 0;
            }
            previousConvergenceValue = convergenceValues.owner;
            return stableConvergenceChecks >= 3;
          },
          { intervals: [100, 100, 100] },
        )
        .toBe(true);
    } catch (error) {
      throw new Error(
        `Convergence values: ${JSON.stringify(convergenceValues)}`,
        { cause: error },
      );
    }
    await expect(ownerPage.getByText(/^Synced$/u)).toBeVisible();
    await expect(editorPage.getByText(/^Synced$/u)).toBeVisible();
    await ownerField.evaluate((field) =>
      field.dispatchEvent(
        new CustomEvent('chalkboard-history-request', {
          detail: { direction: -1 },
        }),
      ),
    );
    let undoValues = { editor: '', owner: '' };
    try {
      await expect
        .poll(async () => {
          undoValues = {
            editor: await editorField.evaluate((field) => field.value),
            owner: await ownerField.evaluate((field) => field.value),
          };
          return (
            undoValues.editor === undoValues.owner &&
            !undoValues.owner.includes('q') &&
            undoValues.owner.includes('B') &&
            undoValues.owner.includes('x')
          );
        })
        .toBe(true);
    } catch (error) {
      throw new Error(`Undo values: ${JSON.stringify(undoValues)}`, {
        cause: error,
      });
    }
    await ownerField.evaluate((field) =>
      field.dispatchEvent(
        new CustomEvent('chalkboard-history-request', {
          detail: { direction: 1 },
        }),
      ),
    );
    let redoValues = { editor: '', owner: '' };
    try {
      await expect
        .poll(async () => {
          redoValues = {
            editor: await editorField.evaluate((field) => field.value),
            owner: await ownerField.evaluate((field) => field.value),
          };
          return (
            redoValues.editor === redoValues.owner &&
            redoValues.owner.includes('q') &&
            redoValues.owner.includes('B') &&
            redoValues.owner.includes('x')
          );
        })
        .toBe(true);
    } catch (error) {
      throw new Error(`Redo values: ${JSON.stringify(redoValues)}`, {
        cause: error,
      });
    }
    await ownerPage.keyboard.type('C');
    await expect
      .poll(async () => {
        const editorValue = await editorField.evaluate((field) => field.value);
        const ownerValue = await ownerField.evaluate((field) => field.value);
        return (
          editorValue === ownerValue &&
          ownerValue.includes('q') &&
          ownerValue.includes('B') &&
          ownerValue.includes('C') &&
          ownerValue.includes('x')
        );
      })
      .toBe(true);
    await ownerPage.getByRole('button', { name: 'Selection tool' }).click();
    await editorPage.getByRole('button', { name: 'Selection tool' }).click();
    await expect(
      viewerPage.getByRole('group', {
        name: /Shared(?=.*q)(?=.*B)(?=.*C)(?=.*x)/,
      }),
    ).toBeVisible();
    await expect(
      viewerPage.getByText('Canvas contains 3 objects'),
    ).toBeVisible();
  }

  await Promise.all([
    ownerContext.setOffline(true),
    editorContext.setOffline(true),
  ]);
  await Promise.all([
    ownerPage.evaluate(() => window.dispatchEvent(new Event('offline'))),
    editorPage.evaluate(() => window.dispatchEvent(new Event('offline'))),
  ]);
  await expect(
    ownerPage.getByText('Disconnected', { exact: true }),
  ).toBeVisible();
  await expect(
    editorPage.getByText('Disconnected', { exact: true }),
  ).toBeVisible();

  const drawOfflineShape = async (
    page: Page,
    bounds: { height: number; width: number; x: number; y: number },
    offsetX: number,
    offsetY: number,
  ) => {
    await page.getByRole('button', { name: 'Shape tool' }).click();
    const start = { x: bounds.x + offsetX, y: bounds.y + offsetY };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 70, start.y + 50);
    await page.mouse.up();
  };
  const offlineOwnerBounds = await ownerCanvas.boundingBox();
  const offlineEditorBounds = await editorCanvas.boundingBox();
  assertValue(offlineOwnerBounds, 'offline owner bounds');
  assertValue(offlineEditorBounds, 'offline editor bounds');
  if (offlineOwnerBounds === null || offlineEditorBounds === null) {
    throw new Error('Offline canvases are not measurable');
  }
  await drawOfflineShape(ownerPage, offlineOwnerBounds, 300, 500);
  await drawOfflineShape(editorPage, offlineEditorBounds, 820, 180);
  await expect(ownerPage.getByText('Canvas contains 4 objects')).toBeVisible();
  await expect(editorPage.getByText('Canvas contains 4 objects')).toBeVisible();
  await expect(viewerPage.getByText('Canvas contains 3 objects')).toBeVisible();
  await ownerPage.getByLabel('Choose image or SVG file').setInputFiles({
    buffer: CLOUD_IMAGE,
    mimeType: 'image/png',
    name: 'offline-cloud-pixel.png',
  });
  await expect(
    ownerPage.getByText(
      'Image upload is waiting for a connection. Reconnect and retry.',
    ),
  ).toBeVisible();
  await expect(ownerPage.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(ownerPage.getByText('Canvas contains 4 objects')).toBeVisible();

  await ownerContext.setOffline(false);
  await ownerPage.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(viewerPage.getByText('Canvas contains 4 objects')).toBeVisible();
  await expect(ownerPage.getByText(/^Synced$/u)).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Retry' }).click();
  await expect(viewerPage.getByText('Canvas contains 5 objects')).toBeVisible();
  await expect(ownerPage.locator('.operation-status')).toHaveCount(0);
  await expect(ownerPage.getByText(/^Synced$/u)).toBeVisible();

  await editorContext.setOffline(false);
  await editorPage.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(ownerPage.getByText('Canvas contains 6 objects')).toBeVisible();
  await expect(editorPage.getByText('Canvas contains 6 objects')).toBeVisible();
  await expect(viewerPage.getByText('Canvas contains 6 objects')).toBeVisible();
  await expect(ownerPage.getByText(/^Synced$/u)).toBeVisible();
  await expect(editorPage.getByText(/^Synced$/u)).toBeVisible();

  const cloudImage = viewerPage.getByRole('img', {
    name: 'offline-cloud-pixel.png',
  });
  await expect(cloudImage).toHaveAttribute(
    'src',
    new RegExp(`^/api/boards/${boardId}/assets/[0-9a-f-]+$`, 'u'),
  );
  await viewerPage.reload();
  await expect(viewerPage.getByText('View only')).toBeVisible();
  await expect(viewerPage.getByText('Canvas contains 6 objects')).toBeVisible();
  await expect(
    viewerPage.getByRole('img', { name: 'offline-cloud-pixel.png' }),
  ).toBeVisible();

  await ownerPage.getByLabel('Choose image or SVG file').setInputFiles({
    buffer: Buffer.alloc(2_500_001),
    mimeType: 'image/png',
    name: 'too-large.png',
  });
  await expect(ownerPage.getByRole('alert')).toHaveText(
    /Images must be smaller than 2\.5 MB/u,
  );
  await expect(ownerPage.getByText('Canvas contains 6 objects')).toBeVisible();
  await expect(ownerPage.getByText(/^Synced$/u)).toBeVisible();

  await ownerPage.getByLabel('Choose image or SVG file').setInputFiles({
    buffer: Buffer.from('<svg><path></svg'),
    mimeType: 'image/svg+xml',
    name: 'malformed.svg',
  });
  await expect(ownerPage.getByRole('alert')).toContainText(
    'The SVG file is invalid',
  );
  await expect(ownerPage.getByText('Canvas contains 6 objects')).toBeVisible();
  await expect(viewerPage.getByText('Canvas contains 6 objects')).toBeVisible();
  await expect(ownerPage.getByText(/^Synced$/u)).toBeVisible();

  const renamedTitle = `${accountRenamedTitle} updated`;
  await ownerPage
    .getByRole('textbox', { name: 'Board title' })
    .fill(renamedTitle);
  await expect(
    editorPage.getByRole('textbox', { name: 'Board title' }),
  ).toHaveValue(renamedTitle);
  await expect
    .poll(async () => {
      const response = await ownerContext.request.get(`/api/boards/${boardId}`);
      return response.ok()
        ? requiredString(
            (await response.json()).board?.title,
            'collaboratively renamed board title',
          )
        : null;
    })
    .toBe(renamedTitle);

  const members = await ownerContext.request.get(
    `/api/boards/${boardId}/members`,
  );
  const editorMember = requiredObject(
    requiredValue(
      requiredArray((await members.json()).members, 'board member list').find(
        (member) =>
          typeof member === 'object' &&
          member !== null &&
          'email' in member &&
          member.email === editorEmail,
      ),
      'editor member',
    ),
    'editor member',
  );
  const editorId = requiredString(
    editorMember.userId,
    'editor user identifier',
  );
  const removed = await ownerContext.request.delete(
    `/api/boards/${boardId}/members/${editorId}`,
  );
  expect(removed.ok()).toBe(true);
  await expect(
    ownerPage.getByLabel('Editor Browser is collaborating'),
  ).toHaveCount(0);
  await expect(ownerPage.getByText(/^Synced$/u)).toBeVisible();

  await editorPage.reload();
  // Contains rather than equals: the alert carries its own Dismiss control.
  await expect(editorPage.getByRole('alert')).toContainText(
    'That cloud board is unavailable. It may have been deleted, or your access may have changed, so another one was opened.',
  );
  // A lost cloud board is replaced by another cloud board, never by a local
  // one, so the reader is not moved into different storage without asking:
  // whichever this account had open before, else any it still owns, else a
  // fresh one. This account has no other, so it lands on a fresh empty board at
  // a different address. Asserting the revoked address still held only passed
  // by outrunning that replacement. `App.test.tsx` fixes the same contract for
  // a direct route that was never authorized.
  await expect(editorPage).not.toHaveURL(`/boards/${boardId}`);
  await expect(editorPage).toHaveURL(/\/boards\/[0-9a-f-]+$/u);
  await expect(
    editorPage.getByRole('textbox', { name: 'Board title' }),
  ).toHaveValue('Untitled board');
  await expect(editorPage.getByText('Canvas contains 0 objects')).toBeVisible();
  const deletedBoard = await ownerContext.request.delete(
    `/api/boards/${boardId}`,
  );
  expect(deletedBoard.ok()).toBe(true);

  await ownerContext.close();
  await editorContext.close();
  await viewerContext.close();
});

test('replays an offline update after a full browser-process restart', async ({
  baseURL,
  browser,
}) => {
  if (baseURL === undefined) throw new Error('Cloud base URL is required');
  const profileDirectory = await temporaryDirectory('cloud-restart-');
  const ownerEmail = uniqueEmail('restart-owner');
  const observerEmail = uniqueEmail('restart-observer');
  const boardTitle = `Restart board ${crypto.randomUUID().slice(0, 8)}`;
  let ownerContext: BrowserContext | null = null;
  let observerContext: BrowserContext | null = null;

  try {
    ownerContext = await chromium.launchPersistentContext(profileDirectory, {
      baseURL,
      headless: true,
    });
    await registerCloudAccount(ownerContext.request, {
      displayName: 'Restart Owner',
      email: ownerEmail,
      password: 'restart owner password',
    });
    const created = await ownerContext.request.post('/api/boards', {
      data: { title: boardTitle },
    });
    expect(created.ok()).toBe(true);
    const boardId = requiredString(
      (await created.json()).board?.id,
      'restart board identifier',
    );

    observerContext = await browser.newContext();
    await registerCloudAccount(observerContext.request, {
      displayName: 'Restart Observer',
      email: observerEmail,
      password: 'restart observer password',
    });
    const addedObserver = await ownerContext.request.post(
      `/api/boards/${boardId}/members`,
      { data: { email: observerEmail, role: 'viewer' } },
    );
    expect(addedObserver.ok()).toBe(true);

    const ownerPage = ownerContext.pages()[0] ?? (await ownerContext.newPage());
    const observerPage = await observerContext.newPage();
    await Promise.all([
      ownerPage.goto(`/boards/${boardId}`),
      observerPage.goto(`/boards/${boardId}`),
    ]);
    await expectCloudReady(ownerPage);
    await expect(observerPage.getByText('View only')).toBeVisible();
    await expect(
      observerPage.getByText('Canvas contains 0 objects'),
    ).toBeVisible();
    await ownerPage.getByLabel('Choose image or SVG file').setInputFiles({
      buffer: MAXIMUM_CLOUD_IMAGE,
      mimeType: 'image/png',
      name: 'maximum-cloud-image.png',
    });
    await expect(ownerPage.getByText(/^Synced$/u)).toBeVisible();
    await expect(ownerPage.locator('.operation-status')).toHaveCount(0);
    await expect(
      observerPage.getByRole('img', { name: 'maximum-cloud-image.png' }),
    ).toBeVisible();
    await expect(
      observerPage.getByText('Canvas contains 1 object'),
    ).toBeVisible();

    await ownerContext.setOffline(true);
    await ownerPage.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(
      ownerPage.getByText('Disconnected', { exact: true }),
    ).toBeVisible();
    const canvas = ownerPage.getByRole('application', {
      name: 'Chalkboard drawing canvas',
    });
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error('Owner canvas is not measurable');
    await ownerPage.getByRole('button', { name: 'Shape tool' }).click();
    await ownerPage.mouse.move(bounds.x + 360, bounds.y + 280);
    await ownerPage.mouse.down();
    await ownerPage.mouse.move(bounds.x + 460, bounds.y + 350);
    await ownerPage.mouse.up();
    await expect(
      ownerPage.getByText('Canvas contains 2 objects'),
    ).toBeVisible();
    await expect(
      observerPage.getByText('Canvas contains 1 object'),
    ).toBeVisible();
    await expect
      .poll(() => readCloudCache(ownerPage, boardId))
      .toEqual({ elements: 2, pending: true, pendingUpdates: 1 });

    await ownerContext.close();
    ownerContext = null;

    ownerContext = await chromium.launchPersistentContext(profileDirectory, {
      baseURL,
      headless: true,
    });
    const recoveredPage =
      ownerContext.pages()[0] ?? (await ownerContext.newPage());
    await recoveredPage.goto(`/boards/${boardId}`);
    await expect(
      recoveredPage.getByText('Canvas contains 2 objects'),
    ).toBeVisible();
    await expect(recoveredPage.getByText(/^Synced$/u)).toBeVisible();
    await expect
      .poll(() => readCloudCache(recoveredPage, boardId))
      .toEqual({ elements: 2, pending: false, pendingUpdates: 0 });
    await expect(
      recoveredPage.getByRole('img', { name: 'maximum-cloud-image.png' }),
    ).toBeVisible();

    await expect(
      observerPage.getByText('Canvas contains 2 objects'),
    ).toBeVisible();
    await observerPage.reload();
    await expect(observerPage.getByText('View only')).toBeVisible();
    await expect(
      observerPage.getByText('Canvas contains 2 objects'),
    ).toBeVisible();
    await expect(
      observerPage.getByRole('img', { name: 'maximum-cloud-image.png' }),
    ).toBeVisible();
    const deletedBoard = await ownerContext.request.delete(
      `/api/boards/${boardId}`,
    );
    expect(deletedBoard.ok()).toBe(true);
  } finally {
    await ownerContext?.close().catch(() => undefined);
    await observerContext?.close().catch(() => undefined);
    await rm(profileDirectory, { force: true, recursive: true });
  }
});
