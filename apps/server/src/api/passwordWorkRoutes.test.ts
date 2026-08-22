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
    attachEmailIntent: async () => false,
    boardInvitationPreference: async () => true,
    setBoardInvitationPreference: async () => true,
    beginEmailChange: overload,
    beginPasswordReset: overload,
    beginRegistration: overload,
    cancelPendingEmail: async () => undefined,
    completePasswordReset: overload,
    deleteAccount: overload,
    equalizePasswordReset: overload,
    getSession: async () => null,
    login: overload,
    logout: async () => undefined,
    markPendingEmailSent: async () => undefined,
    pendingRegistrationExists: async () => false,
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
    verifyCurrentPassword: overload,
    verifyEmailChange: overload,
    verifyRegistration: overload,
  };
}

describe('password-work route admission', () => {
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('leaves the exact provider feedback path to its signature authenticator', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
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
      emailAddressValidator: {
        validate: async (email) => ({
          normalized: email.toLowerCase(),
          outcome: 'deliverable' as const,
        }),
      },
      emailSecurity: {
        admit: async () => ({
          allowed: true as const,
          destination: { keyGeneration: 1, value: '0'.repeat(64) },
        }),
        cleanup: async () => undefined,
        completeIntent: async () => undefined,
        digestDestination: () => ({
          keyGeneration: 1,
          value: '0'.repeat(64),
        }),
        reserveSend: async () => ({
          intentId: crypto.randomUUID(),
          reserved: true as const,
        }),
        switchStatus: async () => ({
          'email-change': true,
          'password-reset': true,
          registration: true,
        }),
      },
      fixedVerificationCode: '1234-5678',
      humanVerifier: { verify: async () => ({ verified: true as const }) },
      metrics: new OperationalMetrics(),
      publicOrigin: 'https://chalkboard.example',
      secureCookies: true,
      verificationEmailSender: {
        close: () => undefined,
        send: async () => ({ providerMessageId: 'test-message' }),
      },
    });
    app.post('/api/email-feedback/resend', async (_request, reply) =>
      reply.code(204).send(),
    );

    // The provider is not a browser and sends no Origin header. With a public
    // origin configured the mutation hook rejects every Origin-less POST, so
    // this path must be exempt or every delivery event is lost to a 403 before
    // its signature is ever verified.
    const response = await app.inject({
      method: 'POST',
      payload: {},
      url: '/api/email-feedback/resend',
    });
    expect(response.statusCode).toBe(204);

    // The exemption must be that one path and nothing else.
    const other = await app.inject({
      method: 'POST',
      payload: {},
      url: '/api/auth/logout',
    });
    expect(other.statusCode).toBe(403);
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
        emailAddressValidator: {
          validate: async (email) => ({
            normalized: email.toLowerCase(),
            outcome: 'deliverable' as const,
          }),
        },
        emailSecurity: {
          admit: async ({ destination }) => ({
            allowed: true as const,
            destination: {
              keyGeneration: 1,
              value: destination.padEnd(64, '0').slice(0, 64),
            },
          }),
          cleanup: async () => undefined,
          completeIntent: async () => undefined,
          digestDestination: () => ({
            keyGeneration: 1,
            value: '0'.repeat(64),
          }),
          reserveSend: async () => ({
            intentId: crypto.randomUUID(),
            reserved: true as const,
          }),
          switchStatus: async () => ({
            'email-change': true,
            'password-reset': true,
            registration: true,
          }),
        },
        fixedVerificationCode: '1234-5678',
        humanVerifier: { verify: async () => ({ verified: true as const }) },
        metrics,
        publicOrigin: null,
        secureCookies: false,
        verificationEmailSender: {
          close: () => undefined,
          send: async () => ({ providerMessageId: 'test-message' }),
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
