/** Checks cookie parsing and one-way session-token hashing without a database. */
import { describe, expect, it } from 'vitest';

import { hashSessionToken, readSessionToken } from './authorization.js';

describe('collaboration session helpers', () => {
  it('reads the exact session cookie among other cookies', () => {
    expect(
      readSessionToken('theme=dark; chalkboard_session=opaque%20token; x=1'),
    ).toBe('opaque token');
    expect(readSessionToken('chalkboard_session_extra=nope')).toBeNull();
    expect(readSessionToken(undefined)).toBeNull();
  });

  it('hashes opaque tokens deterministically without retaining plaintext', () => {
    const first = hashSessionToken('secret-token');
    expect(first).toEqual(hashSessionToken('secret-token'));
    expect(first).not.toEqual(hashSessionToken('different-token'));
    expect(first.toString('utf8')).not.toContain('secret-token');
  });
});
