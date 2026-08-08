/**
 * Authentication HTTP protocol: validated registration/login, opaque cookie
 * issuance, logout invalidation, and session restoration. Password-work
 * saturation and security audit behavior are identical across entry points.
 */
import {
  MAX_ACCOUNT_DISPLAY_NAME_LENGTH,
  MAX_ACCOUNT_EMAIL_LENGTH,
  MAX_ACCOUNT_PASSWORD_LENGTH,
  MIN_ACCOUNT_PASSWORD_LENGTH,
} from '@chalkboard/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AccountService } from '../accounts/service.js';
import { createVerificationCode } from '../accounts/verificationCode.js';
import type { VerificationEmailSender } from '../accounts/verificationEmail.js';
import { PasswordWorkOverloadError } from '../accounts/passwordWorkController.js';
import {
  readSessionToken,
  SESSION_COOKIE_NAME,
} from '../collaboration/authorization.js';
import type { CollaborationGatewayControl } from '../collaboration/gateway.js';
import type { OperationalMetrics } from '../operations/metrics.js';
import { writeSecurityAuditEvent } from './audit.js';
import { authenticatedUser } from './authenticatedUser.js';
import { passwordWorkOverloadResponse } from './passwordWorkHttp.js';
import { createRateLimiter } from './security.js';

const credentialsSchema = z.object({
  email: z.email().max(MAX_ACCOUNT_EMAIL_LENGTH),
  password: z
    .string()
    .min(MIN_ACCOUNT_PASSWORD_LENGTH)
    .max(MAX_ACCOUNT_PASSWORD_LENGTH),
});
const registrationSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(1).max(MAX_ACCOUNT_DISPLAY_NAME_LENGTH),
});
const verificationCodeSchema = z.string().regex(/^\d{4}-\d{4}$/u);
const emailVerificationSchema = z.object({
  code: verificationCodeSchema,
  email: z.email().max(MAX_ACCOUNT_EMAIL_LENGTH),
});
const passwordResetRequestSchema = z.object({
  email: z.email().max(MAX_ACCOUNT_EMAIL_LENGTH),
});
const passwordResetCompletionSchema = emailVerificationSchema.extend({
  newPassword: z
    .string()
    .min(MIN_ACCOUNT_PASSWORD_LENGTH)
    .max(MAX_ACCOUNT_PASSWORD_LENGTH),
});

function sessionCookie(token: string, { secure }: { secure: boolean }): string {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=2592000',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function clearSessionCookie({ secure }: { secure: boolean }): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/** Installs registration, login, logout, and session-restoration routes. */
export function installAuthenticationRoutes(
  app: FastifyInstance,
  {
    accounts,
    collaboration,
    metrics,
    secureCookies,
    verificationEmailSender,
    fixedVerificationCode,
  }: {
    accounts: AccountService;
    collaboration: Pick<
      CollaborationGatewayControl,
      'invalidateSession' | 'invalidateUser'
    >;
    fixedVerificationCode: string | null;
    metrics: OperationalMetrics;
    secureCookies: boolean;
    verificationEmailSender: VerificationEmailSender;
  },
): void {
  const limitLogin = createRateLimiter({ limit: 20, windowMs: 15 * 60_000 });
  // A fixed code exists only in test mode, where one process serves many
  // unrelated browser identities. Production retains the strict abuse bounds.
  const deterministicTestLimit = fixedVerificationCode === null ? null : 100;
  const limitRegistration = createRateLimiter({
    limit: deterministicTestLimit ?? 10,
    windowMs: 60 * 60_000,
  });
  const limitVerification = createRateLimiter({
    limit: deterministicTestLimit ?? 20,
    windowMs: 15 * 60_000,
  });
  const limitPasswordReset = createRateLimiter({
    limit: 10,
    windowMs: 60 * 60_000,
  });

  app.post('/api/auth/register', async (request, reply) => {
    const rate = limitRegistration(`register:${request.ip}`);
    if (!rate.allowed) {
      writeSecurityAuditEvent(request, {
        action: 'account.register',
        outcome: 'rejected',
        reason: 'rate-limited',
      });
      return reply
        .header('retry-after', String(rate.retryAfterSeconds))
        .code(429)
        .send({ error: 'Too many account attempts. Try again later.' });
    }
    const parsed = registrationSchema.safeParse(request.body);
    if (!parsed.success) {
      writeSecurityAuditEvent(request, {
        action: 'account.register',
        outcome: 'rejected',
        reason: 'invalid-input',
      });
      return reply.code(400).send({ error: 'Invalid registration details' });
    }
    const code = createVerificationCode(fixedVerificationCode);
    try {
      const pending = await accounts.beginRegistration({
        ...parsed.data,
        code,
      });
      if (!pending) {
        writeSecurityAuditEvent(request, {
          action: 'account.register',
          outcome: 'rejected',
          reason: 'conflict',
        });
        return reply
          .code(409)
          .send({ error: 'An account already uses that email' });
      }
      try {
        await verificationEmailSender.send({
          code,
          purpose: 'registration',
          to: parsed.data.email.trim(),
        });
      } catch (error) {
        request.log.error(
          { err: error },
          'Unable to deliver registration email',
        );
        return reply.code(502).send({
          error:
            'Verification email could not be sent. Check the address and try again.',
        });
      }
      writeSecurityAuditEvent(request, {
        action: 'account.registration-code',
        outcome: 'succeeded',
      });
      return reply.code(202).send({
        email: parsed.data.email.trim(),
        verificationRequired: true,
      });
    } catch (error) {
      if (error instanceof PasswordWorkOverloadError) {
        return passwordWorkOverloadResponse(
          request,
          reply,
          metrics,
          'account.register',
        );
      }
      throw error;
    }
  });

  app.post('/api/auth/verify-email', async (request, reply) => {
    const rate = limitVerification(`verify-registration:${request.ip}`);
    if (!rate.allowed) {
      return reply
        .header('retry-after', String(rate.retryAfterSeconds))
        .code(429)
        .send({ error: 'Too many verification attempts. Try again later.' });
    }
    const parsed = emailVerificationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid verification code' });
    }
    try {
      const session = await accounts.verifyRegistration(
        parsed.data.email,
        parsed.data.code,
      );
      if (session === null) {
        writeSecurityAuditEvent(request, {
          action: 'account.verify-email',
          outcome: 'rejected',
          reason: 'invalid-credentials',
        });
        return reply
          .code(400)
          .send({ error: 'Verification code is incorrect or expired' });
      }
      writeSecurityAuditEvent(request, {
        action: 'account.verify-email',
        actorUserId: session.user.id,
        outcome: 'succeeded',
      });
      return reply
        .header(
          'set-cookie',
          sessionCookie(session.token, { secure: secureCookies }),
        )
        .code(201)
        .send({ user: session.user });
    } catch (error) {
      if (error instanceof PasswordWorkOverloadError) {
        return passwordWorkOverloadResponse(
          request,
          reply,
          metrics,
          'account.verify-email',
        );
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        return reply
          .code(409)
          .send({ error: 'An account already uses that email' });
      }
      throw error;
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const rate = limitLogin(`login:${request.ip}`);
    if (!rate.allowed) {
      metrics.recordAuthenticationFailure();
      writeSecurityAuditEvent(request, {
        action: 'session.login',
        outcome: 'rejected',
        reason: 'rate-limited',
      });
      return reply
        .header('retry-after', String(rate.retryAfterSeconds))
        .code(429)
        .send({ error: 'Too many sign-in attempts. Try again later.' });
    }
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      metrics.recordAuthenticationFailure();
      writeSecurityAuditEvent(request, {
        action: 'session.login',
        outcome: 'rejected',
        reason: 'invalid-credentials',
      });
      return reply.code(401).send({ error: 'Email or password is incorrect' });
    }
    let session: Awaited<ReturnType<AccountService['login']>>;
    try {
      session = await accounts.login(parsed.data.email, parsed.data.password);
    } catch (error) {
      if (error instanceof PasswordWorkOverloadError) {
        return passwordWorkOverloadResponse(
          request,
          reply,
          metrics,
          'session.login',
        );
      }
      throw error;
    }
    if (session === null) {
      metrics.recordAuthenticationFailure();
      writeSecurityAuditEvent(request, {
        action: 'session.login',
        outcome: 'rejected',
        reason: 'invalid-credentials',
      });
      return reply.code(401).send({ error: 'Email or password is incorrect' });
    }
    writeSecurityAuditEvent(request, {
      action: 'session.login',
      actorUserId: session.user.id,
      outcome: 'succeeded',
    });
    return reply
      .header(
        'set-cookie',
        sessionCookie(session.token, { secure: secureCookies }),
      )
      .send({ user: session.user });
  });

  app.post('/api/auth/password-reset', async (request, reply) => {
    const rate = limitPasswordReset(`password-reset:${request.ip}`);
    if (!rate.allowed) {
      return reply
        .header('retry-after', String(rate.retryAfterSeconds))
        .code(429)
        .send({ error: 'Too many password reset attempts. Try again later.' });
    }
    const parsed = passwordResetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid email address' });
    }
    const code = createVerificationCode(fixedVerificationCode);
    try {
      const destination = await accounts.beginPasswordReset(
        parsed.data.email,
        code,
      );
      if (destination !== null) {
        // Delivery continues after the indistinguishable public response so
        // delivery latency cannot reveal whether the address has an account.
        void verificationEmailSender
          .send({ code, purpose: 'password-reset', to: destination })
          .catch((error: unknown) => {
            request.log.error(
              { err: error },
              'Unable to deliver password reset email',
            );
          });
      }
      // Known and unknown addresses deliberately receive the same response.
      return reply.code(202).send({ verificationRequired: true });
    } catch (error) {
      if (error instanceof PasswordWorkOverloadError) {
        return passwordWorkOverloadResponse(
          request,
          reply,
          metrics,
          'account.password-reset-request',
        );
      }
      throw error;
    }
  });

  app.post('/api/auth/password-reset/complete', async (request, reply) => {
    const rate = limitVerification(`verify-password-reset:${request.ip}`);
    if (!rate.allowed) {
      return reply
        .header('retry-after', String(rate.retryAfterSeconds))
        .code(429)
        .send({ error: 'Too many verification attempts. Try again later.' });
    }
    const parsed = passwordResetCompletionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid password reset details' });
    }
    try {
      const userId = await accounts.completePasswordReset(parsed.data);
      if (userId === null) {
        return reply
          .code(400)
          .send({ error: 'Verification code is incorrect or expired' });
      }
      collaboration.invalidateUser(userId);
      writeSecurityAuditEvent(request, {
        action: 'account.password-reset',
        actorUserId: userId,
        outcome: 'succeeded',
      });
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof PasswordWorkOverloadError) {
        return passwordWorkOverloadResponse(
          request,
          reply,
          metrics,
          'account.password-reset',
        );
      }
      throw error;
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = readSessionToken(request.headers.cookie);
    const user = token === null ? null : await accounts.getSession(token);
    if (token !== null) await accounts.logout(token);
    if (token !== null && user !== null) collaboration.invalidateSession(token);
    writeSecurityAuditEvent(request, {
      action: 'session.logout',
      ...(user === null ? {} : { actorUserId: user.id }),
      outcome: 'succeeded',
    });
    return reply
      .header('set-cookie', clearSessionCookie({ secure: secureCookies }))
      .code(204)
      .send();
  });

  app.get('/api/session', async (request, reply) => {
    const user = await authenticatedUser(request, reply, accounts, metrics);
    if (user === null) return;
    return { user };
  });
}
