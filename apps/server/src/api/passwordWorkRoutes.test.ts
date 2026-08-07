/** Proves registration/login convert password-work saturation into consistent 503 responses and metrics. */
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountService } from '../accounts/service.js';
import { PasswordWorkOverloadError } from '../accounts/passwordWorkController.js';
import type { BoardService } from '../boards/service.js';
import { OperationalMetrics } from '../operations/metrics.js';
import { installApiRoutes } from './routes.js';

const apps: ReturnType<typeof Fastify>[] = [];

function overloadedAccounts(): AccountService {
  const overload = async () => {
    throw new PasswordWorkOverloadError();
  };
  return {
    beginEmailChange: overload,
    beginPasswordReset: overload,
    beginRegistration: overload,
    completePasswordReset: overload,
    getSession: async () => null,
    login: overload,
    logout: async () => undefined,
    passwordWorkSnapshot: () => ({
      active: 0,
      concurrent: 1,
      pending: 0,
      queued: 0,
    }),
    updateDisplayName: async () => {
      throw new Error('not used');
    },
    updatePassword: overload,
    verifyEmailChange: overload,
    verifyRegistration: overload,
  };
}

describe('password-work route admission', () => {
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  for (const example of [
    {
      action: 'register',
      payload: {
        displayName: 'Load user',
        email: 'load@example.com',
        password: 'correct horse battery staple',
      },
    },
    {
      action: 'login',
      payload: {
        email: 'load@example.com',
        password: 'correct horse battery staple',
      },
    },
  ] as const) {
    it(`returns explicit backpressure for ${example.action}`, async () => {
      const app = Fastify({ logger: false });
      apps.push(app);
      const metrics = new OperationalMetrics();
      const overload = vi.spyOn(metrics, 'recordPasswordWorkOverload');
      installApiRoutes(app, {
        accounts: overloadedAccounts(),
        apiRequestConcurrencyLimit: 128,
        assetUploadConcurrencyLimit: 4,
        assets: undefined,
        boards: {} as BoardService,
        collaboration: {
          invalidateBoard: () => undefined,
          invalidateSession: () => undefined,
          invalidateUser: () => undefined,
        },
        fixedVerificationCode: '1234-5678',
        metrics,
        publicOrigin: null,
        secureCookies: false,
        verificationEmailSender: {
          close: () => undefined,
          send: async () => undefined,
          verify: async () => undefined,
        },
      });

      const response = await app.inject({
        method: 'POST',
        payload: example.payload,
        url: `/api/auth/${example.action}`,
      });

      expect(response.statusCode).toBe(503);
      expect(response.headers['retry-after']).toBe('1');
      expect(response.json()).toEqual({
        error: 'Authentication capacity is busy. Try again shortly.',
      });
      expect(overload).toHaveBeenCalledOnce();
    });
  }
});
