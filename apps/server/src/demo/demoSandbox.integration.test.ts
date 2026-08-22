import { DEMO_ACCOUNTS } from '@chalkboard/shared';
import { resolve } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAssetService } from '../assets/service.js';
import { createBoardService } from '../boards/service.js';
import { createCollaborationPersistence } from '../collaboration/persistence.js';
import { runMigrations } from '../db/migrate.js';
import { seedDemoAccounts } from '../db/seedDemoAccounts.js';
import { StoragePolicyError } from '../storage/policyErrors.js';
import { requiredTestValue } from '../test/assertions.js';
import { createDemoSandboxService } from './demoSandbox.js';

const connectionString = process.env.TEST_DATABASE_URL;

interface UserRow {
  email: string;
  id: string;
  is_demo: boolean;
}

describe.skipIf(connectionString === undefined)('writable demo sandbox', () => {
  const adminPool = new Pool({ connectionString });
  const schema = `demo_sandbox_${crypto.randomUUID().replaceAll('-', '_')}`;
  const pool = new Pool({
    connectionString,
    options: `-c search_path=${schema}`,
  });
  const boards = createBoardService(pool);
  const assets = createAssetService(pool);
  const persistence = createCollaborationPersistence(pool);
  const sandbox = createDemoSandboxService(pool);

  async function demoUser(index: number): Promise<UserRow> {
    const account = requiredTestValue(DEMO_ACCOUNTS[index], `demo ${index}`);
    const result = await pool.query<UserRow>(
      'SELECT email, id, is_demo FROM users WHERE email_normalized = $1',
      [account.email],
    );
    return requiredTestValue(result.rows[0], `demo user ${index}`);
  }

  async function createNormalUser(label: string): Promise<UserRow> {
    const result = await pool.query<UserRow>(
      `INSERT INTO users (
         email, email_normalized, display_name, password_hash
       ) VALUES ($1, $1, $2, 'unused')
       RETURNING email, id, is_demo`,
      [`${label}-${crypto.randomUUID()}@example.com`, label],
    );
    return requiredTestValue(result.rows[0], `${label} user`);
  }

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    await runMigrations(pool, resolve(process.cwd(), 'migrations'));
    await seedDemoAccounts(pool);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM boards');
    await pool.query('DELETE FROM users WHERE NOT is_demo');
    await pool.query('DELETE FROM sessions');
    await pool.query(
      `UPDATE application_maintenance_state
       SET last_succeeded_at = NOW()
       WHERE name = 'demo-daily-reset'`,
    );
  });

  afterAll(async () => {
    await pool.end();
    await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
    await adminPool.end();
  });

  it('reports only aggregate reset health and current demo counts', async () => {
    const demo = await demoUser(0);
    await boards.create(demo.id, 'Aggregate diagnostic board');
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, decode(repeat('ab', 32), 'hex'), NOW() + INTERVAL '1 hour')`,
      [demo.id],
    );
    await pool.query(
      `UPDATE application_maintenance_state
       SET last_succeeded_at = $1
       WHERE name = 'demo-daily-reset'`,
      [new Date('2026-08-11T00:00:00.000Z')],
    );

    await expect(
      sandbox.status(new Date('2026-08-11T12:00:00.000Z')),
    ).resolves.toEqual({
      accountCount: 5,
      boardCount: 1,
      contentBytes: 0,
      healthy: true,
      lastSucceededAt: '2026-08-11T00:00:00.000Z',
      sessionCount: 1,
    });
    expect(
      (await sandbox.status(new Date('2026-08-12T00:00:00.000Z'))).healthy,
    ).toBe(false);
  });

  it('derives immutable partitions and rejects every mixed membership path', async () => {
    const firstDemo = await demoUser(0);
    const secondDemo = await demoUser(1);
    const normal = await createNormalUser('Normal');
    const demoBoard = await boards.create(firstDemo.id, 'Demo board');
    const normalBoard = await boards.create(normal.id, 'Normal board');

    const partitions = await pool.query<{ id: string; is_demo: boolean }>(
      'SELECT id, is_demo FROM boards ORDER BY id',
    );
    expect(partitions.rows).toEqual(
      expect.arrayContaining([
        { id: demoBoard.id, is_demo: true },
        { id: normalBoard.id, is_demo: false },
      ]),
    );

    expect(
      await boards.addMember(
        firstDemo.id,
        demoBoard.id,
        requiredTestValue(DEMO_ACCOUNTS[1], 'second demo').email,
        'editor',
      ),
    ).toMatchObject({ userId: secondDemo.id });
    expect(
      await boards.addMember(
        firstDemo.id,
        demoBoard.id,
        normal.email,
        'editor',
      ),
    ).toBeNull();

    const tokenHash = Buffer.from(crypto.randomUUID());
    await boards.createInviteLink(
      firstDemo.id,
      demoBoard.id,
      'editor',
      tokenHash,
      new Date(Date.now() + 30 * 24 * 60 * 60_000),
    );
    // Refused for who holds the link, which is reported apart from a token
    // that is unknown, expired, or revoked.
    await expect(
      boards.redeemInviteLink(normal.id, tokenHash),
    ).resolves.toEqual({ outcome: 'partition-mismatch' });
    await expect(
      boards.redeemInviteLink(secondDemo.id, tokenHash),
    ).resolves.toMatchObject({
      board: { id: demoBoard.id },
      outcome: 'redeemed',
    });

    // The mirrored direction is refused the same way.
    const normalTokenHash = Buffer.from(crypto.randomUUID());
    await boards.createInviteLink(
      normal.id,
      normalBoard.id,
      'editor',
      normalTokenHash,
      new Date(Date.now() + 30 * 24 * 60 * 60_000),
    );
    await expect(
      boards.redeemInviteLink(firstDemo.id, normalTokenHash),
    ).resolves.toEqual({ outcome: 'partition-mismatch' });

    await expect(
      boards.redeemInviteLink(normal.id, Buffer.from(crypto.randomUUID())),
    ).resolves.toEqual({ outcome: 'not-found' });

    await expect(
      pool.query(
        `INSERT INTO board_members (board_id, user_id, role)
         VALUES ($1, $2, 'viewer')`,
        [normalBoard.id, firstDemo.id],
      ),
    ).rejects.toMatchObject({ message: 'board_membership_partition_mismatch' });
    await expect(
      pool.query('UPDATE boards SET is_demo = FALSE WHERE id = $1', [
        demoBoard.id,
      ]),
    ).rejects.toMatchObject({ message: 'board_partition_is_immutable' });
  });

  it('serializes the three-board demo quota and counts trashed boards', async () => {
    const demo = await demoUser(0);
    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, (_, index) =>
        boards.create(demo.id, `Board ${index}`),
      ),
    );
    expect(
      attempts.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(3);
    const rejected = attempts.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({
        policyCode: 'demo_board_quota_exceeded',
      }),
    });

    const existing = await boards.list(demo.id);
    await boards.remove(
      demo.id,
      requiredTestValue(existing[0], 'demo board').id,
    );
    await expect(
      boards.create(demo.id, 'Still over quota'),
    ).rejects.toBeInstanceOf(StoragePolicyError);
    const usage = await pool.query<{ board_count: number }>(
      'SELECT board_count FROM user_storage_usage WHERE user_id = $1',
      [demo.id],
    );
    expect(requiredTestValue(usage.rows[0], 'demo usage').board_count).toBe(3);
  });

  it('deduplicates assets without double charging and enforces demo bytes', async () => {
    const demo = await demoUser(0);
    const board = await boards.create(demo.id, 'Assets');
    const oneMiB = Buffer.alloc(1_024 * 1_024, 1);
    const first = await assets.upload(demo.id, board.id, {
      content: oneMiB,
      height: 1,
      mediaType: 'image/png',
      name: 'one.png',
      width: 1,
    });
    const duplicate = await assets.upload(demo.id, board.id, {
      content: oneMiB,
      height: 1,
      mediaType: 'image/png',
      name: 'duplicate.png',
      width: 1,
    });
    expect(duplicate?.id).toBe(first?.id);

    for (let index = 2; index <= 10; index += 1) {
      await assets.upload(demo.id, board.id, {
        content: Buffer.alloc(1_024 * 1_024, index),
        height: 1,
        mediaType: 'image/png',
        name: `${index}.png`,
        width: 1,
      });
    }
    await expect(
      assets.upload(demo.id, board.id, {
        content: Buffer.alloc(1, 11),
        height: 1,
        mediaType: 'image/png',
        name: 'over.png',
        width: 1,
      }),
    ).rejects.toMatchObject({ policyCode: 'demo_asset_quota_exceeded' });

    const usage = await pool.query<{
      asset_bytes: string;
      asset_count: number;
    }>(
      'SELECT asset_count, asset_bytes FROM user_storage_usage WHERE user_id = $1',
      [demo.id],
    );
    expect(usage.rows).toEqual([
      { asset_bytes: String(10 * 1_024 * 1_024), asset_count: 10 },
    ]);
  });

  it('enforces demo Yjs bytes before persistence and replaces compacted usage', async () => {
    const demo = await demoUser(0);
    const board = await boards.create(demo.id, 'Yjs');
    const firstSequence = await persistence.appendUpdate(
      board.id,
      new Uint8Array(700_000),
    );
    await expect(
      persistence.appendUpdate(board.id, new Uint8Array(400_000)),
    ).rejects.toMatchObject({ policyCode: 'demo_yjs_quota_exceeded' });

    await persistence.compact(board.id, new Uint8Array(128), firstSequence);
    const usage = await pool.query<{
      yjs_snapshot_bytes: string;
      yjs_update_bytes: string;
    }>(
      `SELECT yjs_snapshot_bytes, yjs_update_bytes
       FROM board_storage_usage WHERE board_id = $1`,
      [board.id],
    );
    expect(usage.rows).toEqual([
      { yjs_snapshot_bytes: '128', yjs_update_bytes: '0' },
    ]);
    await expect(
      pool.query(
        'UPDATE yjs_documents SET is_demo = FALSE WHERE board_id = $1',
        [board.id],
      ),
    ).rejects.toMatchObject({ message: 'yjs_document_board_is_immutable' });
  });

  it('atomically resets only demo content and reconciles cascade ledgers', async () => {
    const demo = await demoUser(0);
    const normal = await createNormalUser('Retained');
    const demoBoard = await boards.create(demo.id, 'Disposable');
    const normalBoard = await boards.create(normal.id, 'Retained');
    const expiredTrash = await boards.create(normal.id, 'Expired trash');
    await pool.query(
      `UPDATE boards
       SET deleted_at = NOW() - INTERVAL '31 days'
       WHERE id = $1`,
      [expiredTrash.id],
    );
    await pool.query(
      `INSERT INTO board_invite_links (
         board_id, token_hash, role, created_by, expires_at, revoked_at
       ) VALUES (
         $1, $2, 'viewer', $3, NOW() + INTERVAL '1 day',
         NOW() - INTERVAL '31 days'
       )`,
      [normalBoard.id, Buffer.from(crypto.randomUUID()), normal.id],
    );
    await assets.upload(demo.id, demoBoard.id, {
      content: Buffer.from([1, 2, 3]),
      height: 1,
      mediaType: 'image/png',
      name: 'demo.png',
      width: 1,
    });
    await assets.upload(normal.id, normalBoard.id, {
      content: Buffer.from([4, 5, 6]),
      height: 1,
      mediaType: 'image/png',
      name: 'normal.png',
      width: 1,
    });
    await persistence.appendUpdate(demoBoard.id, new Uint8Array([1, 2, 3]));
    await persistence.appendUpdate(normalBoard.id, new Uint8Array([4, 5, 6]));
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 day'),
              ($3, $4, NOW() + INTERVAL '1 day')`,
      [
        demo.id,
        Buffer.from(crypto.randomUUID()),
        normal.id,
        Buffer.from(crypto.randomUUID()),
      ],
    );
    await pool.query(
      `UPDATE application_maintenance_state
       SET last_succeeded_at = NOW() - INTERVAL '1 day'
       WHERE name = 'demo-daily-reset'`,
    );

    const now = new Date();
    const reset = await sandbox.resetIfDue(now);
    expect(reset).toMatchObject({ deletedSessionCount: 1 });
    expect(reset?.boardIds).toEqual([demoBoard.id]);
    expect(reset?.userIds).toContain(demo.id);
    await expect(sandbox.resetIfDue(now)).resolves.toBeNull();

    const remainingBoards = await pool.query<{ id: string }>(
      'SELECT id FROM boards',
    );
    expect(remainingBoards.rows).toEqual([{ id: normalBoard.id }]);
    const remainingSessions = await pool.query<{ user_id: string }>(
      'SELECT user_id FROM sessions',
    );
    expect(remainingSessions.rows).toEqual([{ user_id: normal.id }]);
    const retainedInvites = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::INTEGER AS count FROM board_invite_links',
    );
    expect(retainedInvites.rows).toEqual([{ count: 0 }]);
    const aggregate = await pool.query<{
      demo_board_count: number;
      demo_content_bytes: string;
      normal_board_count: number;
      normal_content_bytes: string;
    }>(
      `SELECT normal_board_count, demo_board_count,
         normal_content_bytes, demo_content_bytes
       FROM application_storage_usage
       WHERE singleton`,
    );
    expect(aggregate.rows).toEqual([
      {
        demo_board_count: 0,
        demo_content_bytes: '0',
        normal_board_count: 1,
        normal_content_bytes: '6',
      },
    ]);
  });
});
