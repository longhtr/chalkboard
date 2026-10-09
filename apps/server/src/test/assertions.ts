/** Fails a server-test precondition instead of hiding it behind a non-null assertion. */
export function requiredTestValue<Value>(
  value: Value | null | undefined,
  description: string,
): Value {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${description}`);
  }
  return value;
}

/** Requires a runtime string before a test uses an external response value. */
export function requiredTestString(
  value: unknown,
  description: string,
): string {
  if (typeof value !== 'string') throw new Error(`Expected ${description}`);
  return value;
}

/** Requires a non-array runtime object before a test inspects response fields. */
export function requiredTestObject(
  value: unknown,
  description: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${description}`);
  }
  return value as Record<string, unknown>;
}

/** Polls an asynchronous test observation until it succeeds or reaches a bounded deadline. */
export async function waitForTestCondition(
  predicate: () => boolean | Promise<boolean>,
  {
    description = 'test condition',
    intervalMilliseconds = 10,
    timeoutMilliseconds = 5_000,
  }: {
    description?: string;
    intervalMilliseconds?: number;
    timeoutMilliseconds?: number;
  } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!(await predicate())) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMilliseconds));
  }
}

/** Extracts the first cookie pair from a Fastify injection response header. */
export function responseCookie(header: string | string[] | undefined): string {
  const cookieHeader = Array.isArray(header)
    ? requiredTestValue(header[0], 'first Set-Cookie header')
    : requiredTestValue(header, 'Set-Cookie header');
  return requiredTestValue(cookieHeader.split(';')[0], 'session cookie value');
}
