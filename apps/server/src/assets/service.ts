/**
 * PostgreSQL repository for immutable board images. Every read and write joins
 * through board membership, making authorization part of the query rather than
 * a caller-provided precondition.
 */
import { createHash } from 'node:crypto';

import type { Pool } from 'pg';

import { translateStoragePolicyError } from '../storage/policyErrors.js';
import type { ValidatedAsset } from './validation.js';

interface BoardAssetSummary {
  boardId: string;
  byteSize: number;
  createdAt: string;
  height: number;
  id: string;
  mediaType: string;
  name: string;
  width: number;
}

interface BoardAsset extends BoardAssetSummary {
  content: Buffer;
}

/** Authorized immutable-image reads and deduplicating uploads. */
export interface AssetService {
  get(
    userId: string,
    boardId: string,
    assetId: string,
  ): Promise<BoardAsset | null>;
  upload(
    userId: string,
    boardId: string,
    asset: ValidatedAsset,
  ): Promise<BoardAssetSummary | null>;
}

interface AssetRow {
  board_id: string;
  byte_size: number;
  content?: Buffer;
  created_at: Date;
  height: number;
  id: string;
  media_type: string;
  name: string;
  width: number;
}

function summary(row: AssetRow): BoardAssetSummary {
  return {
    boardId: row.board_id,
    byteSize: row.byte_size,
    createdAt: row.created_at.toISOString(),
    height: row.height,
    id: row.id,
    mediaType: row.media_type,
    name: row.name,
    width: row.width,
  };
}

/** Creates the board-membership-scoped PostgreSQL asset repository. */
export function createAssetService(pool: Pool): AssetService {
  return {
    async upload(userId, boardId, asset) {
      const digest = createHash('sha256').update(asset.content).digest();
      try {
        const result = await pool.query<AssetRow>(
          `INSERT INTO board_assets (
             board_id, uploaded_by, name, media_type, byte_size,
             width, height, content_hash, content
           )
           SELECT boards.id, $1, $3, $4, $5, $6, $7, $8, $9
           FROM boards
           JOIN board_members ON board_members.board_id = boards.id
             AND board_members.user_id = $1
           WHERE boards.id = $2 AND boards.deleted_at IS NULL
             AND board_members.role IN ('owner', 'editor')
           ON CONFLICT (board_id, content_hash) DO NOTHING
           RETURNING id, board_id, name, media_type, byte_size,
             width, height, created_at`,
          [
            userId,
            boardId,
            asset.name,
            asset.mediaType,
            asset.content.length,
            asset.width,
            asset.height,
            digest,
            asset.content,
          ],
        );
        const inserted = result.rows[0];
        if (inserted !== undefined) return summary(inserted);
        const existing = await pool.query<AssetRow>(
          `SELECT board_assets.id, board_assets.board_id, board_assets.name,
             board_assets.media_type, board_assets.byte_size,
             board_assets.width, board_assets.height, board_assets.created_at
           FROM board_assets
           JOIN boards ON boards.id = board_assets.board_id
             AND boards.deleted_at IS NULL
           JOIN board_members ON board_members.board_id = boards.id
             AND board_members.user_id = $1
             AND board_members.role IN ('owner', 'editor')
           WHERE board_assets.board_id = $2
             AND board_assets.content_hash = $3`,
          [userId, boardId, digest],
        );
        return existing.rows[0] === undefined
          ? null
          : summary(existing.rows[0]);
      } catch (error) {
        translateStoragePolicyError(error);
      }
    },

    async get(userId, boardId, assetId) {
      const result = await pool.query<AssetRow>(
        `SELECT board_assets.id, board_assets.board_id, board_assets.name,
           board_assets.media_type, board_assets.byte_size, board_assets.width,
           board_assets.height, board_assets.content, board_assets.created_at
         FROM board_assets
         JOIN boards ON boards.id = board_assets.board_id
           AND boards.deleted_at IS NULL
         JOIN board_members ON board_members.board_id = boards.id
           AND board_members.user_id = $1
         WHERE board_assets.board_id = $2 AND board_assets.id = $3`,
        [userId, boardId, assetId],
      );
      const row = result.rows[0];
      if (row === undefined || row.content === undefined) return null;
      return { ...summary(row), content: row.content };
    },
  };
}
