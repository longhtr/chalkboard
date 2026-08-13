/**
 * Installs API-wide origin, rate, capacity, and UUID admission before composing
 * focused authentication, board, membership, invitation, trash, and asset
 * routers. This module owns shared policy, not endpoint behavior.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AccountService } from '../accounts/service.js';
import type { VerificationEmailSender } from '../accounts/verificationEmail.js';
import { installAssetRoutes } from '../assets/routes.js';
import type { EmailAddressValidator } from '../email/addressValidation.js';
import type { EmailSecurityService } from '../email/emailSecurity.js';
import type { HumanVerifier } from '../humanVerification/humanVerifier.js';
import type { AssetService } from '../assets/service.js';
import type { BoardService } from '../boards/service.js';
import type { CollaborationGatewayControl } from '../collaboration/gateway.js';
import type { OperationalMetrics } from '../operations/metrics.js';
import { installAccountRoutes } from './accountRoutes.js';
import { authenticatedUser } from './authenticatedUser.js';
import { installAuthenticationRoutes } from './authRoutes.js';
import { installBoardRoutes } from './boardRoutes.js';
import { installBoardTrashRoutes } from './boardTrashRoutes.js';
import { installBoardInviteRoutes } from './inviteRoutes.js';
import { installMemberRoutes } from './memberRoutes.js';
import { installApiCapacityAdmission } from './requestAdmission.js';
import { createRateLimiter, requestOriginIsAllowed } from './security.js';

const resourceIdSchema = z.uuid();
/** Maximum metadata/content API mutations per public demo identity per minute. */
export const MAX_DEMO_API_MUTATIONS_PER_MINUTE = 120;
/** Maximum metadata/content API mutations across all demos per minute. */
const MAX_DEMO_API_MUTATIONS_PER_MINUTE_GLOBAL = 300;

/**
 * Installs shared API admission before delegating each HTTP sub-protocol to its
 * owning route module. Browser role state is never trusted by these handlers.
 */
export function installApiRoutes(
  app: FastifyInstance,
  options: {
    accounts: AccountService | undefined;
    apiRequestConcurrencyLimit: number;
    assetUploadConcurrencyLimit: number;
    assets: AssetService | undefined;
    boards: BoardService | undefined;
    collaboration: Pick<
      CollaborationGatewayControl,
      'invalidateBoard' | 'invalidateSession' | 'invalidateUser'
    >;
    emailAddressValidator: EmailAddressValidator;
    emailRateLimitMultiplier?: number;
    emailSecurity: EmailSecurityService | undefined;
    humanVerifier: HumanVerifier;
    metrics: OperationalMetrics;
    publicOrigin: string | null;
    secureCookies: boolean;
    verificationEmailSender: VerificationEmailSender;
    fixedVerificationCode: string | null;
  },
): void {
  const {
    accounts,
    apiRequestConcurrencyLimit,
    assetUploadConcurrencyLimit,
    assets,
    boards,
    collaboration,
    emailAddressValidator,
    emailRateLimitMultiplier = 1,
    emailSecurity,
    humanVerifier,
    metrics,
    publicOrigin,
    secureCookies,
    verificationEmailSender,
    fixedVerificationCode,
  } = options;
  if (accounts === undefined || boards === undefined) return;

  const limitApiMutations = createRateLimiter({
    limit: 300,
    windowMs: 60_000,
  });
  const limitDemoUserMutations = createRateLimiter({
    limit: MAX_DEMO_API_MUTATIONS_PER_MINUTE,
    windowMs: 60_000,
  });
  const limitDemoGlobalMutations = createRateLimiter({
    limit: MAX_DEMO_API_MUTATIONS_PER_MINUTE_GLOBAL,
    windowMs: 60_000,
  });

  // Mutation origin and address-rate checks run before body or route work.
  app.addHook('onRequest', async (request, reply) => {
    // SNS is not a browser and sends no Origin header. This exact endpoint has
    // its own signature/topic authentication before any SES event is parsed.
    if (request.url === '/api/email-feedback/ses') return;
    if (
      !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) ||
      !request.url.startsWith('/api/')
    ) {
      return;
    }
    const forwardedHostHeader = request.headers['x-forwarded-host'];
    const forwardedHost = Array.isArray(forwardedHostHeader)
      ? forwardedHostHeader[0]
      : forwardedHostHeader;
    if (
      !requestOriginIsAllowed({
        ...(publicOrigin === null ? {} : { expectedOrigin: publicOrigin }),
        ...(forwardedHost === undefined ? {} : { forwardedHost }),
        ...(request.headers.host === undefined
          ? {}
          : { host: request.headers.host }),
        ...(request.headers.origin === undefined
          ? {}
          : { origin: request.headers.origin }),
      })
    ) {
      return reply.code(403).send({ error: 'Request origin not allowed' });
    }
    const rate = limitApiMutations(`mutation:${request.ip}`);
    if (!rate.allowed) {
      return reply
        .header('retry-after', String(rate.retryAfterSeconds))
        .code(429)
        .send({ error: 'Too many requests. Try again shortly.' });
    }
  });

  installApiCapacityAdmission(app, {
    apiRequests: apiRequestConcurrencyLimit,
    assetUploads: assets === undefined ? null : assetUploadConcurrencyLimit,
    metrics,
  });

  // Shared demo identities retain full cloud behavior, but one credential may
  // represent many visitors. Bound their server-side writes independently from
  // the client-address gate above; request-local auth caching avoids a second
  // session query inside the route.
  app.addHook('preHandler', async (request, reply) => {
    if (
      !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) ||
      !(
        request.url === '/api/boards' ||
        request.url.startsWith('/api/boards/') ||
        request.url.startsWith('/api/board-invites/') ||
        request.url.startsWith('/api/account/') ||
        request.url === '/api/account'
      )
    ) {
      return;
    }
    const user = await authenticatedUser(request, reply, accounts, metrics);
    if (user === null) return reply;
    if (!user.isDemo) return;
    const userRate = limitDemoUserMutations(`demo:${user.id}`);
    if (!userRate.allowed) {
      return reply
        .header('retry-after', String(userRate.retryAfterSeconds))
        .code(429)
        .send({ error: 'Demo activity limit reached. Try again shortly.' });
    }
    // A user already over its independent ceiling must not consume the shared
    // budget and deny the other public demo identities their own allowance.
    const globalRate = limitDemoGlobalMutations('demo:global');
    if (!globalRate.allowed) {
      return reply
        .header('retry-after', String(globalRate.retryAfterSeconds))
        .code(429)
        .send({ error: 'Demo activity limit reached. Try again shortly.' });
    }
  });

  // Every identifier below this hook is a UUID before an owner queries it.
  app.addHook('preValidation', async (request, reply) => {
    if (!request.url.startsWith('/api/boards/')) return;
    const parameters: unknown = request.params;
    if (
      typeof parameters !== 'object' ||
      parameters === null ||
      Object.values(parameters).some(
        (value) =>
          typeof value !== 'string' ||
          !resourceIdSchema.safeParse(value).success,
      )
    ) {
      return reply.code(400).send({ error: 'Invalid resource identifier' });
    }
  });

  installAuthenticationRoutes(app, {
    accounts,
    collaboration,
    emailAddressValidator,
    emailRateLimitMultiplier,
    emailSecurity,
    humanVerifier,
    metrics,
    secureCookies,
    verificationEmailSender,
    fixedVerificationCode,
  });
  installAccountRoutes(app, {
    accounts,
    collaboration,
    emailAddressValidator,
    emailSecurity,
    humanVerifier,
    metrics,
    secureCookies,
    verificationEmailSender,
    fixedVerificationCode,
  });
  installBoardRoutes(app, { accounts, boards, metrics });
  installMemberRoutes(app, { accounts, boards, collaboration, metrics });
  installBoardInviteRoutes(app, {
    accounts,
    boards,
    collaboration,
    metrics,
  });
  installBoardTrashRoutes(app, {
    accounts,
    boards,
    collaboration,
    metrics,
  });
  if (assets !== undefined) {
    installAssetRoutes(app, { accounts, assets, metrics });
  }
}
