/**
 * Reconnect policy for one cloud socket generation. Delay grows after failed
 * online attempts and returns `null` once explicit user retry is required.
 */
/** Maximum time allowed for one WebSocket generation to open and synchronize. */
export const CLOUD_CONNECTION_ATTEMPT_TIMEOUT_MS = 10_000;
/** Delay before each bounded automatic reconnect attempt. */
export const CLOUD_RECONNECT_DELAYS_MS = [
  500, 1_000, 2_000, 4_000, 8_000,
] as const;
/** Number of automatic attempts before explicit user retry is required. */
export const MAX_CLOUD_RECONNECT_ATTEMPTS = CLOUD_RECONNECT_DELAYS_MS.length;

/** Returns the one-based attempt delay, or null outside the automatic policy. */
export function cloudReconnectDelay(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1) return null;
  return CLOUD_RECONNECT_DELAYS_MS[attempt - 1] ?? null;
}
