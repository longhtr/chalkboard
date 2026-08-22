/**
 * PostgreSQL authority for boards, roles, members, invitations, and trash.
 * Methods include the acting user in their query and return null/false when the
 * required board state or authority does not exist.
 */
import type {
  BoardInviteLink as SharedBoardInviteLink,
  BoardMember as SharedBoardMember,
  BoardRole,
  TrashedBoardSummary,
} from '@chalkboard/shared';
import type { Pool } from 'pg';

import { rollbackPreservingFailure } from '../db/transactionFailure.js';
import { translateStoragePolicyError } from '../storage/policyErrors.js';

interface BoardSummary {
  id: string;
  title: string;
  role: BoardRole;
  createdAt: string;
  updatedAt: string;
}

/** Server-local alias of invitation metadata shared with authorized clients. */
export type BoardInviteLink = SharedBoardInviteLink;
/** Server-local alias of the member projection shared with authorized clients. */
export type BoardMember = SharedBoardMember;

/**
 * PostgreSQL authority for board ownership, membership, trash, and invitations.
 * A null or false result means the acting user lacked the required authority or
 * the board no longer existed in the required state.
 */
export interface BoardService {
  addMember(
    ownerId: string,
    boardId: string,
    email: string,
    role: 'editor' | 'viewer',
  ): Promise<BoardMember | null>;
  create(userId: string, title: string): Promise<BoardSummary>;
  createInviteLink(
    ownerId: string,
    boardId: string,
    role: 'editor' | 'viewer',
    tokenHash: Buffer,
    expiresAt: Date,
  ): Promise<BoardInviteLink | null>;
  get(userId: string, boardId: string): Promise<BoardSummary | null>;
  list(userId: string): Promise<BoardSummary[]>;
  listTrash(userId: string): Promise<TrashedBoardSummary[]>;
  deleteAllPermanently(userId: string): Promise<string[]>;
  restoreAll(userId: string): Promise<string[]>;
  listInviteLinks(
    ownerId: string,
    boardId: string,
  ): Promise<BoardInviteLink[] | null>;
  listMembers(ownerId: string, boardId: string): Promise<BoardMember[] | null>;
  deletePermanently(userId: string, boardId: string): Promise<boolean>;
  remove(userId: string, boardId: string): Promise<boolean>;
  removeMember(
    ownerId: string,
    boardId: string,
    memberId: string,
  ): Promise<boolean>;
  redeemInviteLink(
    userId: string,
    tokenHash: Buffer,
  ): Promise<InviteRedemption>;
  restore(userId: string, boardId: string): Promise<boolean>;
  rename(
    userId: string,
    boardId: string,
    title: string,
  ): Promise<BoardSummary | null>;
  revokeInviteLink(
    ownerId: string,
    boardId: string,
    inviteId: string,
  ): Promise<boolean>;
  updateMember(
    ownerId: string,
    boardId: string,
    memberId: string,
    role: 'editor' | 'viewer',
  ): Promise<BoardMember | null>;
}

interface BoardRow {
  id: string;
  title: string;
  role: BoardRole;
  created_at: Date;
  updated_at: Date;
}

/**
 * Redemption outcomes a caller can tell apart. A demo account and a normal
 * account cannot join each other's boards, and that refusal is not the same as
 * a token that is unknown, expired, or revoked — telling the reader otherwise
 * describes their valid link as broken.
 */
export type InviteRedemption =
  | { board: BoardSummary; outcome: 'redeemed' }
  | { outcome: 'partition-mismatch' }
  | { outcome: 'not-found' };

/** Always one row for a live invite, with a null role when joining was refused. */
interface InviteRedemptionRow {
  id: string;
  title: string;
  role: BoardRole | null;
  created_at: Date;
  updated_at: Date;
}

interface TrashedBoardRow {
  deleted_at: Date;
  id: string;
  title: string;
}

interface InviteRow {
  expires_at: Date | null;
  id: string | null;
  role: 'editor' | 'viewer' | null;
}

interface MemberRow {
  display_name: string;
  email: string;
  role: BoardRole;
  user_id: string;
}

function toSummary(row: BoardRow): BoardSummary {
  return {
    id: row.id,
    title: row.title,
    role: row.role,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toTrashedSummary(row: TrashedBoardRow): TrashedBoardSummary {
  return {
    deletedAt: row.deleted_at.toISOString(),
    id: row.id,
    title: row.title,
  };
}

function toInvite(row: InviteRow): BoardInviteLink | null {
  if (row.id === null || row.role === null || row.expires_at === null) {
    return null;
  }
  return {
    expiresAt: row.expires_at.toISOString(),
    id: row.id,
    role: row.role,
  };
}

function toMember(row: MemberRow): BoardMember {
  return {
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    userId: row.user_id,
  };
}

// Every ordinary board read derives the role from ownership or current
// membership while excluding trashed boards.
const ACCESS_SELECT = `
  SELECT boards.id, boards.title, boards.created_at, boards.updated_at,
    CASE WHEN boards.owner_id = $1 THEN 'owner' ELSE board_members.role END AS role
  FROM boards
  LEFT JOIN board_members ON board_members.board_id = boards.id AND board_members.user_id = $1
  WHERE boards.deleted_at IS NULL
    AND (boards.owner_id = $1 OR board_members.role IS NOT NULL)`;

/** Builds the board authority over one shared PostgreSQL connection pool. */
export function createBoardService(pool: Pool): BoardService {
  return {
    async list(userId) {
      const result = await pool.query<BoardRow>(
        `${ACCESS_SELECT} ORDER BY boards.updated_at DESC`,
        [userId],
      );
      return result.rows.map(toSummary);
    },

    async listTrash(userId) {
      const result = await pool.query<TrashedBoardRow>(
        `SELECT id, title, deleted_at FROM boards
         WHERE owner_id = $1 AND deleted_at IS NOT NULL
         ORDER BY deleted_at DESC`,
        [userId],
      );
      return result.rows.map(toTrashedSummary);
    },

    async restoreAll(userId) {
      const result = await pool.query<{ id: string }>(
        `UPDATE boards SET deleted_at = NULL, updated_at = NOW()
         WHERE owner_id = $1 AND deleted_at IS NOT NULL
         RETURNING id`,
        [userId],
      );
      return result.rows.map(({ id }) => id);
    },

    async deleteAllPermanently(userId) {
      const result = await pool.query<{ id: string }>(
        `DELETE FROM boards
         WHERE owner_id = $1 AND deleted_at IS NOT NULL
         RETURNING id`,
        [userId],
      );
      return result.rows.map(({ id }) => id);
    },

    // Board and owner membership are one transaction; neither may exist alone.
    async create(userId, title) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query<BoardRow>(
          `INSERT INTO boards (title, owner_id) VALUES ($1, $2)
           RETURNING id, title, 'owner'::text AS role, created_at, updated_at`,
          [title.trim(), userId],
        );
        const board = result.rows[0];
        if (board === undefined) {
          throw new Error('Board insertion returned no board');
        }
        await client.query(
          `INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, 'owner')`,
          [board.id, userId],
        );
        await client.query('COMMIT');
        return toSummary(board);
      } catch (error) {
        translateStoragePolicyError(
          await rollbackPreservingFailure(client, error),
        );
      } finally {
        client.release();
      }
    },

    // One active token per role avoids ambiguous links while preserving the
    // other role's independently revocable access.
    async createInviteLink(ownerId, boardId, role, tokenHash, expiresAt) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const authorized = await client.query<{ is_demo: boolean }>(
          `SELECT is_demo FROM boards
           WHERE id = $2 AND owner_id = $1 AND deleted_at IS NULL
           FOR UPDATE`,
          [ownerId, boardId],
        );
        const ownerBoard = authorized.rows[0];
        if (ownerBoard === undefined) {
          await client.query('COMMIT');
          return null;
        }
        const effectiveExpiry = ownerBoard.is_demo
          ? new Date(Math.min(expiresAt.getTime(), Date.now() + 60 * 60_000))
          : expiresAt;
        await client.query(
          `UPDATE board_invite_links SET revoked_at = NOW()
           WHERE board_id = $1 AND role = $2 AND revoked_at IS NULL`,
          [boardId, role],
        );
        await client.query(
          `DELETE FROM board_invite_links
           WHERE board_id = $1
             AND (revoked_at IS NOT NULL OR expires_at <= NOW())`,
          [boardId],
        );
        const result = await client.query<InviteRow>(
          `INSERT INTO board_invite_links
             (board_id, token_hash, role, created_by, expires_at)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, role, expires_at`,
          [boardId, tokenHash, role, ownerId, effectiveExpiry],
        );
        const invite = result.rows[0];
        if (invite === undefined) {
          throw new Error('Invitation insertion returned no link');
        }
        await client.query('COMMIT');
        return toInvite(invite);
      } catch (error) {
        throw await rollbackPreservingFailure(client, error);
      } finally {
        client.release();
      }
    },

    async get(userId, boardId) {
      const result = await pool.query<BoardRow>(
        `${ACCESS_SELECT} AND boards.id = $2`,
        [userId, boardId],
      );
      return result.rows[0] === undefined ? null : toSummary(result.rows[0]);
    },

    async rename(userId, boardId, title) {
      const result = await pool.query<BoardRow>(
        `UPDATE boards SET title = $3, updated_at = NOW()
         FROM board_members
         WHERE boards.id = $2 AND boards.deleted_at IS NULL
           AND board_members.board_id = boards.id AND board_members.user_id = $1
           AND board_members.role IN ('owner', 'editor')
         RETURNING boards.id, boards.title, board_members.role, boards.created_at, boards.updated_at`,
        [userId, boardId, title.trim()],
      );
      return result.rows[0] === undefined ? null : toSummary(result.rows[0]);
    },

    async remove(userId, boardId) {
      const result = await pool.query(
        `UPDATE boards SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [boardId, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async restore(userId, boardId) {
      const result = await pool.query(
        `UPDATE boards SET deleted_at = NULL, updated_at = NOW()
         WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL
         RETURNING id`,
        [boardId, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async deletePermanently(userId, boardId) {
      const result = await pool.query(
        `DELETE FROM boards
         WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL
         RETURNING id`,
        [boardId, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async listInviteLinks(ownerId, boardId) {
      const result = await pool.query<InviteRow>(
        `SELECT board_invite_links.id, board_invite_links.role,
           board_invite_links.expires_at
         FROM boards
         LEFT JOIN board_invite_links
           ON board_invite_links.board_id = boards.id
           AND board_invite_links.revoked_at IS NULL
           AND board_invite_links.expires_at > NOW()
         WHERE boards.id = $2 AND boards.owner_id = $1
           AND boards.deleted_at IS NULL
         ORDER BY board_invite_links.role`,
        [ownerId, boardId],
      );
      if (result.rows.length === 0) return null;
      return result.rows.flatMap((row) => {
        const invite = toInvite(row);
        return invite === null ? [] : [invite];
      });
    },

    async listMembers(ownerId, boardId) {
      const result = await pool.query<MemberRow>(
        `SELECT users.id AS user_id, users.email, users.display_name, board_members.role
         FROM boards
         JOIN board_members ON board_members.board_id = boards.id
         JOIN users ON users.id = board_members.user_id
         WHERE boards.id = $1 AND boards.owner_id = $2 AND boards.deleted_at IS NULL
         ORDER BY CASE board_members.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,
           users.display_name`,
        [boardId, ownerId],
      );
      if (result.rows.length === 0) return null;
      return result.rows.map(toMember);
    },

    async addMember(ownerId, boardId, email, role) {
      const result = await pool.query<MemberRow>(
        `INSERT INTO board_members (board_id, user_id, role)
         SELECT boards.id, users.id, $4
         FROM boards
         JOIN users ON users.email_normalized = $3
         WHERE boards.id = $2 AND boards.owner_id = $1
           AND boards.deleted_at IS NULL AND users.id <> boards.owner_id
           AND users.is_demo = boards.is_demo
         ON CONFLICT (board_id, user_id) DO UPDATE SET role = EXCLUDED.role
         RETURNING user_id,
           (SELECT email FROM users WHERE id = user_id) AS email,
           (SELECT display_name FROM users WHERE id = user_id) AS display_name,
           role`,
        [ownerId, boardId, email.trim().toLocaleLowerCase('en-US'), role],
      );
      return result.rows[0] === undefined ? null : toMember(result.rows[0]);
    },

    // Redemption never lowers an existing role and never changes the owner.
    async redeemInviteLink(userId, tokenHash) {
      const result = await pool.query<InviteRedemptionRow>(
        `WITH invite AS MATERIALIZED (
           SELECT board_invite_links.board_id, board_invite_links.role,
             boards.is_demo
           FROM board_invite_links
           JOIN boards ON boards.id = board_invite_links.board_id
           WHERE board_invite_links.token_hash = $2
             AND board_invite_links.revoked_at IS NULL
             AND board_invite_links.expires_at > NOW()
             AND boards.deleted_at IS NULL
           FOR UPDATE OF board_invite_links
         ), membership AS (
           INSERT INTO board_members (board_id, user_id, role)
           SELECT invite.board_id, $1, invite.role FROM invite
           JOIN boards ON boards.id = invite.board_id
           JOIN users ON users.id = $1 AND users.is_demo = invite.is_demo
           WHERE boards.owner_id <> $1
           ON CONFLICT (board_id, user_id) DO UPDATE SET role =
             CASE
               WHEN board_members.role = 'owner' THEN 'owner'
               WHEN board_members.role = 'editor' OR EXCLUDED.role = 'editor'
                 THEN 'editor'
               ELSE 'viewer'
             END
           RETURNING board_id, role
         )
         SELECT boards.id, boards.title, boards.created_at, boards.updated_at,
           CASE WHEN boards.owner_id = $1 THEN 'owner'
             ELSE membership.role END AS role
         FROM invite
         JOIN boards ON boards.id = invite.board_id
         LEFT JOIN membership ON membership.board_id = boards.id`,
        [userId, tokenHash],
      );
      const row = result.rows[0];
      if (row === undefined) return { outcome: 'not-found' };
      // A live invite that produced no membership and no ownership was refused
      // by the demo/normal partition join, which is the only remaining reason.
      if (row.role === null) return { outcome: 'partition-mismatch' };
      return {
        board: toSummary({ ...row, role: row.role }),
        outcome: 'redeemed',
      };
    },

    async revokeInviteLink(ownerId, boardId, inviteId) {
      const result = await pool.query(
        `UPDATE board_invite_links SET revoked_at = NOW()
         FROM boards
         WHERE board_invite_links.id = $3
           AND board_invite_links.board_id = $2
           AND board_invite_links.revoked_at IS NULL
           AND boards.id = board_invite_links.board_id
           AND boards.owner_id = $1 AND boards.deleted_at IS NULL
         RETURNING board_invite_links.id`,
        [ownerId, boardId, inviteId],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async updateMember(ownerId, boardId, memberId, role) {
      const result = await pool.query<MemberRow>(
        `UPDATE board_members SET role = $4
         FROM boards, users
         WHERE board_members.board_id = $2 AND board_members.user_id = $3
           AND board_members.role <> 'owner' AND boards.id = board_members.board_id
           AND boards.owner_id = $1 AND boards.deleted_at IS NULL
           AND users.id = board_members.user_id
         RETURNING board_members.user_id, users.email, users.display_name, board_members.role`,
        [ownerId, boardId, memberId, role],
      );
      return result.rows[0] === undefined ? null : toMember(result.rows[0]);
    },

    async removeMember(ownerId, boardId, memberId) {
      const result = await pool.query(
        `DELETE FROM board_members USING boards
         WHERE board_members.board_id = $2 AND board_members.user_id = $3
           AND board_members.role <> 'owner' AND boards.id = board_members.board_id
           AND boards.owner_id = $1 AND boards.deleted_at IS NULL
         RETURNING board_members.user_id`,
        [ownerId, boardId, memberId],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}
