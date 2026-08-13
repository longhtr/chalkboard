/** Proves account deletion invalidates live authority only after committed deletion. */
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountService } from '../accounts/service.js';
import { OperationalMetrics } from '../operations/metrics.js';
import { installAccountRoutes } from './accountRoutes.js';

const apps: ReturnType<typeof Fastify>[] = [];
const user = {
  displayName: 'Deletion User',
  email: 'deletion-route@chalkboard.test',
  id: '00000000-0000-4000-8000-000000000001',
  isDemo: false,
};

function accountService(
  deleteAccount: AccountService['deleteAccount'],
): AccountService {
  const notUsed = async () => {
    throw new Error('not used');
  };
  return {
    attachEmailIntent: async () => false,
    beginEmailChange: notUsed,
    beginPasswordReset: notUsed,
    beginRegistration: notUsed,
    cancelPendingEmail: async () => undefined,
    completePasswordReset: notUsed,
    deleteAccount,
    equalizePasswordReset: async () => undefined,
    getSession: async () => user,
    login: notUsed,
    logout: async () => undefined,
    markPendingEmailSent: async () => undefined,
    pendingRegistrationExists: async () => false,
    passwordWorkSnapshot: () => ({
      active: 0,
      concurrent: 1,
      pending: 0,
      queued: 0,
    }),
    updateDisplayName: notUsed,
    updatePassword: notUsed,
    verifyCurrentPassword: notUsed,
    verifyEmailChange: notUsed,
    verifyRegistration: notUsed,
  };
}

describe('account deletion collaboration invalidation', () => {
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('invalidates the user and owned boards only after committed deletion', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const invalidateBoard = vi.fn();
    const invalidateUser = vi.fn();
    const deleteAccount = vi.fn<AccountService['deleteAccount']>(
      async (_userId, currentPassword) =>
        currentPassword === 'correct password'
          ? {
              deletedBoardIds: ['owned-board-1', 'owned-board-2'],
              outcome: 'deleted' as const,
            }
          : { outcome: 'invalid-password' as const },
    );
    installAccountRoutes(app, {
      accounts: accountService(deleteAccount),
      collaboration: { invalidateBoard, invalidateUser },
      emailAddressValidator: {
        validate: async (email) => ({
          normalized: email.toLowerCase(),
          outcome: 'deliverable' as const,
        }),
      },
      emailSecurity: undefined,
      fixedVerificationCode: '1234-5678',
      humanVerifier: { verify: async () => ({ verified: true as const }) },
      metrics: new OperationalMetrics(),
      secureCookies: false,
      verificationEmailSender: {
        close: () => undefined,
        send: async () => ({ providerMessageId: 'test-message' }),
      },
    });

    const denied = await app.inject({
      headers: { cookie: 'chalkboard_session=active-session' },
      method: 'DELETE',
      payload: { currentPassword: 'wrong password' },
      url: '/api/account',
    });
    expect(denied.statusCode).toBe(403);
    expect(invalidateUser).not.toHaveBeenCalled();
    expect(invalidateBoard).not.toHaveBeenCalled();

    const deleted = await app.inject({
      headers: { cookie: 'chalkboard_session=active-session' },
      method: 'DELETE',
      payload: { currentPassword: 'correct password' },
      url: '/api/account',
    });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.headers['set-cookie']).toContain('Max-Age=0');
    expect(invalidateUser).toHaveBeenCalledOnce();
    expect(invalidateUser).toHaveBeenCalledWith(user.id);
    expect(invalidateBoard.mock.calls).toEqual([
      ['owned-board-1'],
      ['owned-board-2'],
    ]);
  });
});
