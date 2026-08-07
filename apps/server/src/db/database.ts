/**
 * Composes the PostgreSQL pool and database-backed services. The returned
 * object owns readiness, metrics, the single-runtime advisory lock, every
 * repository, and final pool shutdown.
 */
import { Pool, type PoolClient } from 'pg';

import {
  PasswordWorkController,
  DEFAULT_PASSWORD_WORK_LIMITS,
  type PasswordWorkLimits,
} from '../accounts/passwordWorkController.js';
import {
  createAccountService,
  type AccountService,
} from '../accounts/service.js';
import { createAssetService, type AssetService } from '../assets/service.js';
import { createBoardService, type BoardService } from '../boards/service.js';
import {
  createCollaborationAuthorization,
  type CollaborationAuthorization,
} from '../collaboration/authorization.js';
import {
  createCollaborationPersistence,
  type CollaborationPersistence,
} from '../collaboration/persistence.js';
import { RUNTIME_LOCK_NAME } from './locks.js';

/** Point-in-time PostgreSQL-pool and password-work admission counters. */
export interface DatabaseMetricsSnapshot {
  idleConnections: number;
  maximumConnections: number;
  passwordWorkActive: number;
  passwordWorkConcurrent: number;
  passwordWorkPending: number;
  passwordWorkQueued: number;
  totalConnections: number;
  waitingRequests: number;
}

/** Database-owned services and lifecycle hooks consumed by server composition. */
export interface Database {
  accounts?: AccountService;
  acquireRuntimeLock?(): Promise<void>;
  assets?: AssetService;
  boards?: BoardService;
  close(): Promise<void>;
  collaboration?: CollaborationPersistence;
  collaborationAuthorization?: CollaborationAuthorization;
  metricsSnapshot?(): DatabaseMetricsSnapshot;
  ping(): Promise<void>;
}

/** Complete production database returned by the PostgreSQL factory. */
interface RuntimeDatabase extends Database {
  accounts: AccountService;
  acquireRuntimeLock(): Promise<void>;
  assets: AssetService;
  boards: BoardService;
  collaboration: CollaborationPersistence;
  collaborationAuthorization: CollaborationAuthorization;
  metricsSnapshot(): DatabaseMetricsSnapshot;
}

/** Creates one bounded PostgreSQL pool and every repository that shares it. */
export function createDatabase(
  connectionString: string,
  passwordWorkLimits: PasswordWorkLimits = DEFAULT_PASSWORD_WORK_LIMITS,
): RuntimeDatabase {
  const maximumConnections = 10;
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: maximumConnections,
    maxLifetimeSeconds: 3_600,
    query_timeout: 25_000,
    statement_timeout: 20_000,
  });
  const accounts = createAccountService(
    pool,
    new PasswordWorkController(passwordWorkLimits),
  );
  let runtimeLockClient: PoolClient | null = null;

  return {
    accounts,
    async acquireRuntimeLock() {
      if (runtimeLockClient !== null) return;
      const client = await pool.connect();
      try {
        const result = await client.query<{ acquired: boolean }>(
          `SELECT pg_try_advisory_lock(
             hashtextextended($1, 0)
           ) AS acquired`,
          [RUNTIME_LOCK_NAME],
        );
        if (result.rows[0]?.acquired !== true) {
          throw new Error(
            'Another Chalkboard collaboration server holds the production runtime lock',
          );
        }
        runtimeLockClient = client;
      } catch (error) {
        client.release();
        throw error;
      }
    },
    assets: createAssetService(pool),
    boards: createBoardService(pool),
    collaboration: createCollaborationPersistence(pool),
    collaborationAuthorization: createCollaborationAuthorization(pool),
    metricsSnapshot() {
      const passwordWork = accounts.passwordWorkSnapshot();
      return {
        idleConnections: pool.idleCount,
        maximumConnections,
        passwordWorkActive: passwordWork.active,
        passwordWorkConcurrent: passwordWork.concurrent,
        passwordWorkPending: passwordWork.pending,
        passwordWorkQueued: passwordWork.queued,
        totalConnections: pool.totalCount,
        waitingRequests: pool.waitingCount,
      };
    },
    async close() {
      const client = runtimeLockClient;
      runtimeLockClient = null;
      if (client !== null) {
        try {
          await client.query(
            `SELECT pg_advisory_unlock(
               hashtextextended($1, 0)
             )`,
            [RUNTIME_LOCK_NAME],
          );
        } finally {
          client.release();
        }
      }
      await pool.end();
    },
    async ping() {
      await pool.query('SELECT 1');
    },
  };
}
