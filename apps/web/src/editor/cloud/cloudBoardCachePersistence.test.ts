/**
 * Exercises acknowledged baselines and pending cloud recovery records in
 * IndexedDB, including legacy conversion, bounds, expiry, and exact clearing.
 */
import 'fake-indexeddb/auto';

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import type { BoardElement } from '@chalkboard/shared';

import cloudCacheV2LegacyPending from '../../test/fixtures/cloud-cache-v2-legacy-pending.json';
import { requiredTestValue } from '../../test/assertions';
import {
  loadCloudBoardCache,
  saveCloudBoardCache,
} from '../local/boardStorage';
import {
  cloudRecoveryDocumentByteLength,
  MAX_CLOUD_RECOVERY_DOCUMENT_BYTES,
  MAX_PENDING_CLOUD_TOTAL_BYTES,
  MAX_PENDING_CLOUD_UPDATE_BYTES,
  MAX_PENDING_CLOUD_UPDATE_COUNT,
  PreservedCloudRecoveryError,
} from './cloudBoardCacheQueue';

async function overwriteCloudCacheFixture(fixture: unknown): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('chalkboard-local');
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
  const transaction = database.transaction('boards', 'readwrite');
  transaction.objectStore('boards').put(fixture);
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('error', () => reject(transaction.error));
    transaction.addEventListener('abort', () => reject(transaction.error));
  });
  database.close();
}

function pendingCloudUpdates(): Uint8Array[] {
  const document = new Y.Doc();
  const updates: Uint8Array[] = [];
  document.on('update', (update) => updates.push(update));
  document.getMap('content').set('first', 1);
  document.getMap('content').set('second', 2);
  return updates;
}

async function seedCloudCacheFixture(fixture: unknown): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('chalkboard-local', 4);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains('boards')) {
        request.result.createObjectStore('boards', { keyPath: 'id' });
      }
      const images = request.result.objectStoreNames.contains('images')
        ? requiredTestValue(
            request.transaction,
            'cloud-cache fixture upgrade transaction',
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
  const transaction = database.transaction('boards', 'readwrite');
  transaction.objectStore('boards').put(fixture);
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('error', () => reject(transaction.error));
    transaction.addEventListener('abort', () => reject(transaction.error));
  });
  database.close();
}

const element: BoardElement = {
  backgroundColor: 'transparent',
  cornerRadius: 0,
  createdBy: 'cache-test',
  height: 80,
  id: 'cached-shape',
  opacity: 1,
  rotation: 0,
  shapeKind: 'rectangle',
  strokeColor: '#111827',
  strokeStyle: 'solid',
  strokeWidth: 2,
  type: 'shape',
  width: 120,
  x: 10,
  y: 20,
};

describe('cloud board cache', () => {
  // Seed the old schema before another test upgrades the shared fake database.
  it('recovers the retained pre-update-queue pending cache fixture', async () => {
    await seedCloudCacheFixture(cloudCacheV2LegacyPending);

    await expect(loadCloudBoardCache('retained-cache')).resolves.toMatchObject({
      baselineElements: [],
      baselineTitle: 'Retained cloud cache',
      elements: [
        expect.objectContaining({
          id: 'legacy-cached-rectangle',
          shapeKind: 'rectangle',
          type: 'shape',
        }),
      ],
      pending: true,
      pendingSince: 1_704_067_200_000,
      pendingUpdates: [],
      title: 'Retained cloud cache',
      updatedAt: 1_704_067_200_000,
    });
  });

  it('isolates board-specific records and preserves pending offline changes', async () => {
    const pendingUpdate = requiredTestValue(
      pendingCloudUpdates()[0],
      'pending cloud update fixture',
    );
    await saveCloudBoardCache('first-board', {
      baselineElements: [],
      baselineTitle: 'First',
      elements: [element],
      pending: true,
      pendingSince: 5,
      pendingUpdates: [pendingUpdate],
      title: 'First',
      updatedAt: 10,
    });
    await saveCloudBoardCache('second-board', {
      elements: [],
      pending: false,
      title: 'Second',
      updatedAt: 20,
    });

    await expect(loadCloudBoardCache('first-board')).resolves.toMatchObject({
      baselineElements: [],
      baselineTitle: 'First',
      elements: [element],
      pending: true,
      pendingSince: 5,
      pendingUpdates: [pendingUpdate],
      title: 'First',
      updatedAt: 10,
    });
    await expect(loadCloudBoardCache('second-board')).resolves.toMatchObject({
      elements: [],
      pending: false,
      pendingUpdates: [],
      title: 'Second',
      updatedAt: 20,
    });
    await expect(loadCloudBoardCache('missing-board')).resolves.toBeNull();
  });

  it('compacts valid retained updates before recovery replay', async () => {
    await saveCloudBoardCache('compacted-updates', {
      elements: [element],
      pending: true,
      pendingUpdates: pendingCloudUpdates(),
      title: 'Compacted',
      updatedAt: 25,
    });

    const loaded = requiredTestValue(
      await loadCloudBoardCache('compacted-updates'),
      'compacted cloud cache',
    );
    expect(loaded.pendingUpdates).toHaveLength(1);
    const recovered = new Y.Doc();
    Y.applyUpdate(
      recovered,
      requiredTestValue(loaded.pendingUpdates[0], 'compacted pending update'),
    );
    expect(recovered.getMap('content').toJSON()).toEqual({
      first: 1,
      second: 2,
    });
  });

  it('preserves a malformed pending update without replaying it', async () => {
    const fixture = {
      elements: [element],
      id: 'cloud:malformed-retained-update',
      pending: true,
      pendingUpdates: [new Uint8Array([1, 2, 3])],
      schemaVersion: 2,
      title: 'Malformed recovery',
      updatedAt: 27,
    };
    await overwriteCloudCacheFixture(fixture);

    await expect(
      loadCloudBoardCache('malformed-retained-update'),
    ).rejects.toThrow(PreservedCloudRecoveryError);
    await expect(
      loadCloudBoardCache('malformed-retained-update'),
    ).rejects.toThrow(PreservedCloudRecoveryError);
  });

  it('rejects pending update queues beyond every count and byte boundary', async () => {
    const record = {
      elements: [element],
      pending: true,
      title: 'Bounded',
      updatedAt: 30,
    };
    await expect(
      saveCloudBoardCache('count-limit', {
        ...record,
        pendingUpdates: Array.from(
          { length: MAX_PENDING_CLOUD_UPDATE_COUNT + 1 },
          () => new Uint8Array([1]),
        ),
      }),
    ).rejects.toThrow('count exceeds');
    await expect(
      saveCloudBoardCache('update-limit', {
        ...record,
        pendingUpdates: [new Uint8Array(MAX_PENDING_CLOUD_UPDATE_BYTES + 1)],
      }),
    ).rejects.toThrow('update exceeds');
    await expect(
      saveCloudBoardCache('total-limit', {
        ...record,
        pendingUpdates: Array.from(
          {
            length:
              Math.floor(
                MAX_PENDING_CLOUD_TOTAL_BYTES / MAX_PENDING_CLOUD_UPDATE_BYTES,
              ) + 1,
          },
          () => new Uint8Array(MAX_PENDING_CLOUD_UPDATE_BYTES),
        ),
      }),
    ).rejects.toThrow('updates exceed');
  });

  it('rejects an oversized retained pending queue without deleting it', async () => {
    const fixture = {
      elements: [element],
      id: 'cloud:oversized-retained-queue',
      pending: true,
      pendingUpdates: Array.from(
        { length: MAX_PENDING_CLOUD_UPDATE_COUNT + 1 },
        () => new Uint8Array([1]),
      ),
      schemaVersion: 2,
      title: 'Preserved recovery',
      updatedAt: 40,
    };
    await overwriteCloudCacheFixture(fixture);

    await expect(
      loadCloudBoardCache('oversized-retained-queue'),
    ).rejects.toThrow('count exceeds');
    await expect(
      loadCloudBoardCache('oversized-retained-queue'),
    ).rejects.toThrow('count exceeds');
  });

  it('writes the exact recovery document boundary and rejects the next byte', async () => {
    const title = 'Document boundary';
    const emptyCreator = { ...element, createdBy: '' };
    const overhead = cloudRecoveryDocumentByteLength([emptyCreator], title);
    const exactElement = {
      ...emptyCreator,
      createdBy: 'x'.repeat(MAX_CLOUD_RECOVERY_DOCUMENT_BYTES - overhead),
    };

    await expect(
      saveCloudBoardCache('exact-document-boundary', {
        elements: [exactElement],
        title,
        updatedAt: 45,
      }),
    ).resolves.toBeUndefined();
    await expect(
      saveCloudBoardCache('over-document-boundary', {
        elements: [
          { ...exactElement, createdBy: `${exactElement.createdBy}x` },
        ],
        title,
        updatedAt: 46,
      }),
    ).rejects.toThrow('document exceeds');
  });

  it('preserves an oversized pending document but ignores a replaceable cache', async () => {
    const title = 'Oversized recovery';
    const overhead = cloudRecoveryDocumentByteLength([''], title);
    const oversized = 'x'.repeat(
      MAX_CLOUD_RECOVERY_DOCUMENT_BYTES - overhead + 1,
    );
    const fixture = {
      elements: [oversized],
      id: 'cloud:oversized-pending-document',
      pending: true,
      schemaVersion: 2,
      title,
      updatedAt: 50,
    };
    await overwriteCloudCacheFixture(fixture);

    await expect(
      loadCloudBoardCache('oversized-pending-document'),
    ).rejects.toThrow('document exceeds');
    await expect(
      loadCloudBoardCache('oversized-pending-document'),
    ).rejects.toThrow('document exceeds');

    await overwriteCloudCacheFixture({
      ...fixture,
      id: 'cloud:oversized-replaceable-document',
      pending: false,
    });
    await expect(
      loadCloudBoardCache('oversized-replaceable-document'),
    ).resolves.toBeNull();
  });

  it('coalesces superseded writes for one cloud board', async () => {
    const originalPut = IDBObjectStore.prototype.put;
    let writes = 0;
    const put = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (
          this.name === 'boards' &&
          (value as { id?: unknown }).id === 'cloud:coalesced-board'
        ) {
          writes += 1;
        }
        return key === undefined
          ? originalPut.call(this, value)
          : originalPut.call(this, value, key);
      });
    try {
      await Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          saveCloudBoardCache('coalesced-board', {
            elements: [element],
            title: `Revision ${index}`,
            updatedAt: index,
          }),
        ),
      );
    } finally {
      put.mockRestore();
    }

    expect(writes).toBeLessThanOrEqual(2);
    await expect(loadCloudBoardCache('coalesced-board')).resolves.toMatchObject(
      {
        title: 'Revision 99',
        updatedAt: 99,
      },
    );
  });
});
