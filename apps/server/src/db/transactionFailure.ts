/** Preserves both the primary transaction failure and a rollback failure. */
import type { PoolClient } from 'pg';

/**
 * Rolls back a failed transaction and returns the original failure. If rollback
 * also fails, throws one aggregate so neither cause is discarded or replaced.
 */
export async function rollbackPreservingFailure(
  client: Pick<PoolClient, 'query'>,
  failure: unknown,
): Promise<unknown> {
  try {
    await client.query('ROLLBACK');
    return failure;
  } catch (rollbackFailure) {
    throw new AggregateError(
      [failure, rollbackFailure],
      'Database operation failed and transaction rollback also failed',
      { cause: rollbackFailure },
    );
  }
}
