/** Proves origin normalization, trusted-proxy handling, cookie parsing, and finite-window rate limiting. */
import { describe, expect, it, vi } from 'vitest';

import { createRateLimiter, requestOriginIsAllowed } from './security.js';

describe('authentication request security', () => {
  it('bounds attempts by key and resets the window', () => {
    vi.useFakeTimers();
    try {
      const limit = createRateLimiter({ limit: 2, windowMs: 60_000 });
      expect(limit('login:client').allowed).toBe(true);
      expect(limit('login:client').allowed).toBe(true);
      expect(limit('login:client')).toMatchObject({
        allowed: false,
        retryAfterSeconds: 60,
      });
      expect(limit('login:other').allowed).toBe(true);

      vi.advanceTimersByTime(60_000);
      expect(limit('login:client').allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts dormant keys rather than one under active limiting', () => {
    // A flood of distinct keys must not be able to push an attacker's own
    // limited key out of the table, which would reset their count for free.
    const limit = createRateLimiter({ limit: 2, windowMs: 60_000 });
    limit('attacker');
    limit('attacker');
    let everAllowedAgain = false;

    for (let index = 0; index < 10_100; index += 1) {
      limit(`flood:${index}`);
      if (limit('attacker').allowed) everAllowedAgain = true;
    }

    expect(everAllowedAgain).toBe(false);
  });

  it('requires a pinned production origin and rejects cross-site origins', () => {
    expect(requestOriginIsAllowed({ host: 'chalkboard.test' })).toBe(true);
    expect(
      requestOriginIsAllowed({
        expectedOrigin: 'https://chalkboard.test',
        host: 'internal:3000',
      }),
    ).toBe(false);
    expect(
      requestOriginIsAllowed({
        host: 'chalkboard.test',
        origin: 'https://chalkboard.test',
      }),
    ).toBe(true);
    expect(
      requestOriginIsAllowed({
        forwardedHost: 'chalkboard.test',
        host: 'server:3000',
        origin: 'https://chalkboard.test',
      }),
    ).toBe(true);
    expect(
      requestOriginIsAllowed({
        expectedOrigin: 'https://chalkboard.test',
        host: 'internal:3000',
        origin: 'https://chalkboard.test',
      }),
    ).toBe(true);
    expect(
      requestOriginIsAllowed({
        expectedOrigin: 'https://chalkboard.test',
        host: 'chalkboard.test',
        origin: 'http://chalkboard.test',
      }),
    ).toBe(false);
    expect(
      requestOriginIsAllowed({
        host: 'chalkboard.test',
        origin: 'https://other.test',
      }),
    ).toBe(false);
    expect(
      requestOriginIsAllowed({ host: 'chalkboard.test', origin: 'not a url' }),
    ).toBe(false);
  });
});
