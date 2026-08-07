/**
 * Stateless request-origin checks and a bounded in-memory fixed-window limiter.
 * Callers choose stable non-secret keys; this module never authenticates users
 * or treats proxy headers as trusted without configured proxy handling.
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

const MAX_TRACKED_RATE_LIMIT_KEYS = 10_000;

/**
 * Creates a bounded fixed-window limiter keyed by a caller-supplied identity.
 *
 * Counters live in this process only, which is exact because production admits
 * one server: `RUNTIME_LOCK_NAME` refuses a second instance. Any future change
 * that relaxes that lock must move these counters to shared storage first, or
 * each instance will independently grant the full limit.
 */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
}): (key: string) => RateLimitResult {
  const entries = new Map<string, RateLimitEntry>();

  return (key) => {
    const now = Date.now();
    const tracked = entries.get(key);
    const entry =
      tracked === undefined || tracked.resetAt <= now
        ? { count: 0, resetAt: now + options.windowMs }
        : tracked;
    entry.count += 1;
    // Re-insert so iteration order is least-recently-used first. `set` alone
    // leaves an existing key in place, which would let the eviction below drop
    // the very key a caller is being limited on — resetting their count.
    entries.delete(key);
    entries.set(key, entry);

    // Opportunistic cleanup bounds long-running deployments.
    if (entries.size > MAX_TRACKED_RATE_LIMIT_KEYS) {
      for (const [entryKey, candidateEntry] of entries) {
        if (candidateEntry.resetAt <= now) entries.delete(entryKey);
      }
      // Still full: drop the least recently used. A flood of fresh keys evicts
      // its own dormant entries rather than an actively limited one.
      if (entries.size > MAX_TRACKED_RATE_LIMIT_KEYS) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey !== undefined) entries.delete(oldestKey);
      }
    }

    return {
      allowed: entry.count <= options.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)),
    };
  };
}

/** Compares the request Origin with the configured origin or effective host. */
export function requestOriginIsAllowed(input: {
  expectedOrigin?: string;
  forwardedHost?: string;
  host?: string;
  origin?: string;
}): boolean {
  if (input.origin === undefined) return input.expectedOrigin === undefined;
  if (input.expectedOrigin !== undefined) {
    try {
      return new URL(input.origin).origin === input.expectedOrigin;
    } catch {
      return false;
    }
  }
  const expectedHost = input.forwardedHost?.split(',')[0]?.trim() ?? input.host;
  if (expectedHost === undefined) return false;
  try {
    return new URL(input.origin).host === expectedHost;
  } catch {
    return false;
  }
}
