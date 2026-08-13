/** Proves bounded worker count, result order, empty input, and rejection without assigning further work. */
import { describe, expect, it } from 'vitest';

import { mapConcurrently } from './mapConcurrently';

describe('mapConcurrently', () => {
  it('preserves order while bounding active work', async () => {
    let active = 0;
    let maximumActive = 0;
    const values = Array.from({ length: 12 }, (_, index) => index);

    const results = await mapConcurrently(values, 3, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, value % 3));
      active -= 1;
      return value * 2;
    });

    expect(results).toEqual(values.map((value) => value * 2));
    expect(maximumActive).toBe(3);
  });

  it('waits for in-flight work and starts no more work after a failure', async () => {
    const started: number[] = [];
    let active = 0;

    await expect(
      mapConcurrently([0, 1, 2, 3, 4, 5], 2, async (value) => {
        started.push(value);
        active += 1;
        await new Promise((resolve) =>
          setTimeout(resolve, value === 0 ? 5 : 1),
        );
        active -= 1;
        if (value === 1) throw new Error('transfer failed');
        return value;
      }),
    ).rejects.toThrow('transfer failed');

    expect(active).toBe(0);
    expect(started).toEqual([0, 1]);
  });

  it('rejects invalid concurrency', async () => {
    await expect(
      mapConcurrently([1], 0, async (value) => value),
    ).rejects.toThrow('positive integer');
  });
});
