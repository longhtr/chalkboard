/** Proves canonical HMAC subjects, generation separation, and immutable capacity/key bounds without PostgreSQL. */
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  canonicalClientIp,
  createEmailSecurityService,
} from './emailSecurity.js';

const unusedPool = {} as Pool;

function service(generation = 1) {
  return createEmailSecurityService(unusedPool, {
    generation,
    value: Buffer.alloc(32, 7),
  });
}

describe('email security primitives', () => {
  it('canonicalizes equivalent IPv6 and IPv4-mapped client addresses', () => {
    expect(canonicalClientIp('2001:0DB8:0:0:0:0:0:1')).toBe('2001:db8::1');
    expect(canonicalClientIp('2001:db8::1')).toBe('2001:db8::1');
    expect(canonicalClientIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(canonicalClientIp('::FFFF:c000:0201')).toBe('192.0.2.1');
    expect(() => canonicalClientIp('not-an-address')).toThrow(
      'Invalid client address',
    );
  });

  it('normalizes destinations and separates compromised-key generations', () => {
    const first = service(1).digestDestination(' Person@Example.COM ');
    const normalized = service(1).digestDestination('person@example.com');
    const nextGeneration = service(2).digestDestination('person@example.com');
    expect(first).toEqual(normalized);
    expect(nextGeneration.keyGeneration).toBe(2);
    expect(nextGeneration.value).toBe(first.value);
    expect(nextGeneration).not.toEqual(first);
  });

  it('rejects weak keys, invalid generations, and capacity above hard caps', () => {
    expect(() =>
      createEmailSecurityService(unusedPool, {
        generation: 0,
        value: Buffer.alloc(32),
      }),
    ).toThrow('generation');
    expect(() =>
      createEmailSecurityService(unusedPool, {
        generation: 1,
        value: Buffer.alloc(31),
      }),
    ).toThrow('at least 32 bytes');
    expect(() =>
      createEmailSecurityService(
        unusedPool,
        { generation: 1, value: Buffer.alloc(32) },
        { capacityLimits: { daily: 81, monthly: 2_400 } },
      ),
    ).toThrow('hard cap');
    expect(() =>
      createEmailSecurityService(
        unusedPool,
        { generation: 1, value: Buffer.alloc(32) },
        { testLimitMultiplier: 101 },
      ),
    ).toThrow('test-only');
  });
});
