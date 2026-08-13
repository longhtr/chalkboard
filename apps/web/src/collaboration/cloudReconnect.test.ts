/** Locks reconnect delay progression, attempt timeout, and finite retry exhaustion. */
import { describe, expect, it } from 'vitest';

import {
  CLOUD_CONNECTION_ATTEMPT_TIMEOUT_MS,
  CLOUD_RECONNECT_DELAYS_MS,
  cloudReconnectDelay,
  MAX_CLOUD_RECONNECT_ATTEMPTS,
} from './cloudReconnect';

describe('cloud reconnect bounds', () => {
  it('uses a bounded increasing delay sequence', () => {
    expect(CLOUD_CONNECTION_ATTEMPT_TIMEOUT_MS).toBe(10_000);
    expect(CLOUD_RECONNECT_DELAYS_MS).toEqual([
      500, 1_000, 2_000, 4_000, 8_000,
    ]);
    expect(MAX_CLOUD_RECONNECT_ATTEMPTS).toBe(5);
  });

  it('accepts the final automatic retry and rejects the next attempt', () => {
    expect(cloudReconnectDelay(1)).toBe(500);
    expect(cloudReconnectDelay(MAX_CLOUD_RECONNECT_ATTEMPTS)).toBe(8_000);
    expect(cloudReconnectDelay(MAX_CLOUD_RECONNECT_ATTEMPTS + 1)).toBeNull();
    expect(cloudReconnectDelay(0)).toBeNull();
  });
});
