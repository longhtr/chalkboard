/** Preserves a primary asynchronous failure and every independent cleanup failure. */

interface CapturedFailure {
  value: unknown;
}

/**
 * Runs an operation and then every cleanup task in order. No cleanup failure can
 * replace the primary failure or prevent later cleanup tasks from running.
 */
export async function runWithFailurePreservingCleanup<T>(
  operation: () => Promise<T>,
  cleanupTasks: readonly (() => Promise<void> | void)[],
  aggregateMessage: string,
): Promise<T> {
  let result: T | undefined;
  let operationFailure: CapturedFailure | null = null;
  try {
    result = await operation();
  } catch (error) {
    operationFailure = { value: error };
  }

  const cleanupFailures: unknown[] = [];
  for (const cleanup of cleanupTasks) {
    try {
      await cleanup();
    } catch (error) {
      cleanupFailures.push(error);
    }
  }

  if (operationFailure !== null) {
    if (cleanupFailures.length === 0) throw operationFailure.value;
    throw new AggregateError(
      [operationFailure.value, ...cleanupFailures],
      aggregateMessage,
      { cause: operationFailure.value },
    );
  }
  if (cleanupFailures.length === 1) throw cleanupFailures[0];
  if (cleanupFailures.length > 1) {
    throw new AggregateError(cleanupFailures, aggregateMessage, {
      cause: cleanupFailures[0],
    });
  }
  return result as T;
}
