/** Proves UUID creation with and without the secure-context convenience API. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { randomUuid } from './randomUuid';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const nativeRandomUuid = crypto.randomUUID;

afterEach(() => {
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: nativeRandomUuid,
  });
  vi.restoreAllMocks();
});

describe('randomUuid', () => {
  it('uses the native UUID API when available', () => {
    const expected = '123e4567-e89b-42d3-a456-426614174000';
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(expected);
    expect(randomUuid()).toBe(expected);
  });

  it('creates a version-4 UUID when randomUUID is unavailable', () => {
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    });
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      const bytes = array as Uint8Array;
      bytes.set([
        0x12, 0x3e, 0x45, 0x67, 0xe8, 0x9b, 0x02, 0xd3, 0x24, 0x56, 0x42, 0x66,
        0x14, 0x17, 0x40, 0x00,
      ]);
      return array;
    });

    expect(randomUuid()).toMatch(UUID_PATTERN);
    expect(randomUuid()).toBe('123e4567-e89b-42d3-a456-426614174000');
  });
});
