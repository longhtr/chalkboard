/**
 * Exhaustive IndexedDB transaction examples for board/assets atomicity,
 * revisions, migration, cache records, trash, rollback, and injected failures.
 */
import 'fake-indexeddb/auto';

import { describe, expect, it, vi } from 'vitest';

import type {
  BoardElement,
  EquationElement,
  ImageElement,
} from '@chalkboard/shared';

import localBoardV1 from '../../test/fixtures/local-board-v1.json';
import { requiredTestValue } from '../../test/assertions';
import {
  blobFromImageDataUrl,
  cachePendingLocalElements,
  duplicateLocalBoard,
  imageDataUrlFromBlob,
  initializeLocalBoardStorage,
  listLocalBoards,
  listTrashedLocalBoards,
  loadLocalBoard,
  localDocumentCacheKey,
  localPendingDocumentKey,
  localPendingTitleKey,
  localTitleCacheKey,
  type LocalBoardSummary,
  permanentlyDeleteAllTrashedLocalBoards,
  permanentlyDeleteLocalBoard,
  prepareBoardForStorage,
  renameLocalBoard,
  restoreAllLocalBoards,
  restoreLocalBoard,
  saveLocalBoard,
  structuredContentForElements,
  trashLocalBoard,
} from './boardStorage';
import {
  cachePendingLocalEquationEdit,
  localPendingEquationEditKey,
} from './localEquationRecovery';

const openFixtureDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('chalkboard-local', 5);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains('boards')) {
        request.result.createObjectStore('boards', { keyPath: 'id' });
      }
      const images = request.result.objectStoreNames.contains('images')
        ? requiredTestValue(
            request.transaction,
            'board-storage fixture upgrade transaction',
          ).objectStore('images')
        : request.result.createObjectStore('images', { keyPath: 'id' });
      if (!images.indexNames.contains('boardId')) {
        images.createIndex('boardId', 'boardId');
      }
      if (!request.result.objectStoreNames.contains('metadata')) {
        request.result.createObjectStore('metadata', { keyPath: 'id' });
      }
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });

const completed = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('error', () => reject(transaction.error));
    transaction.addEventListener('abort', () => reject(transaction.error));
  });

async function seedBoardFixture(fixture: unknown): Promise<void> {
  const database = await openFixtureDatabase();
  const transaction = database.transaction('boards', 'readwrite');
  transaction.objectStore('boards').put(fixture);
  await completed(transaction);
  database.close();
}

async function resetLegacyMigrationFixture(): Promise<void> {
  const database = await openFixtureDatabase();
  const transaction = database.transaction(
    ['boards', 'images', 'metadata'],
    'readwrite',
  );
  transaction.objectStore('boards').delete('local');
  transaction.objectStore('boards').delete('local:local');
  transaction.objectStore('metadata').delete('legacy-local-board-v1');
  const images = transaction.objectStore('images');
  const imageRecords = await new Promise<Record<string, unknown>[]>(
    (resolve, reject) => {
      const request = images.getAll();
      request.addEventListener('success', () =>
        resolve(request.result as Record<string, unknown>[]),
      );
      request.addEventListener('error', () => reject(request.error));
    },
  );
  for (const imageRecord of imageRecords) {
    if (imageRecord.boardId === undefined || imageRecord.boardId === 'local') {
      images.delete(imageRecord.id as IDBValidKey);
    }
  }
  await completed(transaction);
  database.close();
}

async function readStoredImages(): Promise<Record<string, unknown>[]> {
  const database = await openFixtureDatabase();
  const transaction = database.transaction('images', 'readonly');
  const request = transaction.objectStore('images').getAll();
  const result = await new Promise<Record<string, unknown>[]>(
    (resolve, reject) => {
      request.addEventListener('success', () =>
        resolve(request.result as Record<string, unknown>[]),
      );
      request.addEventListener('error', () => reject(request.error));
    },
  );
  await completed(transaction);
  database.close();
  return result;
}

async function readStoredBoard(
  boardId = 'local',
): Promise<Record<string, unknown>> {
  const database = await openFixtureDatabase();
  const transaction = database.transaction('boards', 'readonly');
  const request = transaction.objectStore('boards').get(`local:${boardId}`);
  const result = await new Promise<Record<string, unknown>>(
    (resolve, reject) => {
      request.addEventListener('success', () =>
        resolve(request.result as Record<string, unknown>),
      );
      request.addEventListener('error', () => reject(request.error));
    },
  );
  await completed(transaction);
  database.close();
  return result;
}

const image: ImageElement = {
  backgroundColor: 'transparent',
  createdBy: 'local',
  height: 1,
  id: 'image-1',
  name: 'pixel.png',
  opacity: 1,
  rotation: 0,
  source: 'data:image/png;base64,aW1hZ2UgYnl0ZXM=',
  strokeColor: 'transparent',
  strokeWidth: 0,
  type: 'image',
  width: 1,
  x: 0,
  y: 0,
};

const equation: BoardElement = {
  backgroundColor: 'transparent',
  createdBy: 'local',
  fontSize: 25,
  height: 30,
  id: 'equation-1',
  lineSpacing: 1.2,
  opacity: 1,
  rotation: 0,
  source: 'text $x$',
  strokeColor: '#1f2937',
  strokeWidth: 2,
  type: 'equation',
  width: 80,
  x: 0,
  y: 0,
};

describe('board storage conversion', () => {
  it('migrates the singleton fixture to one generated board ID exactly once', async () => {
    await resetLegacyMigrationFixture();
    await seedBoardFixture(localBoardV1);

    const first = await initializeLocalBoardStorage();
    const second = await initializeLocalBoardStorage();

    expect(first.migratedBoardId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(first.selectedBoardId).toBe(first.migratedBoardId);
    expect(second.migratedBoardId).toBe(first.migratedBoardId);
    expect(second.selectedBoardId).toBe(first.migratedBoardId);
    expect(
      first.boards.filter(({ id }) => id === first.migratedBoardId),
    ).toHaveLength(1);
    expect(
      requiredTestValue(
        await loadLocalBoard(first.selectedBoardId),
        'migrated local board',
      ).title,
    ).toBe('Retained local v1 board');
  });

  it('moves legacy image records into the generated board namespace', async () => {
    await resetLegacyMigrationFixture();
    const database = await openFixtureDatabase();
    const transaction = database.transaction(['boards', 'images'], 'readwrite');
    transaction.objectStore('boards').put({
      createdAt: 1,
      elements: [
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          height: 1,
          id: 'legacy-image',
          imageId: 'legacy-image',
          name: 'legacy.png',
          opacity: 1,
          rotation: 0,
          strokeColor: 'transparent',
          strokeWidth: 0,
          type: 'image',
          width: 1,
          x: 0,
          y: 0,
        },
      ],
      id: 'local',
      schemaVersion: 2,
      title: 'Legacy image board',
      updatedAt: 1,
    });
    transaction.objectStore('images').put({
      blob: new Blob(['image'], { type: 'image/png' }),
      id: 'legacy-image',
    });
    await completed(transaction);
    database.close();

    const initialized = await initializeLocalBoardStorage();
    const migratedImages = await readStoredImages();

    expect(migratedImages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          boardId: initialized.migratedBoardId,
          elementId: 'legacy-image',
          id: `local-image:${initialized.migratedBoardId}:legacy-image`,
        }),
      ]),
    );
    expect(migratedImages.map(({ id }) => id)).not.toContain('legacy-image');
  });

  it('loads the retained IndexedDB v1 fixture and rewrites current schema', async () => {
    await seedBoardFixture(localBoardV1);

    const loaded = requiredTestValue(
      await loadLocalBoard(),
      'retained IndexedDB fixture',
    );

    expect(loaded).toMatchObject({
      title: 'Retained local v1 board',
      updatedAt: 1_704_067_200_000,
    });
    expect(loaded.elements).toHaveLength(3);
    expect(loaded.elements[0]).toMatchObject({
      shapeKind: 'rectangle',
      strokeStyle: 'solid',
      type: 'shape',
    });
    expect(loaded.elements[1]).toMatchObject({
      lineSpacing: 1.2,
      source: String.raw`$\frac{a}{b}$`,
      type: 'equation',
    });
    expect(loaded.elements[2]).toMatchObject({
      arrowheads: 'end',
      pathKind: 'bezier',
      type: 'line',
    });

    await saveLocalBoard(loaded);
    const rewritten = await readStoredBoard();
    expect(rewritten.schemaVersion).toBe(2);
    expect(rewritten).toHaveProperty(
      'mixedContentByElementId.legacy-equation.version',
      1,
    );
  });

  it('derives stored compatibility source from structured mixed content', async () => {
    const boardId = `structured-authority-${crypto.randomUUID()}`;
    const winner = { ...equation, source: 'Structured storage winner' };
    await seedBoardFixture({
      createdAt: 1,
      elements: [{ ...equation, source: 'Stale storage source' }],
      id: `local:${boardId}`,
      mixedContentByElementId: structuredContentForElements([winner]),
      schemaVersion: 2,
      title: 'Structured authority',
      updatedAt: 2,
    });

    expect(await loadLocalBoard(boardId)).toMatchObject({
      elements: [
        expect.objectContaining({
          id: equation.id,
          source: 'Structured storage winner',
        }),
      ],
    });
  });

  it('round-trips image data URLs through blobs', async () => {
    const blob = blobFromImageDataUrl(image.source);

    expect(blob.type).toBe('image/png');
    expect(await imageDataUrlFromBlob(blob)).toBe(image.source);
  });

  it('separates image payloads from board records', async () => {
    const prepared = prepareBoardForStorage([equation, image]);

    expect(prepared.elements[0]).toEqual(equation);
    expect(prepared.elements[1]).toMatchObject({
      id: image.id,
      imageId: image.id,
      name: image.name,
      type: 'image',
    });
    expect(prepared.elements[1]).not.toHaveProperty('source');
    expect(prepared.images).toHaveLength(1);
    expect(
      await imageDataUrlFromBlob(
        requiredTestValue(prepared.images[0], 'prepared image fixture').blob,
      ),
    ).toBe(image.source);
  });

  it('reuses one serialized crash snapshot through durable cache publication', async () => {
    const boardId = `serialized-${crypto.randomUUID()}`;
    const elements = [equation];
    const serializedElementsForCaches = cachePendingLocalElements(
      elements,
      boardId,
      'Serialized once',
    );
    expect(serializedElementsForCaches).toBe(JSON.stringify(elements));
    if (serializedElementsForCaches === undefined) {
      throw new Error('The pending snapshot was not serialized');
    }
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      await saveLocalBoard(
        {
          elements,
          serializedElementsForCaches,
          title: 'Serialized once',
          updatedAt: Date.now(),
        },
        boardId,
      );

      expect(stringify).not.toHaveBeenCalled();
      expect(localStorage.getItem(localDocumentCacheKey(boardId))).toBe(
        serializedElementsForCaches,
      );
      expect(localStorage.getItem(localPendingDocumentKey(boardId))).toBeNull();
    } finally {
      stringify.mockRestore();
    }
  });

  it('rejects a stale replacement before changing the board or its cache', async () => {
    const boardId = `stale-write-${crypto.randomUUID()}`;
    const durableUpdatedAt = Date.now() + 1_000;
    await saveLocalBoard(
      {
        elements: [equation],
        title: 'Durable winner',
        updatedAt: durableUpdatedAt,
      },
      boardId,
    );
    const serializedStale = cachePendingLocalElements(
      [],
      boardId,
      'Stale replacement',
    );
    expect(serializedStale).toBe('[]');
    if (serializedStale === undefined) {
      throw new Error('The stale recovery fixture was not serialized');
    }

    const result = await saveLocalBoard(
      {
        elements: [],
        serializedElementsForCaches: serializedStale,
        title: 'Stale replacement',
        updatedAt: durableUpdatedAt,
      },
      boardId,
    );

    expect(result).toMatchObject({
      committed: false,
      current: {
        elements: [
          expect.objectContaining({ id: equation.id, source: equation.source }),
        ],
        title: 'Durable winner',
        updatedAt: durableUpdatedAt,
      },
    });
    expect(await loadLocalBoard(boardId)).toMatchObject({
      elements: [
        expect.objectContaining({ id: equation.id, source: equation.source }),
      ],
      title: 'Durable winner',
      updatedAt: durableUpdatedAt,
    });
    expect(localStorage.getItem(localPendingDocumentKey(boardId))).toBeNull();
    expect(localStorage.getItem(localPendingTitleKey(boardId))).toBeNull();
    expect(
      JSON.parse(
        requiredTestValue(
          localStorage.getItem(localDocumentCacheKey(boardId)),
          'local document compatibility cache',
        ),
      ),
    ).toEqual([equation]);
  });

  it('isolates multiple local boards and their image blobs', async () => {
    const timestamp = Date.now();
    const secondImage = {
      ...image,
      source: 'data:image/png;base64,c2Vjb25kIGltYWdl',
    };
    await saveLocalBoard(
      { elements: [image], title: 'First local board', updatedAt: timestamp },
      'first-local',
    );
    await saveLocalBoard(
      {
        elements: [secondImage],
        title: 'Second local board',
        updatedAt: timestamp + 1,
      },
      'second-local',
    );

    expect((await listLocalBoards()).map(({ id }) => id)).toEqual(
      expect.arrayContaining(['first-local', 'second-local']),
    );
    expect(
      (await readStoredImages()).map(({ boardId, elementId }) => ({
        boardId,
        elementId,
      })),
    ).toEqual(
      expect.arrayContaining([
        { boardId: 'first-local', elementId: image.id },
        { boardId: 'second-local', elementId: image.id },
      ]),
    );

    await saveLocalBoard(
      { elements: [equation], title: 'Equation board', updatedAt: timestamp },
      'equation-local',
    );
    const duplicated = await duplicateLocalBoard('equation-local');
    if (duplicated === null) {
      throw new Error('Expected duplicated local board metadata');
    }
    const duplicate = await loadLocalBoard(duplicated.id);
    if (duplicate === null) throw new Error('Expected duplicated local board');
    expect(duplicate.elements[0]).toMatchObject({
      source: equation.source,
      type: 'equation',
    });
    expect(
      requiredTestValue(duplicate.elements[0], 'duplicated equation').id,
    ).not.toBe(equation.id);

    await permanentlyDeleteLocalBoard('first-local');
    expect(await loadLocalBoard('first-local')).toBeNull();
    expect(
      (await readStoredImages()).map(({ boardId }) => boardId),
    ).not.toContain('first-local');
    expect((await readStoredImages()).map(({ boardId }) => boardId)).toContain(
      'second-local',
    );
  });

  it('leaves durable board and image stores unchanged when duplication aborts', async () => {
    const boardId = `duplicate-quota-${crypto.randomUUID()}`;
    await saveLocalBoard(
      {
        elements: [equation],
        title: 'Atomic duplicate',
        updatedAt: Date.now(),
      },
      boardId,
    );
    const boardsBefore = await listLocalBoards();
    const imagesBefore = await readStoredImages();
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (
          this.name === 'boards' &&
          (value as { title?: unknown }).title === 'Atomic duplicate copy'
        ) {
          throw new DOMException(
            'Storage quota exceeded',
            'QuotaExceededError',
          );
        }
        return key === undefined
          ? originalPut.call(this, value)
          : originalPut.call(this, value, key);
      });

    try {
      await expect(duplicateLocalBoard(boardId)).rejects.toMatchObject({
        name: 'QuotaExceededError',
      });
    } finally {
      put.mockRestore();
    }
    expect(await listLocalBoards()).toEqual(boardsBefore);
    expect(await readStoredImages()).toEqual(imagesBefore);
  });

  it('keeps trashed boards and images recoverable until explicit deletion', async () => {
    const boardId = `trash-${crypto.randomUUID()}`;
    const timestamp = Date.now();
    await saveLocalBoard(
      { elements: [image], title: 'Recoverable image', updatedAt: timestamp },
      boardId,
    );

    const trashed = await trashLocalBoard(boardId);

    expect(trashed).toMatchObject({ id: boardId, title: 'Recoverable image' });
    expect((await listLocalBoards()).map(({ id }) => id)).not.toContain(
      boardId,
    );
    expect((await listTrashedLocalBoards()).map(({ id }) => id)).toContain(
      boardId,
    );
    expect(await loadLocalBoard(boardId)).toBeNull();
    await expect(
      saveLocalBoard(
        { elements: [], title: 'Stale write', updatedAt: timestamp + 1 },
        boardId,
      ),
    ).rejects.toThrow('in trash');
    expect(localStorage.getItem(localDocumentCacheKey(boardId))).toBeNull();
    expect((await readStoredImages()).map(({ boardId }) => boardId)).toContain(
      boardId,
    );

    expect(await restoreLocalBoard(boardId)).toMatchObject({ id: boardId });
    expect((await listLocalBoards()).map(({ id }) => id)).toContain(boardId);
    expect((await listTrashedLocalBoards()).map(({ id }) => id)).not.toContain(
      boardId,
    );
    expect((await readStoredImages()).map(({ boardId }) => boardId)).toContain(
      boardId,
    );

    await trashLocalBoard(boardId);
    await permanentlyDeleteLocalBoard(boardId);
    expect((await listTrashedLocalBoards()).map(({ id }) => id)).not.toContain(
      boardId,
    );
    expect(
      (await readStoredImages()).map(({ boardId }) => boardId),
    ).not.toContain(boardId);
  });

  it('restores and permanently deletes trash in atomic bulk operations', async () => {
    const activeId = `active-${crypto.randomUUID()}`;
    const firstTrashId = `trash-first-${crypto.randomUUID()}`;
    const secondTrashId = `trash-second-${crypto.randomUUID()}`;
    const timestamp = Date.now();
    for (const [id, title] of [
      [activeId, 'Active'],
      [firstTrashId, 'First trash'],
      [secondTrashId, 'Second trash'],
    ] as const) {
      await saveLocalBoard(
        { elements: [image], title, updatedAt: timestamp },
        id,
      );
    }
    await trashLocalBoard(firstTrashId);
    await trashLocalBoard(secondTrashId);

    await expect(restoreAllLocalBoards()).resolves.toBe(2);
    expect((await listLocalBoards()).map(({ id }) => id)).toEqual(
      expect.arrayContaining([activeId, firstTrashId, secondTrashId]),
    );
    expect(await listTrashedLocalBoards()).toEqual([]);

    await trashLocalBoard(firstTrashId);
    await trashLocalBoard(secondTrashId);
    await expect(permanentlyDeleteAllTrashedLocalBoards()).resolves.toBe(2);
    expect((await listLocalBoards()).map(({ id }) => id)).toContain(activeId);
    expect((await listLocalBoards()).map(({ id }) => id)).not.toEqual(
      expect.arrayContaining([firstTrashId, secondTrashId]),
    );
    expect((await readStoredImages()).map(({ boardId }) => boardId)).toContain(
      activeId,
    );
    expect(
      (await readStoredImages()).map(({ boardId }) => boardId),
    ).not.toEqual(expect.arrayContaining([firstTrashId, secondTrashId]));
  });

  it('purges expired trash during trash listing', async () => {
    const boardId = `expired-${crypto.randomUUID()}`;
    await seedBoardFixture({
      createdAt: 1,
      elements: [],
      id: `local:${boardId}`,
      schemaVersion: 2,
      title: 'Expired board',
      trashedAt: 1,
      updatedAt: 1,
    });

    expect((await listTrashedLocalBoards()).map(({ id }) => id)).not.toContain(
      boardId,
    );
  });

  it('publishes an authoritative title cache only after rename persistence', async () => {
    const boardId = `rename-${crypto.randomUUID()}`;
    const timestamp = Date.now();
    await saveLocalBoard(
      { elements: [], title: 'Old title', updatedAt: timestamp },
      boardId,
    );
    localStorage.setItem(localTitleCacheKey(boardId), 'Old title');

    const renamed = await renameLocalBoard(boardId, '  New title  ');

    expect(requiredTestValue(renamed, 'renamed board').title).toBe('New title');
    expect(
      requiredTestValue(await loadLocalBoard(boardId), 'stored renamed board')
        .title,
    ).toBe('New title');
    expect(localStorage.getItem(localTitleCacheKey(boardId))).toBe('New title');
  });

  it('aborts board and image changes when a quota failure interrupts a write', async () => {
    const boardId = `quota-${crypto.randomUUID()}`;
    await saveLocalBoard(
      { elements: [image], title: 'Durable board', updatedAt: 1 },
      boardId,
    );
    const cacheBefore = localStorage.getItem(localDocumentCacheKey(boardId));
    const imagesBefore = (await readStoredImages()).filter(
      (record) => record.boardId === boardId,
    );
    const broadcast = vi.fn();
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        close() {}
        postMessage(message: unknown) {
          broadcast(message);
        }
      },
    );
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        const record = value as { id?: unknown };
        if (this.name === 'boards' && record.id === `local:${boardId}`) {
          throw new DOMException(
            'Storage quota exceeded',
            'QuotaExceededError',
          );
        }
        return key === undefined
          ? originalPut.call(this, value)
          : originalPut.call(this, value, key);
      });
    const replacementImage: ImageElement = {
      ...image,
      id: 'replacement-image',
      source: 'data:image/png;base64,cmVwbGFjZW1lbnQ=',
    };
    cachePendingLocalElements(
      [replacementImage],
      boardId,
      'Unsaved replacement',
    );

    try {
      await expect(
        saveLocalBoard(
          {
            elements: [replacementImage],
            title: 'Unsaved replacement',
            updatedAt: 2,
          },
          boardId,
        ),
      ).rejects.toMatchObject({ name: 'QuotaExceededError' });
    } finally {
      put.mockRestore();
      vi.unstubAllGlobals();
    }

    expect(broadcast).not.toHaveBeenCalled();
    expect(await readStoredBoard(boardId)).toMatchObject({
      elements: [expect.objectContaining({ id: image.id, imageId: image.id })],
      title: 'Durable board',
      updatedAt: 1,
    });
    expect(localStorage.getItem(localDocumentCacheKey(boardId))).toBe(
      cacheBefore,
    );
    expect(localStorage.getItem(localPendingDocumentKey(boardId))).toBe(
      JSON.stringify([replacementImage]),
    );
    expect(localStorage.getItem(localPendingTitleKey(boardId))).toBe(
      'Unsaved replacement',
    );
    expect(
      (await readStoredImages()).filter((record) => record.boardId === boardId),
    ).toEqual(imagesBefore);

    await saveLocalBoard(
      {
        elements: [replacementImage],
        title: 'Unsaved replacement',
        updatedAt: 2,
      },
      boardId,
    );
    expect(localStorage.getItem(localPendingDocumentKey(boardId))).toBeNull();
    expect(localStorage.getItem(localPendingTitleKey(boardId))).toBeNull();
    expect(localStorage.getItem(localTitleCacheKey(boardId))).toBe(
      'Unsaved replacement',
    );
  });

  it('clears only a compact equation recovery that reached durable storage', async () => {
    const boardId = `equation-recovery-${crypto.randomUUID()}`;
    const equation: EquationElement = {
      backgroundColor: 'transparent',
      createdBy: 'test',
      fontSize: 30,
      height: 40,
      id: 'equation',
      lineSpacing: 1.2,
      opacity: 1,
      rotation: 0,
      source: 'Recovered',
      strokeColor: '#111827',
      strokeStyle: 'solid',
      strokeWidth: 2,
      type: 'equation',
      width: 160,
      x: 10,
      y: 20,
    };
    cachePendingLocalEquationEdit(
      {
        baseSource: 'Before',
        deleted: false,
        element: equation,
        isNew: false,
      },
      boardId,
    );

    await saveLocalBoard(
      {
        elements: [{ ...equation, source: 'Different pending value' }],
        title: 'Recovery',
        updatedAt: 1,
      },
      boardId,
    );
    expect(
      localStorage.getItem(localPendingEquationEditKey(boardId)),
    ).not.toBeNull();

    await saveLocalBoard(
      {
        elements: [equation],
        title: 'Recovery',
        updatedAt: 2,
      },
      boardId,
    );
    expect(
      localStorage.getItem(localPendingEquationEditKey(boardId)),
    ).toBeNull();
  });

  it('does not decode and rewrite an unchanged image during metadata updates', async () => {
    const boardId = `unchanged-image-${crypto.randomUUID()}`;
    await saveLocalBoard(
      { elements: [image], title: 'Image board', updatedAt: 1 },
      boardId,
    );
    const decode = vi.spyOn(globalThis, 'atob');

    try {
      await saveLocalBoard(
        {
          elements: [{ ...image, width: image.width + 20 }],
          title: 'Renamed image board',
          updatedAt: 2,
        },
        boardId,
      );
    } finally {
      decode.mockRestore();
    }

    expect(decode).not.toHaveBeenCalled();
    expect(await readStoredBoard(boardId)).toMatchObject({
      elements: [expect.objectContaining({ width: image.width + 20 })],
      title: 'Renamed image board',
    });
    expect(
      (await readStoredImages()).filter((record) => record.boardId === boardId),
    ).toHaveLength(1);
  });

  it('updates one board without scanning unrelated image blobs', async () => {
    const boardId = `indexed-images-${crypto.randomUUID()}`;
    const otherBoardId = `indexed-images-other-${crypto.randomUUID()}`;
    await saveLocalBoard(
      { elements: [image], title: 'Indexed images', updatedAt: 1 },
      boardId,
    );
    await saveLocalBoard(
      { elements: [image], title: 'Other images', updatedAt: 1 },
      otherBoardId,
    );
    const originalGetAll = IDBObjectStore.prototype.getAll;
    const imageScans: string[] = [];
    const storeGetAll = vi
      .spyOn(IDBObjectStore.prototype, 'getAll')
      .mockImplementation(function (
        this: IDBObjectStore,
        query?: IDBValidKey | IDBKeyRange | null,
        count?: number,
      ) {
        if (this.name === 'images') imageScans.push(this.name);
        return originalGetAll.call(this, query, count);
      });

    try {
      await saveLocalBoard(
        { elements: [], title: 'Indexed images', updatedAt: 2 },
        boardId,
      );
    } finally {
      storeGetAll.mockRestore();
    }

    expect(imageScans).toEqual([]);
    const remainingImageBoardIds = (await readStoredImages()).map(
      ({ boardId }) => boardId,
    );
    expect(remainingImageBoardIds).not.toContain(boardId);
    expect(remainingImageBoardIds).toContain(otherBoardId);
  });

  it('lists and validates board metadata without scanning unrelated image blobs', async () => {
    const boardId = `metadata-only-${crypto.randomUUID()}`;
    await saveLocalBoard(
      { elements: [], title: 'Metadata only', updatedAt: Date.now() },
      boardId,
    );
    const database = await openFixtureDatabase();
    const markerTransaction = database.transaction(
      ['boards', 'metadata'],
      'readwrite',
    );
    markerTransaction.objectStore('metadata').put({
      boardId: null,
      completedAt: Date.now(),
      id: 'legacy-local-board-v1',
      version: 1,
    });
    const boards = markerTransaction.objectStore('boards');
    for (let index = 0; index < 300; index += 1) {
      boards.put({
        createdAt: index,
        elements: [],
        id: `local:summary-only-${index}`,
        schemaVersion: 2,
        title: `Summary ${index}`,
        updatedAt: index,
      });
    }
    await completed(markerTransaction);
    database.close();
    const originalGetAll = IDBObjectStore.prototype.getAll;
    const imageScans: string[] = [];
    const getAll = vi
      .spyOn(IDBObjectStore.prototype, 'getAll')
      .mockImplementation(function (
        this: IDBObjectStore,
        query?: IDBValidKey | IDBKeyRange | null,
        count?: number,
      ) {
        if (this.name === 'images') imageScans.push(this.name);
        return originalGetAll.call(this, query, count);
      });

    let summaries: LocalBoardSummary[];
    try {
      summaries = (await initializeLocalBoardStorage(boardId)).boards;
    } finally {
      getAll.mockRestore();
    }
    expect(
      summaries.filter(({ id }) => id.startsWith('summary-only-')),
    ).toHaveLength(300);
    expect(imageScans).toEqual([]);
  });

  it('reopens a closed IndexedDB handle before starting the next operation', async () => {
    await listLocalBoards();
    const originalTransaction = IDBDatabase.prototype.transaction;
    let rejectedClosedHandle = false;
    const transaction = vi
      .spyOn(IDBDatabase.prototype, 'transaction')
      .mockImplementation(function (
        this: IDBDatabase,
        storeNames: string | Iterable<string>,
        mode?: IDBTransactionMode,
        options?: IDBTransactionOptions,
      ) {
        if (!rejectedClosedHandle) {
          rejectedClosedHandle = true;
          throw new DOMException(
            'The connection is closed',
            'InvalidStateError',
          );
        }
        return originalTransaction.call(this, storeNames, mode, options);
      });

    try {
      await expect(listLocalBoards()).resolves.toEqual(expect.any(Array));
    } finally {
      transaction.mockRestore();
    }
    expect(rejectedClosedHandle).toBe(true);
  });

  it('creates structured mixed content for equation records', () => {
    expect(structuredContentForElements([equation, image])).toEqual({
      'equation-1': {
        rows: [
          {
            spans: [
              {
                bold: false,
                color: '#1f2937',
                italic: false,
                kind: 'text',
                text: 'text ',
              },
              { kind: 'math', latex: 'x' },
            ],
          },
        ],
        version: 1,
      },
    });
  });

  it('rejects non-image and non-base64 payloads', () => {
    expect(() => blobFromImageDataUrl('https://example.com/image.png')).toThrow(
      'base64 data URL',
    );
    expect(() =>
      blobFromImageDataUrl('data:text/plain;base64,dGV4dA=='),
    ).toThrow('base64 data URL');
  });
});
