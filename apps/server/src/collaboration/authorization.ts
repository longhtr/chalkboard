/**
 * Authorizes collaboration upgrades from the same opaque sessions used by
 * HTTP. Raw session tokens are parsed at the boundary and hashed before any
 * database lookup so durable storage never depends on bearer-token plaintext.
 */
import { createHash } from 'node:crypto';

import type { BoardRole } from '@chalkboard/shared';
import type { Pool } from 'pg';

/** Authenticated identity and effective role admitted to one board. */
interface AuthorizedBoardAccess {
  isDemo: boolean;
  role: BoardRole;
  userId: string;
}

/** Resolves an opaque session and board identifier to current board authority. */
export interface CollaborationAuthorization {
  authorize(
    boardId: string,
    sessionToken: string,
  ): Promise<AuthorizedBoardAccess | BoardRole | null>;
}

/** Cookie key shared by HTTP authentication and WebSocket upgrades. */
export const SESSION_COOKIE_NAME = 'chalkboard_session';

/** Derives the fixed-size digest used for all durable session lookups. */
export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/** Parses and decodes the session cookie without accepting malformed encoding. */
export function readSessionToken(
  cookieHeader: string | undefined,
): string | null {
  if (cookieHeader === undefined) return null;
  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    const name = entry.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = entry.slice(separator + 1).trim();
    if (value.length === 0) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

/** Creates PostgreSQL-backed collaboration authorization with live revocation checks. */
export function createCollaborationAuthorization(
  pool: Pool,
): CollaborationAuthorization {
  return {
    async authorize(boardId, sessionToken) {
      const result = await pool.query<{
        is_demo: boolean;
        role: BoardRole;
        user_id: string;
      }>(
        `SELECT sessions.user_id, users.is_demo, CASE
           WHEN boards.owner_id = sessions.user_id THEN 'owner'
           ELSE board_members.role
         END AS role
         FROM sessions
         JOIN users ON users.id = sessions.user_id
         JOIN boards ON boards.id = $1 AND boards.deleted_at IS NULL
           AND boards.is_demo = users.is_demo
         LEFT JOIN board_members ON
           board_members.board_id = boards.id AND
           board_members.user_id = sessions.user_id
         WHERE sessions.token_hash = $2
           AND sessions.revoked_at IS NULL
           AND sessions.expires_at > NOW()
           AND (
             boards.owner_id = sessions.user_id OR
             board_members.role IS NOT NULL
           )
         LIMIT 1`,
        [boardId, hashSessionToken(sessionToken)],
      );
      const row = result.rows[0];
      return row === undefined
        ? null
        : { isDemo: row.is_demo, role: row.role, userId: row.user_id };
    },
  };
}
