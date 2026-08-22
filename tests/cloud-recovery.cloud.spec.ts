/**
 * Cloud durability stories for offline edits, reconnect/replay, ordered durable
 * acknowledgement, device cache recovery, process restart, and conflict handling.
 */
import { rm } from 'node:fs/promises';

import {
  chromium,
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import * as decoding from 'lib0/decoding';

import { requiredString } from './helpers/assertions';
import { registerCloudAccount } from './helpers/cloudAccount';
import { temporaryDirectory } from './helpers/temporaryDirectory';

import {
  CLOUD_RECONNECT_DELAYS_MS,
  MAX_CLOUD_RECONNECT_ATTEMPTS,
} from '../apps/web/src/collaboration/cloudReconnect';
import {
  MAX_CLOUD_RECOVERY_DOCUMENT_BYTES,
  MAX_PENDING_CLOUD_UPDATE_AGE_MS,
} from '../apps/web/src/editor/cloud/cloudBoardCacheQueue';
import { crashChromiumBrowser } from './helpers/browserProcess';

const recoveryAccount = {
  displayName: 'Recovery Owner',
  email: `cloud-recovery-${crypto.randomUUID()}@chalkboard.test`,
  password: 'bounded cloud recovery password',
};

test.beforeAll(async ({ request }) => {
  await registerCloudAccount(request, recoveryAccount);
});

async function authenticate(context: BrowserContext): Promise<void> {
  const login = await context.request.post('/api/auth/login', {
    data: {
      email: recoveryAccount.email,
      password: recoveryAccount.password,
    },
  });
  expect(login.ok()).toBe(true);
}

async function createRecoveryBoard(
  request: APIRequestContext,
  title: string,
): Promise<string> {
  const login = await request.post('/api/auth/login', {
    data: {
      email: recoveryAccount.email,
      password: recoveryAccount.password,
    },
  });
  expect(login.ok()).toBe(true);
  const created = await request.post('/api/boards', { data: { title } });
  expect(created.ok()).toBe(true);
  return requiredString(
    (await created.json()).board?.id,
    `created ${title} board identifier`,
  );
}

async function drawCloudShape(
  page: Page,
  expectedCount = 1,
  offset = 0,
): Promise<void> {
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error('Cloud canvas is not measurable');
  await page.getByRole('button', { name: 'Shape tool' }).click();
  await page.mouse.move(bounds.x + 260 + offset, bounds.y + 220);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 380 + offset, bounds.y + 300);
  await page.mouse.up();
  await expect(
    page.getByText(
      `Canvas contains ${expectedCount} object${expectedCount === 1 ? '' : 's'}`,
    ),
  ).toBeVisible();
}

function acknowledgementSequence(message: string | Buffer): number | null {
  if (typeof message === 'string') return null;
  try {
    const bytes = new Uint8Array(
      message.buffer,
      message.byteOffset,
      message.byteLength,
    );
    const decoder = decoding.createDecoder(bytes);
    if (decoding.readVarUint(decoder) !== 2) return null;
    return decoding.readVarUint(decoder);
  } catch {
    return null;
  }
}

async function attachRecoveredCloudState(
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(`${label}.png`) });
}

async function readCloudRecovery(
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

async function seedOversizedPendingRecovery(
  page: Page,
  boardId: string,
): Promise<void> {
  await page.evaluate(
    ({ documentBytes, id }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('chalkboard-local');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction('boards', 'readwrite');
          transaction.objectStore('boards').put({
            elements: ['x'.repeat(documentBytes + 1)],
            id: `cloud:${id}`,
            pending: true,
            schemaVersion: 2,
            title: 'Oversized pending recovery',
            updatedAt: Date.now(),
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        };
      }),
    { documentBytes: MAX_CLOUD_RECOVERY_DOCUMENT_BYTES, id: boardId },
  );
}

async function oversizedRecoveryPayloadLength(
  page: Page,
  boardId: string,
): Promise<number> {
  return page.evaluate(
    (id) =>
      new Promise<number>((resolve, reject) => {
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
            const value = (
              request.result as { elements?: unknown[] } | undefined
            )?.elements?.[0];
            resolve(typeof value === 'string' ? value.length : 0);
            database.close();
          };
        };
      }),
    boardId,
  );
}

async function agePendingRecovery(page: Page, boardId: string): Promise<void> {
  await page.evaluate(
    ({ id, pendingSince }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('chalkboard-local');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction('boards', 'readwrite');
          const store = transaction.objectStore('boards');
          const request = store.get(`cloud:${id}`);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            store.put({ ...request.result, pendingSince });
          };
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        };
      }),
    {
      id: boardId,
      pendingSince: Date.now() - MAX_PENDING_CLOUD_UPDATE_AGE_MS - 1,
    },
  );
}

async function deleteCloudRecovery(page: Page, boardId: string): Promise<void> {
  await page.evaluate(
    (id) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('chalkboard-local');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction('boards', 'readwrite');
          transaction.objectStore('boards').delete(`cloud:${id}`);
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        };
      }),
    boardId,
  );
}

test('replays a device-cached update after an abrupt browser-process kill', async ({
  baseURL,
  request,
}, testInfo) => {
  test.setTimeout(60_000);
  if (baseURL === undefined) throw new Error('Cloud base URL is required');
  const boardId = await createRecoveryBoard(
    request,
    'Cache boundary recovery board',
  );
  const profileDirectory = await temporaryDirectory('cloud-cache-kill-');
  let context: BrowserContext | null = null;

  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      baseURL,
      headless: true,
    });
    await authenticate(context);
    let page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByText(/^Synced$/u)).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByText('Disconnected', { exact: true })).toBeVisible();
    await drawCloudShape(page);
    await expect
      .poll(() => readCloudRecovery(page, boardId))
      .toEqual({ elements: 1, pending: true, pendingUpdates: 1 });

    await crashChromiumBrowser(context, page);
    context = null;
    context = await chromium.launchPersistentContext(profileDirectory, {
      baseURL,
      headless: true,
    });
    await authenticate(context);
    page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
    await expect(page.getByText(/^Synced$/u)).toBeVisible();
    await expect
      .poll(() => readCloudRecovery(page, boardId))
      .toEqual({ elements: 1, pending: false, pendingUpdates: 0 });

    await deleteCloudRecovery(page, boardId);
    await page.reload();
    await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
    await expect(page.getByText(/^Synced$/u)).toBeVisible();
    await attachRecoveredCloudState(
      page,
      testInfo,
      'cloud-cache-kill-recovered-state',
    );
  } finally {
    await context?.close().catch(() => undefined);
    await request.delete(`/api/boards/${boardId}`).catch(() => undefined);
    await rm(profileDirectory, { force: true, recursive: true });
  }
});

test('recovers an appended update when the browser dies before acknowledgement', async ({
  baseURL,
  request,
}, testInfo) => {
  test.setTimeout(60_000);
  if (baseURL === undefined) throw new Error('Cloud base URL is required');
  const boardId = await createRecoveryBoard(
    request,
    'Append boundary recovery board',
  );
  const profileDirectory = await temporaryDirectory('cloud-append-kill-');
  let context: BrowserContext | null = null;

  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      baseURL,
      headless: true,
    });
    await authenticate(context);
    let page = context.pages()[0] ?? (await context.newPage());
    let holdAcknowledgements = false;
    const heldSequences: number[] = [];
    await page.routeWebSocket(/\/collaboration\//u, (route) => {
      const server = route.connectToServer();
      route.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        const sequence = acknowledgementSequence(message);
        if (holdAcknowledgements && sequence !== null && sequence > 0) {
          heldSequences.push(sequence);
          return;
        }
        route.send(message);
      });
    });
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByText(/^Synced$/u)).toBeVisible();
    holdAcknowledgements = true;
    await drawCloudShape(page);
    await drawCloudShape(page, 2, 180);
    await expect.poll(() => heldSequences).toHaveLength(2);
    expect(heldSequences[1]).toBeGreaterThan(heldSequences[0] ?? 0);
    await expect
      .poll(() => readCloudRecovery(page, boardId))
      .toEqual({ elements: 2, pending: true, pendingUpdates: 2 });

    await crashChromiumBrowser(context, page);
    context = null;
    context = await chromium.launchPersistentContext(profileDirectory, {
      baseURL,
      headless: true,
    });
    await authenticate(context);
    page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
    await expect(page.getByText(/^Synced$/u)).toBeVisible();
    await expect
      .poll(() => readCloudRecovery(page, boardId))
      .toEqual({ elements: 2, pending: false, pendingUpdates: 0 });

    await deleteCloudRecovery(page, boardId);
    await page.reload();
    await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
    await expect(page.getByText(/^Synced$/u)).toBeVisible();
    await attachRecoveredCloudState(
      page,
      testInfo,
      'cloud-append-kill-recovered-state',
    );
  } finally {
    await context?.close().catch(() => undefined);
    await request.delete(`/api/boards/${boardId}`).catch(() => undefined);
    await rm(profileDirectory, { force: true, recursive: true });
  }
});

test('loads acknowledged state without a device cache after an abrupt browser kill', async ({
  baseURL,
  request,
}, testInfo) => {
  test.setTimeout(60_000);
  if (baseURL === undefined) throw new Error('Cloud base URL is required');
  const boardId = await createRecoveryBoard(
    request,
    'Acknowledgement boundary recovery board',
  );
  const profileDirectory = await temporaryDirectory('cloud-ack-kill-');
  let context: BrowserContext | null = null;

  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      baseURL,
      headless: true,
    });
    await authenticate(context);
    let page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByText(/^Synced$/u)).toBeVisible();
    await drawCloudShape(page);
    await expect(page.getByText(/^Synced$/u)).toBeVisible();
    await expect
      .poll(() => readCloudRecovery(page, boardId))
      .toEqual({ elements: 1, pending: false, pendingUpdates: 0 });

    await crashChromiumBrowser(context, page);
    context = null;
    context = await chromium.launchPersistentContext(profileDirectory, {
      baseURL,
      headless: true,
    });
    await authenticate(context);
    page = context.pages()[0] ?? (await context.newPage());
    await page.goto('/');
    await expect(
      page.getByRole('application', { name: 'Chalkboard drawing canvas' }),
    ).toBeVisible();
    await deleteCloudRecovery(page, boardId);
    await page.goto(`/boards/${boardId}`);
    await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
    await expect(page.getByText(/^Synced$/u)).toBeVisible();
    await expect
      .poll(() => readCloudRecovery(page, boardId))
      .toEqual({ elements: 1, pending: false, pendingUpdates: 0 });
    await attachRecoveredCloudState(
      page,
      testInfo,
      'cloud-ack-kill-recovered-state',
    );
  } finally {
    await context?.close().catch(() => undefined);
    await request.delete(`/api/boards/${boardId}`).catch(() => undefined);
    await rm(profileDirectory, { force: true, recursive: true });
  }
});

test('stops automatic reconnects at the limit and permits explicit retry', async ({
  context,
  page,
}) => {
  await authenticate(context);
  const created = await context.request.post('/api/boards', {
    data: { title: 'Reconnect boundary board' },
  });
  expect(created.ok()).toBe(true);
  const boardId = requiredString(
    (await created.json()).board?.id,
    'reconnect boundary board identifier',
  );
  let connections = 0;
  let closeLiveConnection: (() => Promise<void>) | null = null;
  await page.routeWebSocket(/\/collaboration\//u, (route) => {
    connections += 1;
    if (connections <= MAX_CLOUD_RECONNECT_ATTEMPTS + 1) {
      void route.close({ code: 1013, reason: 'Boundary test' });
    } else {
      route.connectToServer();
      closeLiveConnection = () =>
        route.close({ code: 1013, reason: 'Reset allowance test' });
    }
  });
  await page.clock.install();
  await page.goto(`/boards/${boardId}`);

  for (const [index, delay] of CLOUD_RECONNECT_DELAYS_MS.entries()) {
    await expect.poll(() => connections).toBe(index + 1);
    await page.clock.fastForward(delay);
  }
  await expect.poll(() => connections).toBe(MAX_CLOUD_RECONNECT_ATTEMPTS + 1);
  await expect(
    page.getByRole('button', { name: 'Disconnected — Retry' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Disconnected — Retry' }).click();
  await expect.poll(() => connections).toBe(MAX_CLOUD_RECONNECT_ATTEMPTS + 2);
  await expect(page.getByText(/^Synced$/u)).toBeVisible();
  if (closeLiveConnection === null) {
    throw new Error('The successful cloud connection was not captured');
  }
  await closeLiveConnection();
  // A drop that recovers inside the reconnect grace window is deliberately
  // never announced: the badge holds Connected rather than blinking a
  // disconnection the user cannot act on.
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await expect(page.getByText('Disconnected', { exact: true })).toHaveCount(0);
  await page.clock.fastForward(CLOUD_RECONNECT_DELAYS_MS[0]);
  await expect.poll(() => connections).toBe(MAX_CLOUD_RECONNECT_ATTEMPTS + 3);
  await expect(page.getByText(/^Synced$/u)).toBeVisible();
  const deleted = await context.request.delete(`/api/boards/${boardId}`);
  expect(deleted.ok()).toBe(true);
});

test('preserves an oversized pending recovery document without overwriting it', async ({
  context,
  page,
}) => {
  await authenticate(context);
  const created = await context.request.post('/api/boards', {
    data: { title: 'Oversized recovery board' },
  });
  expect(created.ok()).toBe(true);
  const boardId = requiredString(
    (await created.json()).board?.id,
    'oversized recovery board identifier',
  );

  await page.goto('/');
  await expect(
    page.getByRole('application', { name: 'Chalkboard drawing canvas' }),
  ).toBeVisible();
  await seedOversizedPendingRecovery(page, boardId);
  await page.goto(`/boards/${boardId}`);

  await expect(page.getByText('Device recovery unavailable')).toBeVisible();
  await expect(page.getByText(/^Synced$/u)).toBeVisible();
  await expect
    .poll(() => oversizedRecoveryPayloadLength(page, boardId))
    .toBe(MAX_CLOUD_RECOVERY_DOCUMENT_BYTES + 1);
  const deleted = await context.request.delete(`/api/boards/${boardId}`);
  expect(deleted.ok()).toBe(true);
});

test('converts an over-age pending queue to a durable recovery snapshot', async ({
  context,
}) => {
  await authenticate(context);
  const created = await context.request.post('/api/boards', {
    data: { title: 'Aged recovery board' },
  });
  expect(created.ok()).toBe(true);
  const boardId = requiredString(
    (await created.json()).board?.id,
    'aged recovery board identifier',
  );

  let page = await context.newPage();
  await page.goto(`/boards/${boardId}`);
  await expect(page.getByText(/^Synced$/u)).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByText('Disconnected', { exact: true })).toBeVisible();

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error('Cloud canvas is not measurable');
  await page.getByRole('button', { name: 'Shape tool' }).click();
  await page.mouse.move(bounds.x + 260, bounds.y + 220);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 380, bounds.y + 300);
  await page.mouse.up();
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await expect
    .poll(() => readCloudRecovery(page, boardId))
    .toEqual({ elements: 1, pending: true, pendingUpdates: 1 });
  await agePendingRecovery(page, boardId);

  await page.close();
  await context.setOffline(false);
  page = await context.newPage();
  await page.goto(`/boards/${boardId}`);
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await expect(page.getByText(/^Synced$/u)).toBeVisible();
  await expect
    .poll(() => readCloudRecovery(page, boardId))
    .toEqual({ elements: 1, pending: false, pendingUpdates: 0 });

  await deleteCloudRecovery(page, boardId);
  await page.reload();
  await expect(page.getByText(/^Synced$/u)).toBeVisible();
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  const deleted = await context.request.delete(`/api/boards/${boardId}`);
  expect(deleted.ok()).toBe(true);
});
