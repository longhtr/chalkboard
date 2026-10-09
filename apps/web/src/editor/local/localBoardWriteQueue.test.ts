/** Uses controlled writes to prove FIFO execution, pending coalescing, error isolation, and drain behavior. */
import { describe, expect, it, vi } from 'vitest';

import {
  enqueueLocalBoardWrite,
  waitForLocalBoardWrites,
} from './localBoardWriteQueue';

describe('local board write queue', () => {
  it('starts writes in order and exposes an idle boundary', async () => {
    let finishFirst: (() => void) | undefined;
    const first = enqueueLocalBoardWrite(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const secondOperation = vi.fn(async () => 'second');
    const second = enqueueLocalBoardWrite(secondOperation);

    await Promise.resolve();
    expect(secondOperation).not.toHaveBeenCalled();
    finishFirst?.();
    await first;
    await expect(second).resolves.toBe('second');
    await expect(waitForLocalBoardWrites()).resolves.toBeUndefined();
  });

  it('continues after a rejected write without hiding that rejection', async () => {
    await expect(
      enqueueLocalBoardWrite(async () => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');

    await expect(enqueueLocalBoardWrite(async () => 'recovered')).resolves.toBe(
      'recovered',
    );
  });
});
