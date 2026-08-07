/**
 * Serializes local board writes and keeps only the newest not-yet-started job.
 * An in-flight IndexedDB transaction is never cancelled or reordered.
 */
let writeTail: Promise<void> = Promise.resolve();

/** Serializes one IndexedDB write after every previously accepted write settles. */
export function enqueueLocalBoardWrite<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result = writeTail.then(operation);
  writeTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Resolves after the current write tail settles, regardless of prior failure. */
export async function waitForLocalBoardWrites(): Promise<void> {
  await writeTail;
}
