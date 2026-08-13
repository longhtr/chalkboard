/**
 * Board access projections and title rules shared by browser and server. These
 * declarations describe authorization data, not client-side authority.
 */

/** Board authority shared by REST projections and collaboration admission. */
export type BoardRole = 'owner' | 'editor' | 'viewer';

/** Public member projection returned to authorized board participants. */
export interface BoardMember {
  displayName: string;
  email: string;
  role: BoardRole;
  userId: string;
}

/** Revocable invitation metadata; the secret redemption token is separate. */
export interface BoardInviteLink {
  expiresAt: string;
  id: string;
  role: Exclude<BoardRole, 'owner'>;
}

/** Minimal board projection retained while reversible deletion is active. */
export interface TrashedBoardSummary {
  deletedAt: string;
  id: string;
  title: string;
}

/** Maximum Unicode scalar values accepted in a persisted board title. */
export const MAX_BOARD_TITLE_LENGTH = 160;

/** Counts Unicode scalar values rather than UTF-16 code units. */
export function unicodeScalarLength(value: string): number {
  return Array.from(value).length;
}

/** Truncates without splitting a surrogate pair. */
export function truncateBoardTitle(title: string): string {
  return Array.from(title).slice(0, MAX_BOARD_TITLE_LENGTH).join('');
}
