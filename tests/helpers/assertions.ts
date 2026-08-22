/** Turns nullable browser observations into explicit test preconditions. */
export function assertValue<Value>(
  value: Value,
  description: string,
): asserts value is NonNullable<Value> {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${description}`);
  }
}

export function requiredValue<Value>(
  value: Value | null | undefined,
  description: string,
): Value {
  assertValue(value, description);
  return value;
}

/** Requires a runtime string before a browser story uses an API response value. */
export function requiredString(value: unknown, description: string): string {
  if (typeof value !== 'string') throw new Error(`Expected ${description}`);
  return value;
}

/** Requires an array before a browser story counts or traverses response values. */
export function requiredArray(value: unknown, description: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${description}`);
  return value;
}

/** Requires a non-array runtime object before a browser story inspects fields. */
export function requiredObject(
  value: unknown,
  description: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${description}`);
  }
  return value as Record<string, unknown>;
}
