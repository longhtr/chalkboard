/**
 * Injects IndexedDB/cache faults and stale records to prove blocked upgrades,
 * atomic replacement, revision conflict, patch recovery, and no resurrection.
 */
import { CHALKBOARD_SCHEMA_VERSIONS } from '@chalkboard/shared';
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';

const INDEXED_DB_VERSION = CHALKBOARD_SCHEMA_VERSIONS.indexedDb;

test('ignores stale compatibility-cache storage events in favor of IndexedDB', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const hasBoardCache = [...Array(localStorage.length).keys()].some((index) =>
      localStorage.key(index)?.startsWith('chalkboard:local-document:'),
    );
    if (!hasBoardCache) {
      localStorage.setItem(
        'chalkboard:local-document',
        JSON.stringify([
          {
            backgroundColor: 'transparent',
            createdBy: 'storage-recovery-test',
            height: 60,
            id: 'durable-rectangle',
            opacity: 1,
            rotation: 0,
            strokeColor: '#111827',
            strokeWidth: 2,
            type: 'rectangle',
            width: 80,
            x: 0,
            y: 0,
          },
        ]),
      );
    }
    const nativeGet = IDBObjectStore.prototype.get;
    Object.defineProperty(window, '__chalkboardBoardRecordReads', {
      configurable: true,
      value: 0,
      writable: true,
    });
    IDBObjectStore.prototype.get = function (query: IDBValidKey) {
      if (this.name === 'boards') {
        const instrumentedWindow = window as typeof window & {
          __chalkboardBoardRecordReads: number;
        };
        instrumentedWindow.__chalkboardBoardRecordReads += 1;
      }
      return nativeGet.call(this, query);
    };
  });
  await page.goto('/local');
  await expect(page).toHaveURL(/\/local\/[0-9a-f-]{36}$/iu);
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  const secondPage = await page.context().newPage();
  await secondPage.goto(page.url());
  await expect(secondPage.getByText('Canvas contains 1 object')).toBeVisible();
  const readsBefore = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __chalkboardBoardRecordReads: number;
        }
      ).__chalkboardBoardRecordReads,
  );
  const boardId = new URL(page.url()).pathname.split('/').at(-1);
  assertValue(boardId, 'local board identity');

  await secondPage.evaluate((id) => {
    localStorage.setItem(`chalkboard:local-document:${id}`, '[]');
  }, boardId);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __chalkboardBoardRecordReads: number;
            }
          ).__chalkboardBoardRecordReads,
      ),
    )
    .toBeGreaterThan(readsBefore);
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await expect(page.getByText('Canvas contains 0 objects')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await secondPage.close();
});

test('reconciles IndexedDB after compatibility-cache publication fails', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const nativeRemoveItem = Storage.prototype.removeItem;
    const nativeSetItem = Storage.prototype.setItem;
    const shouldFailDocumentCache = (key: string) =>
      key.startsWith('chalkboard:local-document:') &&
      localStorage.getItem('__chalkboardFailDocumentCache') === 'true';
    Storage.prototype.removeItem = function (key: string) {
      if (shouldFailDocumentCache(key)) {
        throw new DOMException('Storage is unavailable', 'InvalidStateError');
      }
      nativeRemoveItem.call(this, key);
    };
    Storage.prototype.setItem = function (key: string, value: string) {
      if (shouldFailDocumentCache(key)) {
        let elements: unknown = null;
        try {
          elements = JSON.parse(value);
        } catch {
          // Invalid compatibility values are not part of this fault boundary.
        }
        if (Array.isArray(elements) && elements.length >= 2) {
          throw new DOMException(
            'Storage quota exceeded',
            'QuotaExceededError',
          );
        }
      }
      nativeSetItem.call(this, key, value);
    };
  });
  await page.goto('/local');
  await expect(page).toHaveURL(/\/local\/[0-9a-f-]{36}$/iu);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.getByRole('button', { name: 'Shape tool' }).click();
  const drawShape = async (offset: number) => {
    const startX = bounds.x + bounds.width / 2 - 220 + offset;
    const startY = bounds.y + bounds.height / 2 - 90 + offset / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY + 60);
    await page.mouse.up();
  };
  const persistedCounts = () =>
    page.evaluate(
      ({ url, version }) =>
        new Promise<{ cache: number; durable: number }>((resolve, reject) => {
          const boardId = new URL(url).pathname.split('/').at(-1) ?? '';
          const cached = JSON.parse(
            localStorage.getItem(`chalkboard:local-document:${boardId}`) ??
              '[]',
          ) as unknown[];
          const request = indexedDB.open('chalkboard-local', version);
          request.addEventListener('error', () => reject(request.error));
          request.addEventListener('success', () => {
            const database = request.result;
            const record = database
              .transaction('boards', 'readonly')
              .objectStore('boards')
              .get(`local:${boardId}`);
            record.addEventListener('error', () => reject(record.error));
            record.addEventListener('success', () => {
              database.close();
              resolve({
                cache: cached.length,
                durable: Array.isArray(record.result?.elements)
                  ? record.result.elements.length
                  : 0,
              });
            });
          });
        }),
      { url: page.url(), version: INDEXED_DB_VERSION },
    );

  await drawShape(0);
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await expect.poll(persistedCounts).toEqual({ cache: 1, durable: 1 });
  await page.evaluate(() => {
    localStorage.setItem('__chalkboardFailDocumentCache', 'true');
  });
  await drawShape(140);
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
  await expect.poll(persistedCounts).toEqual({ cache: 1, durable: 2 });

  await page.reload();
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
  await expect.poll(persistedCounts).toEqual({ cache: 1, durable: 2 });
  await expect(page.getByText('Browser storage is unavailable')).toHaveCount(0);
});

test('keeps durable success when cross-tab notification fails', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeBroadcastChannel = BroadcastChannel;
    class FaultyBroadcastChannel extends NativeBroadcastChannel {
      override postMessage(): void {
        throw new DOMException('Notification unavailable', 'InvalidStateError');
      }
    }
    Object.defineProperty(window, 'BroadcastChannel', {
      configurable: true,
      value: FaultyBroadcastChannel,
    });
  });
  await page.goto('/local');
  await expect(page).toHaveURL(/\/local\/[0-9a-f-]{36}$/iu);
  const secondPage = await page.context().newPage();
  await secondPage.goto(page.url());
  await expect(secondPage.getByText('Canvas contains 0 objects')).toBeVisible();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');

  await page.getByRole('button', { name: 'Shape tool' }).click();
  await page.mouse.move(
    bounds.x + bounds.width / 2 - 100,
    bounds.y + bounds.height / 2 - 60,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.up();

  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await expect(secondPage.getByText('Canvas contains 1 object')).toBeVisible();
  await expect(page.getByText('Browser storage is unavailable')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await secondPage.close();
});

test('renders structured IndexedDB content over conflicting compatibility source', async ({
  page,
}) => {
  await page.goto('/local');
  await expect(page).toHaveURL(/\/local\/[0-9a-f-]{36}$/iu);
  const boardId = new URL(page.url()).pathname.split('/').at(-1);
  assertValue(boardId, 'local board identity');
  await expect
    .poll(() =>
      page.evaluate(
        ({ id, version }) =>
          new Promise<boolean>((resolve, reject) => {
            const request = indexedDB.open('chalkboard-local', version);
            request.addEventListener('error', () => reject(request.error));
            request.addEventListener('success', () => {
              const database = request.result;
              const record = database
                .transaction('boards', 'readonly')
                .objectStore('boards')
                .get(`local:${id}`);
              record.addEventListener('error', () => reject(record.error));
              record.addEventListener('success', () => {
                database.close();
                resolve(record.result !== undefined);
              });
            });
          }),
        { id: boardId, version: INDEXED_DB_VERSION },
      ),
    )
    .toBe(true);
  await page.evaluate(
    ({ id, version }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('chalkboard-local', version);
        request.addEventListener('error', () => reject(request.error));
        request.addEventListener('success', () => {
          const database = request.result;
          const transaction = database.transaction('boards', 'readwrite');
          const boards = transaction.objectStore('boards');
          const current = boards.get(`local:${id}`);
          current.addEventListener('success', () => {
            boards.put({
              ...current.result,
              elements: [
                {
                  backgroundColor: 'transparent',
                  createdBy: 'fixture',
                  fontSize: 30,
                  height: 50,
                  id: 'structured-winner',
                  lineSpacing: 1.2,
                  opacity: 1,
                  rotation: 0,
                  source: 'Stale compatibility source',
                  strokeColor: '#111827',
                  strokeStyle: 'solid',
                  strokeWidth: 2,
                  type: 'equation',
                  width: 260,
                  x: -130,
                  y: -25,
                },
              ],
              mixedContentByElementId: {
                'structured-winner': {
                  rows: [
                    {
                      spans: [
                        {
                          bold: false,
                          color: '#111827',
                          italic: false,
                          kind: 'text',
                          text: 'Structured winner',
                        },
                      ],
                    },
                  ],
                  version: 1,
                },
              },
              updatedAt: Date.now() + 1,
            });
          });
          transaction.addEventListener('error', () =>
            reject(transaction.error),
          );
          transaction.addEventListener('complete', () => {
            database.close();
            resolve();
          });
        });
      }),
    { id: boardId, version: INDEXED_DB_VERSION },
  );

  await page.reload();
  await expect(
    page.getByRole('group', { name: 'Structured winner', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Stale compatibility source')).toHaveCount(0);
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
});

test('rejects and reconciles a stale local-tab revision', async ({ page }) => {
  await page.goto('/local');
  await expect(page).toHaveURL(/\/local\/[0-9a-f-]{36}$/iu);
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  const boardId = new URL(page.url()).pathname.split('/').at(-1);
  assertValue(boardId, 'local board identity');
  const durableUpdatedAt = Date.now() + 60_000;
  await page.evaluate(
    ({ id, updatedAt, version }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('chalkboard-local', version);
        request.addEventListener('error', () => reject(request.error));
        request.addEventListener('success', () => {
          const database = request.result;
          const transaction = database.transaction('boards', 'readwrite');
          const boards = transaction.objectStore('boards');
          const current = boards.get(`local:${id}`);
          current.addEventListener('error', () => reject(current.error));
          current.addEventListener('success', () => {
            if (current.result === undefined) {
              reject(new Error('The local board fixture is unavailable'));
              return;
            }
            boards.put({
              ...current.result,
              elements: [
                {
                  backgroundColor: 'transparent',
                  createdBy: 'newer-tab',
                  fontSize: 30,
                  height: 50,
                  id: 'durable-winner',
                  lineSpacing: 1.2,
                  opacity: 1,
                  rotation: 0,
                  source: 'Durable winner',
                  strokeColor: '#111827',
                  strokeStyle: 'solid',
                  strokeWidth: 2,
                  type: 'equation',
                  width: 220,
                  x: -110,
                  y: -25,
                },
              ],
              mixedContentByElementId: {},
              title: 'Newer durable title',
              updatedAt,
            });
          });
          transaction.addEventListener('abort', () =>
            reject(transaction.error),
          );
          transaction.addEventListener('error', () =>
            reject(transaction.error),
          );
          transaction.addEventListener('complete', () => {
            database.close();
            resolve();
          });
        });
      }),
    { id: boardId, updatedAt: durableUpdatedAt, version: INDEXED_DB_VERSION },
  );

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.getByRole('button', { name: 'Shape tool' }).click();
  await page.mouse.move(
    bounds.x + bounds.width / 2 - 180,
    bounds.y + bounds.height / 2 - 80,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 - 80,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.up();

  await expect(
    page.getByRole('group', { name: 'Durable winner', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Board title' })).toHaveValue(
    'Newer durable title',
  );
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await expect(page.getByText('Browser storage is unavailable')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        (id) => ({
          pending: localStorage.getItem(
            `chalkboard:pending-local-document:${id}`,
          ),
          title: localStorage.getItem(`chalkboard:local-title:${id}`),
        }),
        boardId,
      ),
    )
    .toEqual({ pending: null, title: 'Newer durable title' });
  await page.reload();
  await expect(
    page.getByRole('group', { name: 'Durable winner', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
});

test('reopens IndexedDB after an active connection receives versionchange', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const nativeAddEventListener = IDBDatabase.prototype.addEventListener;
    IDBDatabase.prototype.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === 'versionchange') {
        (
          window as typeof window & {
            __chalkboardVersionchangeDatabase?: IDBDatabase;
          }
        ).__chalkboardVersionchangeDatabase = this;
      }
      nativeAddEventListener.call(this, type, listener, options);
    };
  });
  await page.goto('/local');
  await expect(
    page.getByRole('application', { name: 'Chalkboard drawing canvas' }),
  ).toBeVisible();
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await page.getByRole('button', { name: 'Shape tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');

  const drawShape = async (offset: number) => {
    const startX = bounds.x + bounds.width / 2 - 240 + offset;
    const startY = bounds.y + bounds.height / 2 - 100 + offset / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY + 60);
    await page.mouse.up();
  };
  const durableElementCount = () =>
    page.evaluate(
      (version) =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open('chalkboard-local', version);
          request.addEventListener('error', () => reject(request.error));
          request.addEventListener('success', () => {
            const database = request.result;
            const records = database
              .transaction('boards', 'readonly')
              .objectStore('boards')
              .getAll();
            records.addEventListener('error', () => reject(records.error));
            records.addEventListener('success', () => {
              const count = records.result
                .filter(
                  (record) =>
                    typeof record.id === 'string' &&
                    record.id.startsWith('local:'),
                )
                .reduce(
                  (maximum, record) =>
                    Math.max(
                      maximum,
                      Array.isArray(record.elements)
                        ? record.elements.length
                        : 0,
                    ),
                  0,
                );
              database.close();
              resolve(count);
            });
          });
        }),
      INDEXED_DB_VERSION,
    );

  await drawShape(0);
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await expect.poll(durableElementCount).toBe(1);
  await page.evaluate(() => {
    const database = (
      window as typeof window & {
        __chalkboardVersionchangeDatabase?: IDBDatabase;
      }
    ).__chalkboardVersionchangeDatabase;
    if (database === undefined) {
      throw new Error('The application IndexedDB connection was not captured');
    }
    database.dispatchEvent(new Event('versionchange'));
  });

  await drawShape(120);
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
  await expect.poll(durableElementCount).toBe(2);
  await expect(page.getByText('Local storage needs attention')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
});
