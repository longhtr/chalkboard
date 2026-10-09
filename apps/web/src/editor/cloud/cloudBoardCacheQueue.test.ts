/** Proves cloud cache write ordering, coalescing, snapshot fallback, byte accounting, and failure isolation. */
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { requiredTestValue } from '../../test/assertions';
import {
  cloudRecoveryDocumentByteLength,
  compactPendingCloudUpdates,
  exceedsPendingCloudUpdateAge,
  exceedsPendingCloudUpdateLimits,
  LatestKeyedWriteQueue,
  MAX_CLOUD_RECOVERY_DOCUMENT_BYTES,
  MAX_PENDING_CLOUD_MERGED_BYTES,
  MAX_PENDING_CLOUD_TOTAL_BYTES,
  MAX_PENDING_CLOUD_UPDATE_AGE_MS,
  MAX_PENDING_CLOUD_UPDATE_BYTES,
  MAX_PENDING_CLOUD_UPDATE_COUNT,
  validateCloudRecoveryDocument,
} from './cloudBoardCacheQueue';

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('cloud recovery bounds', () => {
  it('measures JSON UTF-8 and accepts exactly one recovery document limit', () => {
    const representative = [
      {
        escaped: 'quote " slash \\ control \b\n',
        falseValue: false,
        loneSurrogate: '\ud800',
        omitted: undefined,
        unicode: 'π😀',
      },
    ];
    expect(cloudRecoveryDocumentByteLength(representative, 'Board π')).toBe(
      new TextEncoder().encode(
        JSON.stringify({ elements: representative, title: 'Board π' }),
      ).byteLength,
    );

    const overhead = cloudRecoveryDocumentByteLength([''], '');
    const exact = 'x'.repeat(MAX_CLOUD_RECOVERY_DOCUMENT_BYTES - overhead);
    expect(cloudRecoveryDocumentByteLength([exact], '')).toBe(
      MAX_CLOUD_RECOVERY_DOCUMENT_BYTES,
    );
    expect(() => validateCloudRecoveryDocument([exact], '')).not.toThrow();
    expect(cloudRecoveryDocumentByteLength([`${exact}x`], '')).toBe(
      MAX_CLOUD_RECOVERY_DOCUMENT_BYTES + 1,
    );
    expect(() => validateCloudRecoveryDocument([`${exact}x`], '')).toThrow(
      'document exceeds',
    );
  });

  it('compacts valid updates and switches to snapshot after the merged-byte limit', () => {
    const source = new Y.Doc();
    const updates: Uint8Array[] = [];
    source.on('update', (update) => updates.push(update));
    source.getMap('content').set('first', 1);
    source.getMap('content').set('second', 2);

    const compacted = compactPendingCloudUpdates(updates);
    expect(compacted).toHaveLength(1);
    const recovered = new Y.Doc();
    Y.applyUpdate(
      recovered,
      requiredTestValue(compacted[0], 'compacted cloud update'),
    );
    expect(recovered.getMap('content').toJSON()).toEqual({
      first: 1,
      second: 2,
    });

    const validEmptyUpdate = Y.encodeStateAsUpdate(new Y.Doc());
    expect(
      compactPendingCloudUpdates(
        [validEmptyUpdate],
        () => new Uint8Array(MAX_PENDING_CLOUD_MERGED_BYTES),
      ),
    ).toEqual([validEmptyUpdate]);
    expect(
      compactPendingCloudUpdates(
        [validEmptyUpdate],
        () => new Uint8Array(MAX_PENDING_CLOUD_MERGED_BYTES + 1),
      ),
    ).toEqual([]);
  });

  it('accepts exact boundaries and rejects the next count, byte, or age', () => {
    expect(
      exceedsPendingCloudUpdateLimits(
        MAX_PENDING_CLOUD_UPDATE_COUNT - 1,
        MAX_PENDING_CLOUD_TOTAL_BYTES - 1,
        1,
      ),
    ).toBe(false);
    expect(
      exceedsPendingCloudUpdateLimits(MAX_PENDING_CLOUD_UPDATE_COUNT, 0, 1),
    ).toBe(true);
    expect(
      exceedsPendingCloudUpdateLimits(0, 0, MAX_PENDING_CLOUD_UPDATE_BYTES + 1),
    ).toBe(true);
    expect(
      exceedsPendingCloudUpdateLimits(0, MAX_PENDING_CLOUD_TOTAL_BYTES, 1),
    ).toBe(true);
    expect(
      exceedsPendingCloudUpdateAge(1, 1 + MAX_PENDING_CLOUD_UPDATE_AGE_MS),
    ).toBe(false);
    expect(
      exceedsPendingCloudUpdateAge(1, 2 + MAX_PENDING_CLOUD_UPDATE_AGE_MS),
    ).toBe(true);
  });
});

describe('LatestKeyedWriteQueue', () => {
  it('coalesces superseded pending values without overlapping writes', async () => {
    const first = deferred();
    const write = vi
      .fn<(key: string, value: number) => Promise<void>>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const queue = new LatestKeyedWriteQueue(4, write);

    const writes = [
      queue.enqueue('board', 1),
      queue.enqueue('board', 2),
      queue.enqueue('board', 3),
    ];
    expect(write).toHaveBeenCalledTimes(1);
    first.resolve();
    await Promise.all(writes);
    await queue.waitForIdle();

    expect(write.mock.calls).toEqual([
      ['board', 1],
      ['board', 3],
    ]);
  });

  it('bounds pending keys and continues after a failed write', async () => {
    const first = deferred();
    const write = vi
      .fn<(key: string, value: number) => Promise<void>>()
      .mockImplementationOnce(() => first.promise)
      .mockRejectedValueOnce(new Error('storage failed'))
      .mockResolvedValue(undefined);
    const queue = new LatestKeyedWriteQueue(1, write);

    const active = queue.enqueue('active', 1);
    const failed = expect(queue.enqueue('failed', 2)).rejects.toThrow(
      'storage failed',
    );
    await expect(queue.enqueue('overflow', 3)).rejects.toThrow('queue is full');
    first.resolve();
    await active;
    await failed;
    await expect(queue.enqueue('recovered', 4)).resolves.toBeUndefined();
    await queue.waitForIdle();
  });
});
