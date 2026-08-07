/** Proves expensive password work obeys active/queued bounds and releases capacity after success or failure. */
import { describe, expect, it } from 'vitest';

import {
  PasswordWorkController,
  PasswordWorkOverloadError,
} from './passwordWorkController.js';

describe('PasswordWorkController', () => {
  it('bounds active and queued password work and drains in order', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];
    const controller = new PasswordWorkController({
      concurrent: 1,
      pending: 2,
    });

    const first = controller.run(async () => {
      order.push('first:start');
      await firstGate;
      order.push('first:end');
      return 1;
    });
    const second = controller.run(async () => {
      order.push('second');
      return 2;
    });
    const third = controller.run(async () => {
      order.push('third');
      return 3;
    });
    await expect(controller.run(async () => 4)).rejects.toBeInstanceOf(
      PasswordWorkOverloadError,
    );
    expect(controller.snapshot()).toEqual({
      active: 1,
      concurrent: 1,
      pending: 2,
      queued: 2,
    });

    releaseFirst?.();
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      1, 2, 3,
    ]);
    expect(order).toEqual(['first:start', 'first:end', 'second', 'third']);
    expect(controller.snapshot()).toMatchObject({ active: 0, queued: 0 });
  });

  it('uses every configured concurrent slot', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new PasswordWorkController({
      concurrent: 2,
      pending: 1,
    });
    const first = controller.run(async () => gate);
    const second = controller.run(async () => gate);

    expect(controller.snapshot()).toMatchObject({ active: 2, queued: 0 });
    release?.();
    await Promise.all([first, second]);
  });
});
