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
import type { AssetService } from '../assets/service.js';
import type { BoardService } from '../boards/service.js';
import type { CollaborationGatewayControl } from '../collaboration/gateway.js';
import type { OperationalMetrics } from '../operations/metrics.js';
import { installAccountRoutes } from './accountRoutes.js';
import { installAuthenticationRoutes } from './authRoutes.js';
import { installBoardRoutes } from './boardRoutes.js';
import { installBoardTrashRoutes } from './boardTrashRoutes.js';
import { installBoardInviteRoutes } from './inviteRoutes.js';
import { installMemberRoutes } from './memberRoutes.js';
import { installApiCapacityAdmission } from './requestAdmission.js';
import { createRateLimiter, requestOriginIsAllowed } from './security.js';

const resourceIdSchema = z.uuid();

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

  // Mutation origin and address-rate checks run before body or route work.
  app.addHook('onRequest', async (request, reply) => {
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
    metrics,
    secureCookies,
    verificationEmailSender,
    fixedVerificationCode,
  });
  installAccountRoutes(app, {
    accounts,
    collaboration,
    metrics,
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
