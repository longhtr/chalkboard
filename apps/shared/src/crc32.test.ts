/** Checks standard CRC-32 vectors, ranged checksums, and invalid byte-range rejection. */
import { describe, expect, it } from 'vitest';

import { crc32 } from './crc32';

describe('crc32', () => {
  it('matches the standard vector and supports a bounded byte range', () => {
    const bytes = new TextEncoder().encode('--123456789--');
    expect(crc32(bytes, 2, bytes.length - 2)).toBe(0xcbf43926);
  });

  it('rejects ranges outside the supplied bytes', () => {
    expect(() => crc32(new Uint8Array(1), 0, 2)).toThrow(RangeError);
  });
});
