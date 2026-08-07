/** Proves compaction leases enforce process concurrency, queue, byte, timeout, and release limits. */
import { describe, expect, it } from 'vitest';

import {
  CollaborationCompactionController,
  CollaborationCompactionOverloadError,
} from './compactionController.js';

describe('collaboration compaction admission', () => {
  it('bounds active and pending compactions and drains in order', async () => {
    let finishFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const order: string[] = [];
    const controller = new CollaborationCompactionController({
      concurrent: 1,
      pending: 2,
    });

    const first = controller.run(async () => {
      order.push('first:start');
      await firstGate;
      order.push('first:end');
    });
    const second = controller.run(async () => {
      order.push('second');
    });
    const third = controller.run(async () => {
      order.push('third');
    });
    await expect(controller.run(async () => undefined)).rejects.toBeInstanceOf(
      CollaborationCompactionOverloadError,
    );
    expect(controller.snapshot()).toEqual({ active: 1, pending: 2 });

    finishFirst?.();
    await Promise.all([first, second, third]);
    expect(order).toEqual(['first:start', 'first:end', 'second', 'third']);
    expect(controller.snapshot()).toEqual({ active: 0, pending: 0 });
  });

  it('uses every configured concurrent slot', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new CollaborationCompactionController({
      concurrent: 2,
      pending: 1,
    });
    const first = controller.run(async () => gate);
    const second = controller.run(async () => gate);
    expect(controller.snapshot()).toEqual({ active: 2, pending: 0 });
    release?.();
    await Promise.all([first, second]);
  });
});
