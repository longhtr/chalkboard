/**
 * Account identity and field limits shared by browser validation and server
 * admission. Shared constants prevent one runtime accepting data the other
 * cannot persist or return.
 */

/** Account identity returned by authenticated HTTP and session boundaries. */
export interface AccountUser {
  displayName: string;
  email: string;
  id: string;
  isDemo: boolean;
}

/** Maximum email length admitted by both UI and API validation. */
export const MAX_ACCOUNT_EMAIL_LENGTH = 320;
/** Maximum Unicode scalar length of an account display name. */
export const MAX_ACCOUNT_DISPLAY_NAME_LENGTH = 80;
/** Minimum password length admitted before password hashing. */
export const MIN_ACCOUNT_PASSWORD_LENGTH = 8;
/** Maximum password length admitted before password hashing. */
export const MAX_ACCOUNT_PASSWORD_LENGTH = 256;
