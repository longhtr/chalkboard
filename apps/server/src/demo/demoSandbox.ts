/**
 * Daily reset and health reporting for the five public demo accounts.
 *
 * Demo boards are shared and writable by anyone, so their content is wiped once
 * a day rather than kept. The reset takes a lock under one name so that only
 * one server performs it, and it retries on a fixed interval if it fails, since
 * a missed reset leaves yesterday's content visible to everyone.
 */
import type { Pool } from 'pg';

import { rollbackPreservingFailure } from '../db/transactionFailure.js';

const RESET_NAME = 'demo-daily-reset';
const RESET_RETRY_INTERVAL_MS = 5 * 60_000;

export interface DemoSandboxReset {
  boardIds: string[];
  deletedSessionCount: number;
  succeededAt: string;
  userIds: string[];
}

export interface DemoSandboxStatus {
  accountCount: number;
  boardCount: number;
  contentBytes: number;
  healthy: boolean;
  lastSucceededAt: string;
  sessionCount: number;
}

export interface DemoSandboxService {
  resetIfDue(now?: Date): Promise<DemoSandboxReset | null>;
  status(now?: Date): Promise<DemoSandboxStatus>;
}

interface MaintenanceRow {
  last_succeeded_at: Date;
}

interface MaintenanceStatusRow extends MaintenanceRow {
  account_count: number;
  board_count: number;
  content_bytes: string;
  session_count: number;
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** PostgreSQL authority for exact-scope demo cleanup and its durable schedule. */
export function createDemoSandboxService(pool: Pool): DemoSandboxService {
  return {
    async resetIfDue(now = new Date()) {
      if (!Number.isFinite(now.getTime()))
        throw new Error('Invalid reset time');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          ['chalkboard:demo-daily-reset'],
        );
        const state = await client.query<MaintenanceRow>(
          `SELECT last_succeeded_at
           FROM application_maintenance_state
           WHERE name = $1
           FOR UPDATE`,
          [RESET_NAME],
        );
        const marker = state.rows[0];
        if (marker === undefined) {
          throw new Error('Demo reset maintenance marker is missing');
        }
        if (utcDay(marker.last_succeeded_at) >= utcDay(now)) {
          await client.query('COMMIT');
          return null;
        }

        // Every retention delete has a fixed batch bound. Large backlogs are
        // drained over daily runs without turning maintenance into one
        // unbounded transaction.
        await client.query(
          `DELETE FROM sessions WHERE ctid IN (
             SELECT ctid FROM sessions
             WHERE expires_at <= NOW() ORDER BY expires_at LIMIT 500
           )`,
        );
        await client.query(
          `DELETE FROM pending_registrations WHERE ctid IN (
             SELECT ctid FROM pending_registrations
             WHERE expires_at <= NOW() ORDER BY expires_at LIMIT 250
           )`,
        );
        await client.query(
          `DELETE FROM pending_email_changes WHERE ctid IN (
             SELECT ctid FROM pending_email_changes
             WHERE expires_at <= NOW() ORDER BY expires_at LIMIT 250
           )`,
        );
        await client.query(
          `DELETE FROM pending_password_resets WHERE ctid IN (
             SELECT ctid FROM pending_password_resets
             WHERE expires_at <= NOW() ORDER BY expires_at LIMIT 250
           )`,
        );
        await client.query(
          `DELETE FROM board_invite_links WHERE ctid IN (
             SELECT ctid FROM board_invite_links
             WHERE expires_at <= NOW()
                OR (revoked_at IS NOT NULL
                    AND revoked_at <= NOW() - INTERVAL '30 days')
             ORDER BY COALESCE(revoked_at, expires_at) LIMIT 250
           )`,
        );
        await client.query(
          `DELETE FROM boards WHERE ctid IN (
             SELECT ctid FROM boards
             WHERE deleted_at <= NOW() - INTERVAL '30 days'
             ORDER BY deleted_at LIMIT 25
           )`,
        );

        const users = await client.query<{ id: string }>(
          'SELECT id FROM users WHERE is_demo ORDER BY id FOR UPDATE',
        );
        const boards = await client.query<{ id: string }>(
          `DELETE FROM boards
           WHERE is_demo
           RETURNING id`,
        );
        const sessions = await client.query(
          `DELETE FROM sessions
           USING users
           WHERE sessions.user_id = users.id AND users.is_demo`,
        );

        const userUsage = await client.query<{
          asset_bytes: string;
          asset_count: number;
          board_count: number;
        }>(
          `SELECT usage.board_count, usage.asset_count, usage.asset_bytes
           FROM user_storage_usage AS usage
           JOIN users ON users.id = usage.user_id
           WHERE users.is_demo
             AND (usage.board_count <> 0 OR usage.asset_count <> 0
               OR usage.asset_bytes <> 0)`,
        );
        const applicationUsage = await client.query<{
          demo_board_count: number;
          demo_content_bytes: string;
        }>(
          `SELECT demo_board_count, demo_content_bytes
           FROM application_storage_usage
           WHERE singleton`,
        );
        const aggregate = applicationUsage.rows[0];
        if (
          userUsage.rows.length !== 0 ||
          aggregate === undefined ||
          aggregate.demo_board_count !== 0 ||
          aggregate.demo_content_bytes !== '0'
        ) {
          throw new Error(
            'Demo storage quota ledger did not reconcile to zero',
          );
        }

        await client.query(
          `UPDATE application_maintenance_state
           SET last_succeeded_at = $2
           WHERE name = $1`,
          [RESET_NAME, now],
        );
        await client.query('COMMIT');
        return {
          boardIds: boards.rows.map(({ id }) => id),
          deletedSessionCount: sessions.rowCount ?? 0,
          succeededAt: now.toISOString(),
          userIds: users.rows.map(({ id }) => id),
        };
      } catch (error) {
        throw await rollbackPreservingFailure(client, error);
      } finally {
        client.release();
      }
    },

    async status(now = new Date()) {
      if (!Number.isFinite(now.getTime()))
        throw new Error('Invalid status time');
      const result = await pool.query<MaintenanceStatusRow>(
        `SELECT state.last_succeeded_at,
                (SELECT COUNT(*)::INTEGER FROM users WHERE is_demo)
                  AS account_count,
                (SELECT COUNT(*)::INTEGER FROM boards WHERE is_demo)
                  AS board_count,
                (SELECT COUNT(*)::INTEGER
                   FROM sessions
                   JOIN users ON users.id = sessions.user_id
                   WHERE users.is_demo) AS session_count,
                usage.demo_content_bytes AS content_bytes
         FROM application_maintenance_state AS state
         CROSS JOIN application_storage_usage AS usage
         WHERE state.name = $1 AND usage.singleton`,
        [RESET_NAME],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error('Demo reset maintenance status is missing');
      }
      const contentBytes = Number(row.content_bytes);
      if (!Number.isSafeInteger(contentBytes) || contentBytes < 0) {
        throw new Error('Demo content usage is invalid');
      }
      return {
        accountCount: row.account_count,
        boardCount: row.board_count,
        contentBytes,
        healthy:
          row.last_succeeded_at.getTime() <= now.getTime() &&
          utcDay(row.last_succeeded_at) === utcDay(now),
        lastSucceededAt: row.last_succeeded_at.toISOString(),
        sessionCount: row.session_count,
      };
    },
  };
}

interface DemoSandboxMaintenanceOptions {
  onError(error: unknown): void;
  onReset(reset: DemoSandboxReset): void;
  retryIntervalMs?: number;
  service: DemoSandboxService;
}

function millisecondsUntilNextUtcDay(now = new Date()): number {
  return (
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) -
    now.getTime()
  );
}

/** Starts one unref'ed, non-overlapping reset loop backed by the durable marker. */
export function startDemoSandboxMaintenance({
  onError,
  onReset,
  retryIntervalMs = RESET_RETRY_INTERVAL_MS,
  service,
}: DemoSandboxMaintenanceOptions): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const schedule = (delayMs: number) => {
    if (stopped) return;
    timer = setTimeout(() => void run(), delayMs);
    timer.unref();
  };
  const run = async () => {
    if (stopped) return;
    const startedAt = new Date();
    try {
      const reset = await service.resetIfDue();
      if (reset !== null) onReset(reset);
      schedule(
        utcDay(startedAt) === utcDay(new Date())
          ? millisecondsUntilNextUtcDay()
          : 0,
      );
    } catch (error) {
      onError(error);
      schedule(retryIntervalMs);
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  };
}
