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
import {
  createDemoSandboxService,
  type DemoSandboxService,
} from '../demo/demoSandbox.js';
import type { ApplicationSecurityMaterial } from '../email/applicationSecurity.js';
import {
  createEmailSecurityService,
  type EmailSecurityService,
} from '../email/emailSecurity.js';
import {
  createEmailFeedbackService,
  type EmailFeedbackService,
} from '../email/feedback.js';
import { runWithFailurePreservingCleanup } from '../operations/failurePreservation.js';
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
  demoSandbox?: DemoSandboxService;
  emailFeedback?: EmailFeedbackService;
  emailOperationalStatus?(): Promise<{
    flows: Record<'email-change' | 'password-reset' | 'registration', boolean>;
    verifiedAccountCount: number;
    verifiedAccountLimit: number;
  }>;
  emailSecurity?: EmailSecurityService;
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
  demoSandbox: DemoSandboxService;
  emailFeedback: EmailFeedbackService;
  emailOperationalStatus(): Promise<{
    flows: Record<'email-change' | 'password-reset' | 'registration', boolean>;
    verifiedAccountCount: number;
    verifiedAccountLimit: number;
  }>;
  emailSecurity?: EmailSecurityService;
  metricsSnapshot(): DatabaseMetricsSnapshot;
}

/** Creates one bounded PostgreSQL pool and every repository that shares it. */
export function createDatabase(
  connectionString: string,
  passwordWorkLimits: PasswordWorkLimits = DEFAULT_PASSWORD_WORK_LIMITS,
  applicationSecurity: ApplicationSecurityMaterial | null = null,
  emailFlowSwitchOverrides?: Partial<
    Record<'email-change' | 'password-reset' | 'registration', boolean>
  >,
  emailCapacityLimits?: { daily: number; monthly: number },
  accountRegistrationLimit = 250,
  testEmailAdmissionLimitMultiplier = 1,
): RuntimeDatabase {
  if (
    !Number.isInteger(accountRegistrationLimit) ||
    accountRegistrationLimit < 1 ||
    accountRegistrationLimit > 250
  ) {
    throw new Error('Account registration limit exceeds the hard cap');
  }
  const maximumConnections = 10;
  const pool = new Pool({
    connectionString,
    options: `-c chalkboard.account_registration_limit=${accountRegistrationLimit}`,
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
    demoSandbox: createDemoSandboxService(pool),
    emailFeedback: createEmailFeedbackService(pool),
    async emailOperationalStatus() {
      const [switches, accounts] = await Promise.all([
        pool.query<{
          enabled: boolean;
          flow: 'email-change' | 'password-reset' | 'registration';
        }>('SELECT flow, enabled FROM email_flow_switches ORDER BY flow'),
        pool.query<{
          verified_account_count: number;
          verified_account_limit: number;
        }>(
          `SELECT COALESCE(
                    NULLIF(current_setting(
                      'chalkboard.account_registration_limit', TRUE
                    ), '')::INTEGER,
                    settings.verified_account_limit
                  ) AS verified_account_limit,
                  (
                    SELECT COUNT(*)::INTEGER FROM users WHERE NOT is_demo
                  ) AS verified_account_count
           FROM account_registration_settings AS settings
           WHERE settings.singleton`,
        ),
      ]);
      const flowStatus = {
        'email-change': false,
        'password-reset': false,
        registration: false,
      };
      for (const row of switches.rows) {
        flowStatus[row.flow] =
          emailFlowSwitchOverrides?.[row.flow] ?? row.enabled;
      }
      const accountStatus = accounts.rows[0];
      if (accountStatus === undefined) {
        throw new Error('Account registration settings are unavailable');
      }
      return {
        flows: flowStatus,
        verifiedAccountCount: accountStatus.verified_account_count,
        verifiedAccountLimit: accountStatus.verified_account_limit,
      };
    },
    ...(applicationSecurity === null
      ? {}
      : {
          emailSecurity: createEmailSecurityService(
            pool,
            {
              generation: applicationSecurity.admissionKeyGeneration,
              value: applicationSecurity.admissionKey,
            },
            {
              ...(emailCapacityLimits === undefined
                ? {}
                : { capacityLimits: emailCapacityLimits }),
              ...(emailFlowSwitchOverrides === undefined
                ? {}
                : { flowSwitchOverrides: emailFlowSwitchOverrides }),
              ...(testEmailAdmissionLimitMultiplier === 1
                ? {}
                : {
                    testLimitMultiplier: testEmailAdmissionLimitMultiplier,
                  }),
            },
          ),
        }),
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
      await runWithFailurePreservingCleanup(
        async () => {
          if (client === null) return;
          await client.query(
            `SELECT pg_advisory_unlock(
               hashtextextended($1, 0)
             )`,
            [RUNTIME_LOCK_NAME],
          );
        },
        [() => client?.release(), () => pool.end()],
        'Database runtime-lock or pool cleanup failed',
      );
    },
    async ping() {
      await pool.query('SELECT 1');
    },
  };
}
