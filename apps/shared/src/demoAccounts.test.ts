/**
 * The five public demo identities are a published contract: the browser shows
 * them and the seed job recreates them, so both must read the same list, and
 * the addresses must stay undeliverable.
 */
import { describe, expect, it } from 'vitest';

import { DEMO_ACCOUNTS } from './demoAccounts';

describe('demo accounts', () => {
  it('defines five unique non-deliverable public identities', () => {
    expect(DEMO_ACCOUNTS).toHaveLength(5);
    expect(new Set(DEMO_ACCOUNTS.map(({ email }) => email)).size).toBe(5);
    for (const account of DEMO_ACCOUNTS) {
      expect(account.email).toMatch(/@chalkboard\.invalid$/u);
      expect(account.password.length).toBeGreaterThanOrEqual(8);
    }
  });
});
