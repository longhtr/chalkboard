/**
 * PostgreSQL account and opaque-session repository. Password verification is
 * bounded by the work controller; legacy hashes upgrade only after successful
 * authentication, never during a failed attempt.
 */
import type { AccountUser as SharedAccountUser } from '@chalkboard/shared';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

import { Pool, type PoolClient } from 'pg';

import { hashSessionToken } from '../collaboration/authorization.js';
import { rollbackPreservingFailure } from '../db/transactionFailure.js';
import {
  PasswordWorkController,
  type PasswordWorkSnapshot,
} from './passwordWorkController.js';

const SESSION_LIFETIME_DAYS = 30;
const SESSION_TOUCH_INTERVAL_MINUTES = 15;
const ARGON2_OPTIONS = {
  algorithm: 2,
  memoryCost: 19_456,
  outputLen: 32,
  parallelism: 1,
  timeCost: 2,
} as const;

/** Server-local alias of the authenticated user projection shared with clients. */
export type AccountUser = SharedAccountUser;

interface AuthenticatedSession {
  token: string;
  user: AccountUser;
}

/** Account and opaque-session authority backed by PostgreSQL and Argon2id. */
export interface AccountService {
  attachEmailIntent(
    purpose: 'email-change' | 'password-reset' | 'registration',
    generationId: string,
    intentId: string,
  ): Promise<boolean>;
  beginEmailChange(
    userId: string,
    input: { code: string; currentPassword: string; email: string },
  ): Promise<
    | { outcome: 'created'; destination: string; generationId: string }
    | { outcome: 'email-conflict' }
    | { outcome: 'invalid-password' }
    // The caller already holds this address, so there is nothing to verify.
    // Reported separately rather than sending a code to the address it would
    // supposedly be changing away from.
    | { outcome: 'unchanged' }
    | { outcome: 'existing'; destination: string }
    // A different address was requested while one is still pending. Reported
    // apart from 'existing' so the caller is never shown an address it did not
    // ask for as though the request had succeeded.
    | { outcome: 'pending-other'; destination: string; expiresAt: Date }
  >;
  beginPasswordReset(
    email: string,
    code: string,
  ): Promise<
    | {
        outcome: 'created';
        destination: string;
        generationId: string;
        userId: string;
      }
    | { outcome: 'existing' | 'unknown' }
  >;
  beginRegistration(input: {
    code: string;
    displayName: string;
    email: string;
    password: string;
  }): Promise<
    | { outcome: 'account-exists' }
    | { outcome: 'existing' }
    | { outcome: 'created'; generationId: string }
  >;
  cancelPendingEmail(
    purpose: 'email-change' | 'password-reset' | 'registration',
    generationId: string,
  ): Promise<void>;
  completePasswordReset(input: {
    code: string;
    email: string;
    newPassword: string;
  }): Promise<string | null>;
  deleteAccount(
    userId: string,
    currentPassword: string,
  ): Promise<
    | { outcome: 'deleted'; deletedBoardIds: string[] }
    | { outcome: 'demo' | 'invalid-password' }
  >;
  equalizePasswordReset(email: string, code: string): Promise<void>;
  getSession(token: string): Promise<AccountUser | null>;
  login(email: string, password: string): Promise<AuthenticatedSession | null>;
  logout(token: string): Promise<void>;
  markPendingEmailSent(
    purpose: 'email-change' | 'password-reset' | 'registration',
    generationId: string,
  ): Promise<void>;
  pendingRegistrationExists(email: string): Promise<boolean>;
  passwordWorkSnapshot(): PasswordWorkSnapshot;
  updateDisplayName(userId: string, displayName: string): Promise<AccountUser>;
  updatePassword(
    userId: string,
    input: {
      currentPassword: string;
      newPassword: string;
      sessionToken: string;
    },
  ): Promise<boolean>;
  verifyCurrentPassword(
    userId: string,
    currentPassword: string,
  ): Promise<boolean>;
  verifyEmailChange(userId: string, code: string): Promise<AccountUser | null>;
  verifyRegistration(
    email: string,
    code: string,
  ): Promise<AuthenticatedSession | null>;
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('en-US');
}

async function preparePasswordReset(
  pool: Pool,
  email: string,
  code: string,
): Promise<{
  codeHash: string;
  user: { email: string; id: string; isDemo: boolean } | null;
}> {
  const account = await pool.query<{
    email: string;
    id: string;
    is_demo: boolean;
  }>(`SELECT id, email, is_demo FROM users WHERE email_normalized = $1`, [
    normalizeEmail(email),
  ]);
  const row = account.rows[0];
  // Unknown and demo addresses perform the same Argon2 operation as eligible
  // accounts without persisting the supplied destination.
  const codeHash = await hashPassword(code);
  return {
    codeHash,
    user:
      row === undefined
        ? null
        : { email: row.email, id: row.id, isDemo: row.is_demo },
  };
}

function pendingTable(
  purpose: 'email-change' | 'password-reset' | 'registration',
):
  | 'pending_email_changes'
  | 'pending_password_resets'
  | 'pending_registrations' {
  switch (purpose) {
    case 'email-change':
      return 'pending_email_changes';
    case 'password-reset':
      return 'pending_password_resets';
    case 'registration':
      return 'pending_registrations';
  }
}

async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTIONS);
}

async function verifyLegacyScrypt(
  password: string,
  stored: string,
): Promise<boolean> {
  const [algorithm, encodedSalt, encodedHash] = stored.split('$');
  if (
    algorithm !== 'scrypt' ||
    encodedSalt === undefined ||
    encodedHash === undefined
  ) {
    return false;
  }
  const expected = Buffer.from(encodedHash, 'base64url');
  const actual = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      Buffer.from(encodedSalt, 'base64url'),
      expected.length,
      (error, derivedKey) => {
        if (error !== null) reject(error);
        else resolve(derivedKey);
      },
    );
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (stored.startsWith('$argon2id$')) {
    try {
      return await argon2Verify(stored, password);
    } catch {
      return false;
    }
  }
  return verifyLegacyScrypt(password, stored);
}

// Unknown accounts perform the same current password operation as known ones.
// The promise begins at service startup so the first rejected login is not a
// special fast path.
const dummyPasswordHash = hashPassword(
  'chalkboard timing equalization value; not an account credential',
);

async function insertSession(
  client: Pool | PoolClient,
  user: AccountUser,
  token: string,
): Promise<void> {
  await client.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 day'))`,
    [user.id, hashSessionToken(token), SESSION_LIFETIME_DAYS],
  );
  if (!user.isDemo) return;
  await client.query(
    `DELETE FROM sessions
     WHERE id IN (
       SELECT id FROM sessions
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       OFFSET 100
     )`,
    [user.id],
  );
}

async function createSession(
  client: Pool | PoolClient,
  user: AccountUser,
): Promise<AuthenticatedSession> {
  const token = randomBytes(32).toString('base64url');
  if (!user.isDemo || !(client instanceof Pool)) {
    await insertSession(client, user, token);
    return { token, user };
  }

  const transaction = await client.connect();
  try {
    await transaction.query('BEGIN');
    await transaction.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`chalkboard:demo-sessions:${user.id}`],
    );
    await insertSession(transaction, user, token);
    await transaction.query('COMMIT');
    return { token, user };
  } catch (error) {
    throw await rollbackPreservingFailure(transaction, error);
  } finally {
    transaction.release();
  }
}

/**
 * Builds account operations with bounded password work. Password verification
 * completes before a database transaction is held.
 */
export function createAccountService(
  pool: Pool,
  passwordWork = new PasswordWorkController(),
): AccountService {
  return {
    async attachEmailIntent(purpose, generationId, intentId) {
      const table = pendingTable(purpose);
      const result = await pool.query(
        `UPDATE ${table}
         SET send_intent_id = $2, updated_at = NOW()
         WHERE generation_id = $1 AND send_intent_id IS NULL
           AND expires_at > NOW()`,
        [generationId, intentId],
      );
      return result.rowCount === 1;
    },

    async beginRegistration(input) {
      return passwordWork.run(async () => {
        // Hashing completes before the transaction. The advisory lock then
        // keeps concurrent retries from rotating one still-valid code.
        const passwordHash = await hashPassword(input.password);
        const codeHash = await hashPassword(input.code);
        const normalized = normalizeEmail(input.email);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [`chalkboard:pending-registration:${normalized}`],
          );
          const account = await client.query(
            'SELECT 1 FROM users WHERE email_normalized = $1',
            [normalized],
          );
          if ((account.rowCount ?? 0) > 0) {
            await client.query('COMMIT');
            return { outcome: 'account-exists' } as const;
          }
          const pending = await client.query<{ generation_id: string }>(
            `SELECT generation_id FROM pending_registrations
             WHERE email_normalized = $1 AND expires_at > NOW()
               AND failed_attempts < 5
             FOR UPDATE`,
            [normalized],
          );
          if (pending.rows[0] !== undefined) {
            await client.query('COMMIT');
            return { outcome: 'existing' } as const;
          }
          await client.query(
            'DELETE FROM pending_registrations WHERE email_normalized = $1',
            [normalized],
          );
          const generationId = randomUUID();
          await client.query(
            `INSERT INTO pending_registrations (
               email_normalized, email, display_name, password_hash, code_hash,
               failed_attempts, expires_at, generation_id
             ) VALUES ($1, $2, $3, $4, $5, 0,
                       NOW() + INTERVAL '15 minutes', $6)`,
            [
              normalized,
              input.email.trim(),
              input.displayName.trim(),
              passwordHash,
              codeHash,
              generationId,
            ],
          );
          await client.query('COMMIT');
          return { generationId, outcome: 'created' } as const;
        } catch (error) {
          throw await rollbackPreservingFailure(client, error);
        } finally {
          client.release();
        }
      });
    },

    async cancelPendingEmail(purpose, generationId) {
      const table = pendingTable(purpose);
      await pool.query(
        `DELETE FROM ${table}
         WHERE generation_id = $1 AND last_sent_at IS NULL`,
        [generationId],
      );
    },

    async verifyRegistration(email, code) {
      return passwordWork.run(async () => {
        const normalized = normalizeEmail(email);
        const pending = await pool.query<{
          code_hash: string;
          expires_at: Date;
          failed_attempts: number;
        }>(
          `SELECT code_hash, expires_at, failed_attempts
           FROM pending_registrations
           WHERE email_normalized = $1`,
          [normalized],
        );
        const candidate = pending.rows[0];
        if (
          candidate === undefined ||
          candidate.expires_at.getTime() <= Date.now() ||
          candidate.failed_attempts >= 5
        ) {
          return null;
        }
        if (!(await verifyPassword(code, candidate.code_hash))) {
          await pool.query(
            `UPDATE pending_registrations
             SET failed_attempts = failed_attempts + 1, updated_at = NOW()
             WHERE email_normalized = $1 AND code_hash = $2`,
            [normalized, candidate.code_hash],
          );
          return null;
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const claimed = await client.query<{
            display_name: string;
            email: string;
            password_hash: string;
          }>(
            `DELETE FROM pending_registrations
             WHERE email_normalized = $1 AND code_hash = $2
               AND expires_at > NOW() AND failed_attempts < 5
             RETURNING email, display_name, password_hash`,
            [normalized, candidate.code_hash],
          );
          const pendingAccount = claimed.rows[0];
          if (pendingAccount === undefined) {
            await client.query('ROLLBACK');
            return null;
          }
          const inserted = await client.query<{
            id: string;
            email: string;
            display_name: string;
            is_demo: boolean;
          }>(
            `INSERT INTO users (
               email, email_normalized, display_name, password_hash
             ) VALUES ($1, $2, $3, $4)
             RETURNING id, email, display_name, is_demo`,
            [
              pendingAccount.email,
              normalized,
              pendingAccount.display_name,
              pendingAccount.password_hash,
            ],
          );
          const row = inserted.rows[0];
          if (row === undefined) {
            throw new Error('Verified account insertion returned no user');
          }
          const session = await createSession(client, {
            id: row.id,
            email: row.email,
            displayName: row.display_name,
            isDemo: row.is_demo,
          });
          await client.query('COMMIT');
          return session;
        } catch (error) {
          throw await rollbackPreservingFailure(client, error);
        } finally {
          client.release();
        }
      });
    },

    async deleteAccount(userId, currentPassword) {
      return passwordWork.run(async () => {
        const current = await pool.query<{
          is_demo: boolean;
          password_hash: string;
        }>(
          `SELECT is_demo, password_hash
           FROM users WHERE id = $1`,
          [userId],
        );
        const account = current.rows[0];
        if (account === undefined) return { outcome: 'invalid-password' };
        if (account.is_demo) return { outcome: 'demo' };
        if (!(await verifyPassword(currentPassword, account.password_hash))) {
          return { outcome: 'invalid-password' };
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const locked = await client.query<{
            is_demo: boolean;
            password_hash: string;
          }>(
            `SELECT is_demo, password_hash
             FROM users WHERE id = $1
             FOR UPDATE`,
            [userId],
          );
          const lockedAccount = locked.rows[0];
          if (
            lockedAccount === undefined ||
            lockedAccount.is_demo ||
            lockedAccount.password_hash !== account.password_hash
          ) {
            await client.query('ROLLBACK');
            return {
              outcome:
                lockedAccount?.is_demo === true ? 'demo' : 'invalid-password',
            };
          }
          const ownedBoards = await client.query<{ id: string }>(
            'DELETE FROM boards WHERE owner_id = $1 RETURNING id',
            [userId],
          );
          await client.query(
            'DELETE FROM board_assets WHERE uploaded_by = $1',
            [userId],
          );
          const deleted = await client.query(
            'DELETE FROM users WHERE id = $1 AND NOT is_demo',
            [userId],
          );
          if (deleted.rowCount !== 1) {
            throw new Error('Account deletion lost its locked user');
          }
          await client.query('COMMIT');
          return {
            outcome: 'deleted',
            deletedBoardIds: ownedBoards.rows.map(({ id }) => id),
          };
        } catch (error) {
          throw await rollbackPreservingFailure(client, error);
        } finally {
          client.release();
        }
      });
    },

    async equalizePasswordReset(email, code) {
      await passwordWork.run(async () => {
        await preparePasswordReset(pool, email, code);
      });
    },

    async login(email, password) {
      return passwordWork.run(async () => {
        const result = await pool.query<{
          id: string;
          email: string;
          display_name: string;
          is_demo: boolean;
          password_hash: string;
        }>(
          `SELECT id, email, display_name, is_demo, password_hash
           FROM users
           WHERE email_normalized = $1`,
          [normalizeEmail(email)],
        );
        const row = result.rows[0];
        const storedHash = row?.password_hash ?? (await dummyPasswordHash);
        const valid = await verifyPassword(password, storedHash);
        if (!valid || row === undefined) return null;

        if (storedHash.startsWith('scrypt$')) {
          const replacement = await hashPassword(password);
          await pool.query(
            `UPDATE users SET password_hash = $1, updated_at = NOW()
             WHERE id = $2 AND password_hash = $3`,
            [replacement, row.id, row.password_hash],
          );
        }

        return createSession(pool, {
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          isDemo: row.is_demo,
        });
      });
    },

    async markPendingEmailSent(purpose, generationId) {
      const table = pendingTable(purpose);
      const result = await pool.query(
        `UPDATE ${table}
         SET last_sent_at = NOW(), updated_at = NOW()
         WHERE generation_id = $1 AND send_intent_id IS NOT NULL
           AND last_sent_at IS NULL`,
        [generationId],
      );
      if (result.rowCount !== 1) {
        throw new Error('Pending email generation is not ready to mark sent');
      }
    },

    async pendingRegistrationExists(email) {
      const pending = await pool.query(
        `SELECT 1 FROM pending_registrations
         WHERE email_normalized = $1 AND expires_at > NOW()
           AND failed_attempts < 5`,
        [normalizeEmail(email)],
      );
      return (pending.rowCount ?? 0) > 0;
    },

    passwordWorkSnapshot: () => passwordWork.snapshot(),

    async updateDisplayName(userId, displayName) {
      const result = await pool.query<{
        id: string;
        email: string;
        display_name: string;
        is_demo: boolean;
      }>(
        `UPDATE users
         SET display_name = $1, updated_at = NOW()
         WHERE id = $2 AND NOT is_demo
         RETURNING id, email, display_name, is_demo`,
        [displayName.trim(), userId],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('Account not found');
      return {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        isDemo: row.is_demo,
      };
    },

    async beginEmailChange(userId, input) {
      return passwordWork.run(async () => {
        const current = await pool.query<{
          email_normalized: string;
          is_demo: boolean;
          password_hash: string;
        }>(
          `SELECT email_normalized, is_demo, password_hash
           FROM users WHERE id = $1`,
          [userId],
        );
        const row = current.rows[0];
        if (row === undefined) throw new Error('Account not found');
        if (
          row.is_demo ||
          !(await verifyPassword(input.currentPassword, row.password_hash))
        ) {
          return { outcome: 'invalid-password' } as const;
        }
        const normalized = normalizeEmail(input.email);
        // Checked before the code is generated or hashed, because the answer
        // costs nothing and the alternative spends a provider send proving the
        // caller controls an address they are already signed in with.
        if (normalized === row.email_normalized) {
          return { outcome: 'unchanged' } as const;
        }
        const codeHash = await hashPassword(input.code);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [`chalkboard:pending-email-change:${userId}`],
          );
          const conflict = await client.query(
            `SELECT 1 FROM users WHERE email_normalized = $1 AND id <> $2`,
            [normalized, userId],
          );
          if ((conflict.rowCount ?? 0) > 0) {
            await client.query('COMMIT');
            return { outcome: 'email-conflict' } as const;
          }
          const pending = await client.query<{
            email: string;
            email_normalized: string;
            expires_at: Date;
          }>(
            `SELECT email, email_normalized, expires_at
             FROM pending_email_changes
             WHERE user_id = $1 AND expires_at > NOW()
               AND failed_attempts < 5
             FOR UPDATE`,
            [userId],
          );
          const existing = pending.rows[0];
          if (existing !== undefined) {
            await client.query('COMMIT');
            // Re-requesting the same change reuses the live code, which is the
            // control that stops repeated submissions from sending again.
            if (existing.email_normalized === normalized) {
              return {
                destination: existing.email,
                outcome: 'existing',
              } as const;
            }
            return {
              destination: existing.email,
              expiresAt: existing.expires_at,
              outcome: 'pending-other',
            } as const;
          }
          await client.query(
            'DELETE FROM pending_email_changes WHERE user_id = $1',
            [userId],
          );
          const generationId = randomUUID();
          await client.query(
            `INSERT INTO pending_email_changes (
               user_id, email_normalized, email, code_hash, failed_attempts,
               expires_at, generation_id
             ) VALUES ($1, $2, $3, $4, 0,
                       NOW() + INTERVAL '15 minutes', $5)`,
            [userId, normalized, input.email.trim(), codeHash, generationId],
          );
          await client.query('COMMIT');
          return {
            destination: input.email.trim(),
            generationId,
            outcome: 'created',
          } as const;
        } catch (error) {
          throw await rollbackPreservingFailure(client, error);
        } finally {
          client.release();
        }
      });
    },

    async verifyCurrentPassword(userId, currentPassword) {
      return passwordWork.run(async () => {
        const current = await pool.query<{
          is_demo: boolean;
          password_hash: string;
        }>(`SELECT is_demo, password_hash FROM users WHERE id = $1`, [userId]);
        const row = current.rows[0];
        const storedHash = row?.password_hash ?? (await dummyPasswordHash);
        const valid = await verifyPassword(currentPassword, storedHash);
        return valid && row !== undefined && !row.is_demo;
      });
    },

    async verifyEmailChange(userId, code) {
      return passwordWork.run(async () => {
        const pending = await pool.query<{
          code_hash: string;
          expires_at: Date;
          failed_attempts: number;
        }>(
          `SELECT code_hash, expires_at, failed_attempts
           FROM pending_email_changes WHERE user_id = $1`,
          [userId],
        );
        const candidate = pending.rows[0];
        if (
          candidate === undefined ||
          candidate.expires_at.getTime() <= Date.now() ||
          candidate.failed_attempts >= 5
        ) {
          return null;
        }
        if (!(await verifyPassword(code, candidate.code_hash))) {
          await pool.query(
            `UPDATE pending_email_changes
             SET failed_attempts = failed_attempts + 1, updated_at = NOW()
             WHERE user_id = $1 AND code_hash = $2`,
            [userId, candidate.code_hash],
          );
          return null;
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const claimed = await client.query<{
            email: string;
            email_normalized: string;
          }>(
            `DELETE FROM pending_email_changes
             WHERE user_id = $1 AND code_hash = $2
               AND expires_at > NOW() AND failed_attempts < 5
             RETURNING email, email_normalized`,
            [userId, candidate.code_hash],
          );
          const requested = claimed.rows[0];
          if (requested === undefined) {
            await client.query('ROLLBACK');
            return null;
          }
          const updated = await client.query<{
            id: string;
            email: string;
            display_name: string;
            is_demo: boolean;
          }>(
            `UPDATE users
             SET email = $1, email_normalized = $2, updated_at = NOW()
             WHERE id = $3 AND NOT is_demo
             RETURNING id, email, display_name, is_demo`,
            [requested.email, requested.email_normalized, userId],
          );
          const row = updated.rows[0];
          if (row === undefined) throw new Error('Account not found');
          await client.query('COMMIT');
          return {
            id: row.id,
            email: row.email,
            displayName: row.display_name,
            isDemo: row.is_demo,
          };
        } catch (error) {
          throw await rollbackPreservingFailure(client, error);
        } finally {
          client.release();
        }
      });
    },

    async beginPasswordReset(email, code) {
      return passwordWork.run(async () => {
        const prepared = await preparePasswordReset(pool, email, code);
        const row = prepared.user;
        if (row === null || row.isDemo) {
          return { outcome: 'unknown' } as const;
        }
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [`chalkboard:pending-password-reset:${row.id}`],
          );
          const pending = await client.query(
            `SELECT 1 FROM pending_password_resets
             WHERE user_id = $1 AND expires_at > NOW()
               AND failed_attempts < 5
             FOR UPDATE`,
            [row.id],
          );
          if ((pending.rowCount ?? 0) > 0) {
            await client.query('COMMIT');
            return { outcome: 'existing' } as const;
          }
          await client.query(
            'DELETE FROM pending_password_resets WHERE user_id = $1',
            [row.id],
          );
          const generationId = randomUUID();
          await client.query(
            `INSERT INTO pending_password_resets (
               user_id, code_hash, failed_attempts, expires_at, generation_id
             ) VALUES ($1, $2, 0, NOW() + INTERVAL '15 minutes', $3)`,
            [row.id, prepared.codeHash, generationId],
          );
          await client.query('COMMIT');
          return {
            destination: row.email,
            generationId,
            outcome: 'created',
            userId: row.id,
          } as const;
        } catch (error) {
          throw await rollbackPreservingFailure(client, error);
        } finally {
          client.release();
        }
      });
    },

    async completePasswordReset(input) {
      return passwordWork.run(async () => {
        const pending = await pool.query<{
          code_hash: string;
          expires_at: Date;
          failed_attempts: number;
          user_id: string;
        }>(
          `SELECT resets.user_id, resets.code_hash, resets.expires_at,
                  resets.failed_attempts
           FROM pending_password_resets AS resets
           JOIN users ON users.id = resets.user_id
           WHERE users.email_normalized = $1 AND NOT users.is_demo`,
          [normalizeEmail(input.email)],
        );
        const candidate = pending.rows[0];
        if (
          candidate === undefined ||
          candidate.expires_at.getTime() <= Date.now() ||
          candidate.failed_attempts >= 5
        ) {
          return null;
        }
        if (!(await verifyPassword(input.code, candidate.code_hash))) {
          await pool.query(
            `UPDATE pending_password_resets
             SET failed_attempts = failed_attempts + 1, updated_at = NOW()
             WHERE user_id = $1 AND code_hash = $2`,
            [candidate.user_id, candidate.code_hash],
          );
          return null;
        }
        const replacement = await hashPassword(input.newPassword);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const claimed = await client.query(
            `DELETE FROM pending_password_resets
             WHERE user_id = $1 AND code_hash = $2
               AND expires_at > NOW() AND failed_attempts < 5`,
            [candidate.user_id, candidate.code_hash],
          );
          if (claimed.rowCount !== 1) {
            await client.query('ROLLBACK');
            return null;
          }
          await client.query(
            `UPDATE users SET password_hash = $1, updated_at = NOW()
             WHERE id = $2`,
            [replacement, candidate.user_id],
          );
          await client.query(
            `UPDATE sessions SET revoked_at = NOW()
             WHERE user_id = $1 AND revoked_at IS NULL`,
            [candidate.user_id],
          );
          await client.query('COMMIT');
          return candidate.user_id;
        } catch (error) {
          throw await rollbackPreservingFailure(client, error);
        } finally {
          client.release();
        }
      });
    },

    async updatePassword(userId, input) {
      return passwordWork.run(async () => {
        const current = await pool.query<{
          is_demo: boolean;
          password_hash: string;
        }>(`SELECT is_demo, password_hash FROM users WHERE id = $1`, [userId]);
        const row = current.rows[0];
        if (row === undefined) throw new Error('Account not found');
        if (
          row.is_demo ||
          !(await verifyPassword(input.currentPassword, row.password_hash))
        ) {
          return false;
        }
        const replacement = await hashPassword(input.newPassword);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const updated = await client.query(
            `UPDATE users
             SET password_hash = $1, updated_at = NOW()
             WHERE id = $2 AND password_hash = $3 AND NOT is_demo`,
            [replacement, userId, row.password_hash],
          );
          if (updated.rowCount !== 1) {
            await client.query('ROLLBACK');
            return false;
          }
          await client.query(
            `UPDATE sessions SET revoked_at = NOW()
             WHERE user_id = $1 AND token_hash <> $2 AND revoked_at IS NULL`,
            [userId, hashSessionToken(input.sessionToken)],
          );
          await client.query('COMMIT');
          return true;
        } catch (error) {
          throw await rollbackPreservingFailure(client, error);
        } finally {
          client.release();
        }
      });
    },

    async getSession(token) {
      const result = await pool.query<{
        id: string;
        email: string;
        display_name: string;
        is_demo: boolean;
        session_id: string;
        last_seen_at: Date;
      }>(
        `SELECT users.id, users.email, users.display_name, users.is_demo,
                sessions.id AS session_id, sessions.last_seen_at
         FROM sessions
         JOIN users ON sessions.user_id = users.id
         WHERE sessions.token_hash = $1
           AND sessions.revoked_at IS NULL
           AND sessions.expires_at > NOW()`,
        [hashSessionToken(token)],
      );
      const row = result.rows[0];
      if (row === undefined) return null;

      if (
        Date.now() - row.last_seen_at.getTime() >=
        SESSION_TOUCH_INTERVAL_MINUTES * 60_000
      ) {
        await pool.query(
          `UPDATE sessions SET last_seen_at = NOW()
           WHERE id = $1
             AND last_seen_at < NOW() - ($2 * INTERVAL '1 minute')`,
          [row.session_id, SESSION_TOUCH_INTERVAL_MINUTES],
        );
      }
      return {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        isDemo: row.is_demo,
      };
    },

    async logout(token) {
      await pool.query(
        `UPDATE sessions SET revoked_at = NOW()
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hashSessionToken(token)],
      );
    },
  };
}
