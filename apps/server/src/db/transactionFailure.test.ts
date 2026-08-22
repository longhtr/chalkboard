/** Proves transaction cleanup never discards either the primary or rollback failure. */
import { describe, expect, it, vi } from 'vitest';

import { rollbackPreservingFailure } from './transactionFailure.js';

describe('rollbackPreservingFailure', () => {
  it('returns the primary failure after a successful rollback', async () => {
    const failure = new Error('primary');
    const query = vi.fn(async () => ({ rows: [] }));

    await expect(
      rollbackPreservingFailure({ query } as never, failure),
    ).resolves.toBe(failure);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('retains both failures when rollback also fails', async () => {
    const failure = new Error('primary');
    const rollbackFailure = new Error('rollback');
    const query = vi.fn(async () => Promise.reject(rollbackFailure));

    let caught: unknown;
    try {
      await rollbackPreservingFailure({ query } as never, failure);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect(caught).toMatchObject({ cause: rollbackFailure });
    expect((caught as AggregateError).errors).toEqual([
      failure,
      rollbackFailure,
    ]);
  });
});
