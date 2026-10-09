/**
 * Runs order-preserving asynchronous mapping with a fixed worker count. The
 * first rejection stops assigning new work while already-started work settles.
 */
export async function mapConcurrently<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  operation: (value: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a positive integer');
  }
  const tasks = values.map((value, index) => ({ index, value }));
  const results = new Array<Output>(tasks.length);
  let cursor = 0;
  let failed = false;
  let failure: unknown;

  const worker = async () => {
    while (!failed) {
      const task = tasks[cursor];
      cursor += 1;
      if (task === undefined) return;
      try {
        results[task.index] = await operation(task.value, task.index);
      } catch (error) {
        failed = true;
        failure = error;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, async () =>
      worker(),
    ),
  );
  if (failed) throw failure;
  return results;
}
