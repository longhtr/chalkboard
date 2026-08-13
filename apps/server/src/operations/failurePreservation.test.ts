/** Proves cleanup runs completely and cannot hide an operation failure. */
import { describe, expect, it, vi } from 'vitest';

import { runWithFailurePreservingCleanup } from './failurePreservation.js';

describe('runWithFailurePreservingCleanup', () => {
  it('returns the operation result after ordered successful cleanup', async () => {
    const order: string[] = [];
    await expect(
      runWithFailurePreservingCleanup(
        async () => {
          order.push('operation');
          return 7;
        },
        [
          async () => {
            order.push('cleanup-1');
          },
          async () => {
            order.push('cleanup-2');
          },
        ],
        'failed',
      ),
    ).resolves.toBe(7);
    expect(order).toEqual(['operation', 'cleanup-1', 'cleanup-2']);
  });

  it('retains the operation failure and every cleanup failure', async () => {
    const primary = new Error('primary');
    const firstCleanup = new Error('first cleanup');
    const secondCleanup = new Error('second cleanup');
    const finalCleanup = vi.fn(async () => undefined);

    let caught: unknown;
    try {
      await runWithFailurePreservingCleanup(
        async () => Promise.reject(primary),
        [
          async () => Promise.reject(firstCleanup),
          async () => Promise.reject(secondCleanup),
          finalCleanup,
        ],
        'operation and cleanup failed',
      );
    } catch (error) {
      caught = error;
    }
    expect(finalCleanup).toHaveBeenCalledOnce();
    expect(caught).toBeInstanceOf(AggregateError);
    expect(caught).toMatchObject({ cause: primary });
    expect((caught as AggregateError).errors).toEqual([
      primary,
      firstCleanup,
      secondCleanup,
    ]);
  });

  it('reports all cleanup failures after a successful operation', async () => {
    const firstCleanup = new Error('first cleanup');
    const secondCleanup = new Error('second cleanup');

    await expect(
      runWithFailurePreservingCleanup(
        async () => undefined,
        [
          async () => Promise.reject(firstCleanup),
          async () => Promise.reject(secondCleanup),
        ],
        'cleanup failed',
      ),
    ).rejects.toMatchObject({
      errors: [firstCleanup, secondCleanup],
    });
  });
});
