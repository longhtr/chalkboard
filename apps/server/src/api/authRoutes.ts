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
import type { EmailAddressValidator } from '../email/addressValidation.js';
import {
  logAccountEmailBookkeepingFailure,
  logAccountEmailDeliveryFailure,
} from '../email/deliveryDiagnostics.js';
import type { EmailSecurityService } from '../email/emailSecurity.js';
import { createAccountEmailWorkflows } from '../email/workflows.js';
import type { HumanVerifier } from '../humanVerification/humanVerifier.js';
import {
  readSessionToken,
  SESSION_COOKIE_NAME,
} from '../collaboration/authorization.js';
import type { CollaborationGatewayControl } from '../collaboration/gateway.js';
import {
  isErrorInstance,
  readUnknownProperty,
} from '../operations/errorDiagnostics.js';
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
const humanTokenSchema = z.string().min(1).max(2_048);
const registrationSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(1).max(MAX_ACCOUNT_DISPLAY_NAME_LENGTH),
  humanVerificationToken: humanTokenSchema.optional(),
});
const verificationCodeSchema = z.string().regex(/^\d{4}-\d{4}$/u);
const emailVerificationSchema = z.object({
  code: verificationCodeSchema,
  email: z.email().max(MAX_ACCOUNT_EMAIL_LENGTH),
});
const passwordResetRequestSchema = z.object({
  email: z.email().max(MAX_ACCOUNT_EMAIL_LENGTH),
  humanVerificationToken: humanTokenSchema.optional(),
});
const passwordResetCompletionSchema = emailVerificationSchema.extend({
  newPassword: z
    .string()
    .min(MIN_ACCOUNT_PASSWORD_LENGTH)
    .max(MAX_ACCOUNT_PASSWORD_LENGTH),
});

function registrationAccepted(email: string) {
  return {
    email: email.trim().toLocaleLowerCase('en-US'),
    verificationRequired: true as const,
  };
}

function accountCeilingExceeded(error: unknown): boolean {
  return (
    readUnknownProperty(error, 'code') === 'P0001' &&
    readUnknownProperty(error, 'message') === 'account_ceiling_exceeded'
  );
}

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

export function clearSessionCookie({ secure }: { secure: boolean }): string {
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
    emailAddressValidator,
    emailRateLimitMultiplier = 1,
    emailSecurity,
    humanVerifier,
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
    emailAddressValidator: EmailAddressValidator;
    emailRateLimitMultiplier?: number;
    emailSecurity: EmailSecurityService | undefined;
    fixedVerificationCode: string | null;
    humanVerifier: HumanVerifier;
    metrics: OperationalMetrics;
    secureCookies: boolean;
    verificationEmailSender: VerificationEmailSender;
  },
): void {
  const emailWorkflows = createAccountEmailWorkflows({
    accounts,
    addressValidator: emailAddressValidator,
    ...(emailSecurity === undefined ? {} : { emailSecurity }),
    humanVerifier,
    onBackgroundError: (diagnostic) =>
      logAccountEmailBookkeepingFailure(app.log, diagnostic),
    onDeliveryFailure: (diagnostic) =>
      logAccountEmailDeliveryFailure(app.log, diagnostic),
    sender: verificationEmailSender,
  });
  const limitLogin = createRateLimiter({ limit: 20, windowMs: 15 * 60_000 });
  // Test and local-development processes serve many unrelated browser
  // identities. Production passes one and retains the strict abuse bounds.
  if (
    !Number.isInteger(emailRateLimitMultiplier) ||
    emailRateLimitMultiplier < 1 ||
    emailRateLimitMultiplier > 100
  ) {
    throw new Error('Invalid email route limit multiplier');
  }
  const routeLimitMultiplier =
    fixedVerificationCode === null ? emailRateLimitMultiplier : 100;
  const limitRegistrationHour = createRateLimiter({
    limit: 3 * routeLimitMultiplier,
    windowMs: 60 * 60_000,
  });
  const limitRegistrationDay = createRateLimiter({
    limit: 10 * routeLimitMultiplier,
    windowMs: 24 * 60 * 60_000,
  });
  const limitVerification = createRateLimiter({
    limit: 20 * routeLimitMultiplier,
    windowMs: 15 * 60_000,
  });
  const limitPasswordResetHour = createRateLimiter({
    limit: 3 * routeLimitMultiplier,
    windowMs: 60 * 60_000,
  });
  const limitPasswordResetDay = createRateLimiter({
    limit: 10 * routeLimitMultiplier,
    windowMs: 24 * 60 * 60_000,
  });

  app.post('/api/auth/register', async (request, reply) => {
    const hourlyRate = limitRegistrationHour(`register:${request.ip}`);
    const dailyRate = limitRegistrationDay(`register:${request.ip}`);
    if (!hourlyRate.allowed || !dailyRate.allowed) {
      writeSecurityAuditEvent(request, {
        action: 'account.register',
        outcome: 'rejected',
        reason: 'rate-limited',
      });
      return reply
        .header(
          'retry-after',
          String(
            Math.max(hourlyRate.retryAfterSeconds, dailyRate.retryAfterSeconds),
          ),
        )
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
      const result = await emailWorkflows.beginRegistration({
        ...parsed.data,
        code,
        humanToken:
          parsed.data.humanVerificationToken ??
          (fixedVerificationCode === null
            ? ''
            : 'development-human-verification'),
        ip: request.ip,
      });
      if (result.outcome === 'conflict') {
        // Existing and available destinations have the same public status and
        // body. No provider call occurs for the existing account, and neither
        // the response nor audit stream becomes an account-existence oracle.
        writeSecurityAuditEvent(request, {
          action: 'account.registration-request',
          outcome: 'succeeded',
        });
        return reply.code(202).send(registrationAccepted(parsed.data.email));
      }
      if (result.outcome !== 'accepted') {
        writeSecurityAuditEvent(request, {
          action: 'account.register',
          outcome: 'rejected',
          reason:
            result.outcome === 'limited' ? 'rate-limited' : 'invalid-input',
        });
        if (result.outcome === 'limited') {
          return reply
            .header('retry-after', String(result.retryAfterSeconds ?? 60))
            .code(429)
            .send({ error: 'Too many account attempts. Try again later.' });
        }
        if (result.outcome === 'human-verification') {
          return reply
            .code(400)
            .send({ error: 'Complete the human verification and try again.' });
        }
        if (result.outcome === 'invalid-address') {
          return reply
            .code(400)
            .send({ error: 'This email domain cannot receive mail.' });
        }
        if (result.outcome === 'role-address') {
          return reply.code(400).send({
            error:
              'Use a personal mailbox rather than a protected role address.',
          });
        }
        return reply.code(503).send({
          error: 'New accounts are temporarily unavailable. Try again later.',
        });
      }
      writeSecurityAuditEvent(request, {
        action: 'account.registration-request',
        outcome: 'succeeded',
      });
      return reply.code(202).send(registrationAccepted(parsed.data.email));
    } catch (error) {
      if (isErrorInstance(error, PasswordWorkOverloadError)) {
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
      if (isErrorInstance(error, PasswordWorkOverloadError)) {
        return passwordWorkOverloadResponse(
          request,
          reply,
          metrics,
          'account.verify-email',
        );
      }
      if (accountCeilingExceeded(error)) {
        return reply.code(503).send({
          error: 'New accounts are temporarily unavailable',
        });
      }
      if (readUnknownProperty(error, 'code') === '23505') {
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
      if (isErrorInstance(error, PasswordWorkOverloadError)) {
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
    const hourlyRate = limitPasswordResetHour(`password-reset:${request.ip}`);
    const dailyRate = limitPasswordResetDay(`password-reset:${request.ip}`);
    if (!hourlyRate.allowed || !dailyRate.allowed) {
      return reply
        .header(
          'retry-after',
          String(
            Math.max(hourlyRate.retryAfterSeconds, dailyRate.retryAfterSeconds),
          ),
        )
        .code(429)
        .send({ error: 'Too many password reset attempts. Try again later.' });
    }
    const parsed = passwordResetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid email address' });
    }
    const code = createVerificationCode(fixedVerificationCode);
    try {
      const result = await emailWorkflows.beginPasswordReset({
        code,
        email: parsed.data.email,
        humanToken:
          parsed.data.humanVerificationToken ??
          (fixedVerificationCode === null
            ? ''
            : 'development-human-verification'),
        ip: request.ip,
      });
      if (result.outcome === 'human-verification') {
        return reply
          .code(400)
          .send({ error: 'Complete the human verification and try again.' });
      }
      if (result.outcome === 'unavailable') {
        return reply.code(503).send({
          error: 'Password reset is temporarily unavailable. Try again later.',
        });
      }
      // Known, unknown, suppressed, and destination-limited addresses
      // deliberately receive the same response.
      return reply.code(202).send({ verificationRequired: true });
    } catch (error) {
      if (isErrorInstance(error, PasswordWorkOverloadError)) {
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
      if (isErrorInstance(error, PasswordWorkOverloadError)) {
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
