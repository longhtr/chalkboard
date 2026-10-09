/**
 * Display shape of the emailed verification code. Every code entry point
 * formats through here so what the user types cannot drift from the
 * `0000-0000` form the server emails and validates.
 */
export function formatCode(value: string): string {
  const digits = value.replace(/\D/gu, '').slice(0, 8);
  return digits.length <= 4
    ? digits
    : `${digits.slice(0, 4)}-${digits.slice(4)}`;
}
