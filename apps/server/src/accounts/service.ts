/**
 * PostgreSQL account and opaque-session repository. Password verification is
 * bounded by the work controller; legacy hashes upgrade only after successful
 * authentication, never during a failed attempt.
 */
import type { AccountUser as SharedAccountUser } from '@chalkboard/shared';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { hashSessionToken } from '../collaboration/authorization.js';
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
  beginEmailChange(
    userId: string,
    input: { code: string; currentPassword: string; email: string },
  ): Promise<'email-conflict' | 'invalid-password' | 'ready'>;
  beginPasswordReset(email: string, code: string): Promise<string | null>;
  beginRegistration(input: {
    code: string;
    displayName: string;
    email: string;
    password: string;
  }): Promise<boolean>;
  completePasswordReset(input: {
    code: string;
    email: string;
    newPassword: string;
  }): Promise<string | null>;
  getSession(token: string): Promise<AccountUser | null>;
  login(email: string, password: string): Promise<AuthenticatedSession | null>;
  logout(token: string): Promise<void>;
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
  verifyEmailChange(userId: string, code: string): Promise<AccountUser | null>;
  verifyRegistration(
    email: string,
    code: string,
  ): Promise<AuthenticatedSession | null>;
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('en-US');
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

async function createSession(
  client: Pool | PoolClient,
  user: AccountUser,
): Promise<AuthenticatedSession> {
  const token = randomBytes(32).toString('base64url');
  await client.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 day'))`,
    [user.id, hashSessionToken(token), SESSION_LIFETIME_DAYS],
  );
  return { token, user };
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
    async beginRegistration(input) {
      return passwordWork.run(async () => {
        // Neither hash creates an account. The pending row contains only a
        // password hash and expires before it can become an authenticated user.
        const passwordHash = await hashPassword(input.password);
        const codeHash = await hashPassword(input.code);
        const result = await pool.query(
          `INSERT INTO pending_registrations (
             email_normalized, email, display_name, password_hash, code_hash,
             failed_attempts, expires_at
           )
           SELECT $1, $2, $3, $4, $5, 0, NOW() + INTERVAL '15 minutes'
           WHERE NOT EXISTS (
             SELECT 1 FROM users WHERE email_normalized = $1
           )
           ON CONFLICT (email_normalized) DO UPDATE SET
             email = EXCLUDED.email,
             display_name = EXCLUDED.display_name,
             password_hash = EXCLUDED.password_hash,
             code_hash = EXCLUDED.code_hash,
             failed_attempts = 0,
             expires_at = EXCLUDED.expires_at,
             updated_at = NOW()
           RETURNING email_normalized`,
          [
            normalizeEmail(input.email),
            input.email.trim(),
            input.displayName.trim(),
            passwordHash,
            codeHash,
          ],
        );
        return result.rowCount === 1;
      });
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
          }>(
            `INSERT INTO users (
               email, email_normalized, display_name, password_hash
             ) VALUES ($1, $2, $3, $4)
             RETURNING id, email, display_name`,
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
          });
          await client.query('COMMIT');
          return session;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      });
    },

    async login(email, password) {
      return passwordWork.run(async () => {
        const result = await pool.query<{
          id: string;
          email: string;
          display_name: string;
          password_hash: string;
        }>(
          `SELECT id, email, display_name, password_hash
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
        });
      });
    },

    passwordWorkSnapshot: () => passwordWork.snapshot(),

    async updateDisplayName(userId, displayName) {
      const result = await pool.query<{
        id: string;
        email: string;
        display_name: string;
      }>(
        `UPDATE users
         SET display_name = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, email, display_name`,
        [displayName.trim(), userId],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('Account not found');
      return { id: row.id, email: row.email, displayName: row.display_name };
    },

    async beginEmailChange(userId, input) {
      return passwordWork.run(async () => {
        const current = await pool.query<{ password_hash: string }>(
          `SELECT password_hash FROM users WHERE id = $1`,
          [userId],
        );
        const row = current.rows[0];
        if (row === undefined) throw new Error('Account not found');
        if (!(await verifyPassword(input.currentPassword, row.password_hash))) {
          return 'invalid-password';
        }
        const conflict = await pool.query(
          `SELECT 1 FROM users WHERE email_normalized = $1 AND id <> $2`,
          [normalizeEmail(input.email), userId],
        );
        if ((conflict.rowCount ?? 0) > 0) return 'email-conflict';
        const codeHash = await hashPassword(input.code);
        await pool.query(
          `INSERT INTO pending_email_changes (
             user_id, email_normalized, email, code_hash, failed_attempts,
             expires_at
           ) VALUES ($1, $2, $3, $4, 0, NOW() + INTERVAL '15 minutes')
           ON CONFLICT (user_id) DO UPDATE SET
             email_normalized = EXCLUDED.email_normalized,
             email = EXCLUDED.email,
             code_hash = EXCLUDED.code_hash,
             failed_attempts = 0,
             expires_at = EXCLUDED.expires_at,
             updated_at = NOW()`,
          [userId, normalizeEmail(input.email), input.email.trim(), codeHash],
        );
        return 'ready';
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
          }>(
            `UPDATE users
             SET email = $1, email_normalized = $2, updated_at = NOW()
             WHERE id = $3
             RETURNING id, email, display_name`,
            [requested.email, requested.email_normalized, userId],
          );
          const row = updated.rows[0];
          if (row === undefined) throw new Error('Account not found');
          await client.query('COMMIT');
          return {
            id: row.id,
            email: row.email,
            displayName: row.display_name,
          };
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      });
    },

    async beginPasswordReset(email, code) {
      return passwordWork.run(async () => {
        const account = await pool.query<{ id: string; email: string }>(
          `SELECT id, email FROM users WHERE email_normalized = $1`,
          [normalizeEmail(email)],
        );
        const row = account.rows[0];
        // Unknown addresses still perform one current Argon2 operation so the
        // public response does not become a cheap account-enumeration oracle.
        const codeHash = await hashPassword(code);
        if (row === undefined) return null;
        await pool.query(
          `INSERT INTO pending_password_resets (
             user_id, code_hash, failed_attempts, expires_at
           ) VALUES ($1, $2, 0, NOW() + INTERVAL '15 minutes')
           ON CONFLICT (user_id) DO UPDATE SET
             code_hash = EXCLUDED.code_hash,
             failed_attempts = 0,
             expires_at = EXCLUDED.expires_at,
             updated_at = NOW()`,
          [row.id, codeHash],
        );
        return row.email;
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
           WHERE users.email_normalized = $1`,
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
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      });
    },

    async updatePassword(userId, input) {
      return passwordWork.run(async () => {
        const current = await pool.query<{ password_hash: string }>(
          `SELECT password_hash FROM users WHERE id = $1`,
          [userId],
        );
        const row = current.rows[0];
        if (row === undefined) throw new Error('Account not found');
        if (!(await verifyPassword(input.currentPassword, row.password_hash))) {
          return false;
        }
        const replacement = await hashPassword(input.newPassword);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const updated = await client.query(
            `UPDATE users
             SET password_hash = $1, updated_at = NOW()
             WHERE id = $2 AND password_hash = $3`,
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
          await client.query('ROLLBACK');
          throw error;
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
        session_id: string;
        last_seen_at: Date;
      }>(
        `SELECT users.id, users.email, users.display_name,
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
      return { id: row.id, email: row.email, displayName: row.display_name };
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
