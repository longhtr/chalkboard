/** Shared precondition checks for deterministic geometry and document tests. */
export function requiredTestValue<Value>(
  value: Value | null | undefined,
  description: string,
): Value {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${description}`);
  }
  return value;
}
