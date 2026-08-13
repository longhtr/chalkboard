/**
 * Authenticated personal-account mutations. Board selection and membership do
 * not belong here; sensitive identity changes require the current password.
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
import { PasswordWorkOverloadError } from '../accounts/passwordWorkController.js';
import { createVerificationCode } from '../accounts/verificationCode.js';
import type { VerificationEmailSender } from '../accounts/verificationEmail.js';
import { readSessionToken } from '../collaboration/authorization.js';
import type { EmailAddressValidator } from '../email/addressValidation.js';
import {
  logAccountEmailBookkeepingFailure,
  logAccountEmailDeliveryFailure,
} from '../email/deliveryDiagnostics.js';
import type { EmailSecurityService } from '../email/emailSecurity.js';
import { createAccountEmailWorkflows } from '../email/workflows.js';
import type { HumanVerifier } from '../humanVerification/humanVerifier.js';
import type { CollaborationGatewayControl } from '../collaboration/gateway.js';
import {
  isErrorInstance,
  readUnknownProperty,
} from '../operations/errorDiagnostics.js';
import type { OperationalMetrics } from '../operations/metrics.js';
import { writeSecurityAuditEvent } from './audit.js';
import { authenticatedUser } from './authenticatedUser.js';
import { clearSessionCookie } from './authRoutes.js';
import { passwordWorkOverloadResponse } from './passwordWorkHttp.js';

const passwordSchema = z
  .string()
  .min(MIN_ACCOUNT_PASSWORD_LENGTH)
  .max(MAX_ACCOUNT_PASSWORD_LENGTH);
const displayNameSchema = z.object({
  displayName: z.string().trim().min(1).max(MAX_ACCOUNT_DISPLAY_NAME_LENGTH),
});
const emailSchema = z.object({
  currentPassword: passwordSchema,
  email: z.email().max(MAX_ACCOUNT_EMAIL_LENGTH),
});
const emailChangeVerificationSchema = z.object({
  code: z.string().regex(/^\d{4}-\d{4}$/u),
});
const passwordChangeSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
});
const accountDeletionSchema = z.object({ currentPassword: passwordSchema });
const accountDeletionVerificationSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_ACCOUNT_PASSWORD_LENGTH),
});

function uniqueEmailConflict(error: unknown): boolean {
  return readUnknownProperty(error, 'code') === '23505';
}

/** Installs display-name, email, and password changes for the current actor. */
export function installAccountRoutes(
  app: FastifyInstance,
  {
    accounts,
    collaboration,
    emailAddressValidator,
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
      'invalidateBoard' | 'invalidateUser'
    >;
    emailAddressValidator: EmailAddressValidator;
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

  app.patch('/api/account/display-name', async (request, reply) => {
    const user = await authenticatedUser(request, reply, accounts, metrics);
    if (user === null) return;
    if (user.isDemo) {
      writeSecurityAuditEvent(request, {
        action: 'account.display-name-change',
        actorUserId: user.id,
        outcome: 'rejected',
        reason: 'not-authorized',
      });
      return reply
        .code(403)
        .send({ error: 'Demo account details cannot be changed' });
    }
    const parsed = displayNameSchema.safeParse(request.body);
    if (!parsed.success) {
      writeSecurityAuditEvent(request, {
        action: 'account.display-name-change',
        actorUserId: user.id,
        outcome: 'rejected',
        reason: 'invalid-input',
      });
      return reply.code(400).send({ error: 'Invalid display name' });
    }
    const updated = await accounts.updateDisplayName(
      user.id,
      parsed.data.displayName,
    );
    writeSecurityAuditEvent(request, {
      action: 'account.display-name-change',
      actorUserId: user.id,
      outcome: 'succeeded',
    });
    return { user: updated };
  });

  app.patch('/api/account/email', async (request, reply) => {
    const user = await authenticatedUser(request, reply, accounts, metrics);
    if (user === null) return;
    if (user.isDemo) {
      writeSecurityAuditEvent(request, {
        action: 'account.email-change',
        actorUserId: user.id,
        outcome: 'rejected',
        reason: 'not-authorized',
      });
      return reply
        .code(403)
        .send({ error: 'Demo account details cannot be changed' });
    }
    const parsed = emailSchema.safeParse(request.body);
    if (!parsed.success) {
      writeSecurityAuditEvent(request, {
        action: 'account.email-change',
        actorUserId: user.id,
        outcome: 'rejected',
        reason: 'invalid-input',
      });
      return reply.code(400).send({ error: 'Invalid email change details' });
    }
    const code = createVerificationCode(fixedVerificationCode);
    try {
      const result = await emailWorkflows.beginEmailChange({
        ...parsed.data,
        code,
        userId: user.id,
      });
      if (result.outcome !== 'accepted') {
        writeSecurityAuditEvent(request, {
          action: 'account.email-change',
          actorUserId: user.id,
          outcome: 'rejected',
          reason:
            result.outcome === 'invalid-password'
              ? 'invalid-credentials'
              : result.outcome === 'conflict'
                ? 'conflict'
                : result.outcome === 'limited'
                  ? 'rate-limited'
                  : 'invalid-input',
        });
        if (result.outcome === 'invalid-password') {
          return reply
            .code(403)
            .send({ error: 'Current password is incorrect' });
        }
        if (result.outcome === 'conflict') {
          return reply.code(409).send({
            error: 'That email cannot be used. Try another address.',
          });
        }
        if (result.outcome === 'limited') {
          return reply
            .header('retry-after', String(result.retryAfterSeconds ?? 60))
            .code(429)
            .send({ error: 'Too many email changes. Try again later.' });
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
          error: 'Email changes are temporarily unavailable. Try again later.',
        });
      }
      writeSecurityAuditEvent(request, {
        action: 'account.email-change-code',
        actorUserId: user.id,
        outcome: 'succeeded',
      });
      return reply.code(202).send({
        email: result.destination ?? parsed.data.email.trim(),
        verificationRequired: true,
      });
    } catch (error) {
      if (isErrorInstance(error, PasswordWorkOverloadError)) {
        return passwordWorkOverloadResponse(
          request,
          reply,
          metrics,
          'account.email-change',
        );
      }
      if (uniqueEmailConflict(error)) {
        writeSecurityAuditEvent(request, {
          action: 'account.email-change',
          actorUserId: user.id,
          outcome: 'rejected',
          reason: 'conflict',
        });
        return reply
          .code(409)
          .send({ error: 'An account already uses that email' });
      }
      throw error;
    }
  });

  app.post('/api/account/email/verify', async (request, reply) => {
    const user = await authenticatedUser(request, reply, accounts, metrics);
    if (user === null) return;
    if (user.isDemo) {
      writeSecurityAuditEvent(request, {
        action: 'account.email-change',
        actorUserId: user.id,
        outcome: 'rejected',
        reason: 'not-authorized',
      });
      return reply
        .code(403)
        .send({ error: 'Demo account details cannot be changed' });
    }
    const parsed = emailChangeVerificationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid verification code' });
    }
    try {
      const updated = await accounts.verifyEmailChange(
        user.id,
        parsed.data.code,
      );
      if (updated === null) {
        return reply
          .code(400)
          .send({ error: 'Verification code is incorrect or expired' });
      }
      writeSecurityAuditEvent(request, {
        action: 'account.email-change',
        actorUserId: user.id,
        outcome: 'succeeded',
      });
      return { user: updated };
    } catch (error) {
      if (isErrorInstance(error, PasswordWorkOverloadError)) {
        return passwordWorkOverloadResponse(
          request,
          reply,
          metrics,
          'account.email-change',
        );
      }
      if (uniqueEmailConflict(error)) {
        return reply
          .code(409)
          .send({ error: 'An account already uses that email' });
      }
      throw error;
    }
  });

  app.post('/api/account/deletion/verify-password', async (request, reply) => {
    const user = await authenticatedUser(request, reply, accounts, metrics);
    if (user === null) return;
    if (user.isDemo) {
      writeSecurityAuditEvent(request, {
        action: 'account.delete-authorization',
        actorUserId: user.id,
        outcome: 'rejected',
        reason: 'not-authorized',
      });
      return reply.code(403).send({ error: 'Demo accounts cannot be deleted' });
    }
    const parsed = accountDeletionVerificationSchema.safeParse(request.body);
    if (!parsed.success) {
      writeSecurityAuditEvent(request, {
        action: 'account.delete-authorization',
        actorUserId: user.id,
        outcome: 'rejected',
        reason: 'invalid-input',
      });
      return reply
        .code(400)
        .send({ error: 'Invalid account deletion details' });
    }
    try {
      const valid = await accounts.verifyCurrentPassword(
        user.id,
        parsed.data.currentPassword,
      );
      writeSecurityAuditEvent(request, {
        action: 'account.delete-authorization',
        actorUserId: user.id,
        outcome: valid ? 'succeeded' : 'rejected',
        ...(valid ? {} : { reason: 'invalid-credentials' }),
      });
      return valid
        ? reply.code(204).send()
        : reply.code(403).send({ error: 'Current password is incorrect' });
    } catch (error) {
      if (isErrorInstance(error, PasswordWorkOverloadError)) {
        return passwordWorkOverloadResponse(
          request,
          reply,
          metrics,
          'account.delete-authorization',
        );
      }
      throw error;
    }
  });

  app.delete('/api/account', async (request, reply) => {
    const user = await authenticatedUser(request, reply, accounts, metrics);
    if (user === null) return;
    if (user.isDemo) {
      writeSecurityAuditEvent(request, {
        action: 'account.delete',
        actorUserId: user.id,
        outcome: 'rejected',
        reason: 'not-authorized',
      });
      return reply.code(403).send({ error: 'Demo accounts cannot be deleted' });
    }
    const parsed = accountDeletionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid account deletion details' });
    }
    try {
      const result = await accounts.deleteAccount(
        user.id,
        parsed.data.currentPassword,
      );
      if (result.outcome !== 'deleted') {
        writeSecurityAuditEvent(request, {
          action: 'account.delete',
          actorUserId: user.id,
          outcome: 'rejected',
          reason:
            result.outcome === 'demo'
              ? 'not-authorized'
              : 'invalid-credentials',
        });
        return reply.code(403).send({
          error:
            result.outcome === 'demo'
              ? 'Demo accounts cannot be deleted'
              : 'Current password is incorrect',
        });
      }
      collaboration.invalidateUser(user.id);
      for (const boardId of result.deletedBoardIds) {
        collaboration.invalidateBoard(boardId);
      }
      writeSecurityAuditEvent(request, {
        action: 'account.delete',
        actorUserId: user.id,
        outcome: 'succeeded',
      });
      return reply
        .header('set-cookie', clearSessionCookie({ secure: secureCookies }))
        .code(204)
        .send();
    } catch (error) {
      if (isErrorInstance(error, PasswordWorkOverloadError)) {
        return passwordWorkOverloadResponse(
          request,
          reply,
          metrics,
          'account.delete',
        );
      }
      throw error;
    }
  });

  app.patch('/api/account/password', async (request, reply) => {
    const user = await authenticatedUser(request, reply, accounts, metrics);
    if (user === null) return;
    if (user.isDemo) {
      writeSecurityAuditEvent(request, {
        action: 'account.password-change',
        actorUserId: user.id,
        outcome: 'rejected',
        reason: 'not-authorized',
      });
      return reply
        .code(403)
        .send({ error: 'Demo account details cannot be changed' });
    }
    const parsed = passwordChangeSchema.safeParse(request.body);
    if (!parsed.success) {
      writeSecurityAuditEvent(request, {
        action: 'account.password-change',
        actorUserId: user.id,
        outcome: 'rejected',
        reason: 'invalid-input',
      });
      return reply.code(400).send({ error: 'Invalid password change details' });
    }
    const sessionToken = readSessionToken(request.headers.cookie);
    if (sessionToken === null) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    try {
      const changed = await accounts.updatePassword(user.id, {
        ...parsed.data,
        sessionToken,
      });
      if (!changed) {
        writeSecurityAuditEvent(request, {
          action: 'account.password-change',
          actorUserId: user.id,
          outcome: 'rejected',
          reason: 'invalid-credentials',
        });
        return reply.code(403).send({ error: 'Current password is incorrect' });
      }
      collaboration.invalidateUser(user.id);
      writeSecurityAuditEvent(request, {
        action: 'account.password-change',
        actorUserId: user.id,
        outcome: 'succeeded',
      });
      return reply.code(204).send();
    } catch (error) {
      if (isErrorInstance(error, PasswordWorkOverloadError)) {
        return passwordWorkOverloadResponse(
          request,
          reply,
          metrics,
          'account.password-change',
        );
      }
      throw error;
    }
  });
}
