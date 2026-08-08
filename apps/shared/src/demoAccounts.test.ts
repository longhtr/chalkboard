import { describe, expect, it } from 'vitest';

import { DEMO_ACCOUNTS, isDemoAccountEmail } from './demoAccounts';

describe('demo accounts', () => {
  it('defines five unique non-deliverable public identities', () => {
    expect(DEMO_ACCOUNTS).toHaveLength(5);
    expect(new Set(DEMO_ACCOUNTS.map(({ email }) => email)).size).toBe(5);
    for (const account of DEMO_ACCOUNTS) {
      expect(account.email).toMatch(/@chalkboard\.invalid$/u);
      expect(account.password.length).toBeGreaterThanOrEqual(8);
    }
  });

  it('recognizes demo identities without case or surrounding whitespace', () => {
    expect(isDemoAccountEmail(' DEMO1@CHALKBOARD.INVALID ')).toBe(true);
    expect(isDemoAccountEmail('person@example.com')).toBe(false);
  });
});
