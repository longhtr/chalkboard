/** Creates the human-readable eight-digit code placed in verification email subjects. */
import { randomInt } from 'node:crypto';

/** Uses an injected test code or returns a cryptographically random `0000-0000`-shaped code. */
export function createVerificationCode(fixed: string | null): string {
  if (fixed !== null) return fixed;
  const digits = String(randomInt(10_000_000, 100_000_000));
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}
