/**
 * Tracks one monotonically increasing room/socket generation. A callback may
 * mutate current state only while its captured generation remains active;
 * retirement invalidates every callback captured by the previous owner.
 */
interface GenerationTracker {
  readonly size: number;
  advance(key: string): symbol;
  current(key: string): symbol;
}

/** Creates a bounded least-recently-refreshed generation map with protected keys. */
export function createGenerationTracker({
  isProtected = () => false,
  maximumEntries,
}: {
  isProtected?: (key: string) => boolean;
  maximumEntries: number;
}): GenerationTracker {
  const generations = new Map<string, symbol>();

  const set = (key: string, generation: symbol) => {
    generations.delete(key);
    generations.set(key, generation);
    if (generations.size <= maximumEntries) return;
    for (const candidate of generations.keys()) {
      if (candidate !== key && !isProtected(candidate)) {
        generations.delete(candidate);
        if (generations.size <= maximumEntries) break;
      }
    }
  };

  return {
    get size() {
      return generations.size;
    },
    advance(key) {
      const generation = Symbol(key);
      set(key, generation);
      return generation;
    },
    current(key) {
      const existing = generations.get(key);
      if (existing !== undefined) return existing;
      const generation = Symbol(key);
      set(key, generation);
      return generation;
    },
  };
}
