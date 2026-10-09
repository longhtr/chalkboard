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

/**
 * A board someone has offered to share, still awaiting the invitee's answer.
 *
 * This is the invitee's own view of the offer, so it names who sent it and
 * which board rather than who else can already see it. Nothing here grants
 * access: the membership is written only when the invitation is accepted.
 */
export interface BoardInvitation {
  boardId: string;
  invitedAt: string;
  invitedByDisplayName: string;
  role: Exclude<BoardRole, 'owner'>;
  title: string;
}

/**
 * One outstanding offer as the board's owner sees it.
 *
 * The invitee's own view names the board and who offered it, because those are
 * what they are deciding about. The owner already knows both and needs the
 * other half: who has not answered yet, so a pending offer can be told apart
 * from a declined one and withdrawn.
 */
export interface BoardPendingInvitation {
  displayName: string;
  email: string;
  invitedAt: string;
  role: Exclude<BoardRole, 'owner'>;
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
