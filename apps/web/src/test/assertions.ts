/** Fails a unit-test precondition instead of hiding it behind a non-null assertion. */
export function requiredTestValue<Value>(
  value: Value | null | undefined,
  description: string,
): Value {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${description}`);
  }
  return value;
}
