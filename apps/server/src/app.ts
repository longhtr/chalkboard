/**
 * Composes the complete Fastify application and owns its drain lifecycle.
 * Security headers, API routes, collaboration, health, metrics, and database
 * shutdown are wired here; domain algorithms remain in their owning modules.
 */
import {
  CHALKBOARD_SCHEMA_VERSIONS,
  SERVICE_NAME,
  type LiveHealthResponse,
  type ApplicationDiagnostics,
  type NotReadyHealthResponse,
  type ReadyHealthResponse,
} from '@chalkboard/shared';
import Fastify from 'fastify';

import {
  createVerificationEmailSender,
  type VerificationEmailSender,
} from './accounts/verificationEmail.js';
import { installApiRoutes } from './api/routes.js';
import { installCollaborationGateway } from './collaboration/gateway.js';
import type { AppConfig } from './config.js';
import { createDatabase, type Database } from './db/database.js';
import { OperationalMetrics } from './operations/metrics.js';
import { serverLoggerOptions } from './operations/serverLogger.js';

interface BuildAppOptions {
  config: AppConfig;
  database?: Database;
  verificationEmailSender?: VerificationEmailSender;
}

function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Composes one Fastify process and its independent HTTP, collaboration,
 * database, health, security-header, and drain boundaries.
 */
export function buildApp({
  config,
  database: injectedDatabase,
  verificationEmailSender: injectedVerificationEmailSender,
}: BuildAppOptions) {
  if (config.nodeEnv === 'production' && config.publicOrigin === null) {
    throw new Error('PUBLIC_ORIGIN is required in production');
  }
  if (config.nodeEnv === 'production' && config.publicOrigin !== null) {
    const origin = new URL(config.publicOrigin);
    if (
      origin.protocol !== 'https:' &&
      !['127.0.0.1', '::1', 'localhost'].includes(origin.hostname)
    ) {
      throw new Error('PUBLIC_ORIGIN must use HTTPS in production');
    }
  }
  if (
    config.nodeEnv === 'production' &&
    config.applicationCommit === 'development'
  ) {
    throw new Error('CHALKBOARD_COMMIT is required in production');
  }
  const database =
    injectedDatabase ??
    createDatabase(config.databaseUrl, config.passwordWorkLimits);
  const ownsDatabase = injectedDatabase === undefined;
  const metrics = new OperationalMetrics();
  let draining = false;
  const app = Fastify({
    bodyLimit: 64 * 1_024,
    connectionTimeout: 10_000,
    keepAliveTimeout: 72_000,
    requestTimeout: 30_000,
    trustProxy: config.nodeEnv === 'production' ? config.trustProxyHops : false,
    logger:
      config.nodeEnv === 'test' ? false : serverLoggerOptions(config.logLevel),
  });

  const verificationEmailSender =
    injectedVerificationEmailSender ??
    createVerificationEmailSender(
      // Deterministic test codes must never trigger external email delivery,
      // even when a developer's root .env names a real sender identity.
      config.nodeEnv === 'test' ? null : config.verificationEmail,
      (subject, to) => {
        app.log.info({ subject, to }, 'Development verification email');
      },
    );
  // Reachability must not gate serving. Collaboration, boards, and every
  // non-account route work without email, so a provider outage or DNS blip
  // would otherwise stop every instance from starting — including rolling
  // restarts. Configuration completeness is already enforced in `loadConfig`;
  // an unreachable transport surfaces on the account routes that use it.
  app.addHook('onReady', async () => {
    try {
      await verificationEmailSender.verify();
    } catch (error) {
      app.log.error({ error }, 'Verification email transport is unavailable');
    }
  });
  app.addHook('onClose', () => verificationEmailSender.close());

  if (config.nodeEnv === 'production') {
    const acquireRuntimeLock = database.acquireRuntimeLock;
    if (acquireRuntimeLock === undefined) {
      throw new Error('Production database runtime lock is unavailable');
    }
    app.addHook('onReady', () => acquireRuntimeLock.call(database));
  }

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-request-id', request.id);
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('cross-origin-resource-policy', 'same-origin');
    reply.header(
      'permissions-policy',
      'camera=(), microphone=(), geolocation=()',
    );
    if (!reply.hasHeader('content-security-policy')) {
      reply.header(
        'content-security-policy',
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
    }
    if (request.url.startsWith('/api/') && !reply.hasHeader('cache-control')) {
      reply.header('cache-control', 'no-store');
    }
    if (config.nodeEnv === 'production') {
      reply.header(
        'strict-transport-security',
        'max-age=31536000; includeSubDomains',
      );
    }
    return payload;
  });

  app.addHook('onResponse', (_request, reply, done) => {
    metrics.recordHttpResponse(reply.statusCode);
    done();
  });

  const collaborationGateway = installCollaborationGateway(app, {
    authorization: database.collaborationAuthorization,
    compactionLimits: config.collaborationCompactionLimits,
    compactionUpdateThreshold: config.collaborationCompactionUpdateThreshold,
    documentLimits: config.collaborationDocumentLimits,
    metrics,
    persistence: database.collaboration,
    persistenceQueueLimits: config.collaborationPersistenceQueueLimits,
    publicOrigin: config.publicOrigin,
  });
  installApiRoutes(app, {
    accounts: database.accounts,
    apiRequestConcurrencyLimit: config.apiRequestConcurrencyLimit,
    assetUploadConcurrencyLimit: config.assetUploadConcurrencyLimit,
    assets: database.assets,
    boards: database.boards,
    collaboration: collaborationGateway,
    metrics,
    publicOrigin: config.publicOrigin,
    secureCookies: config.nodeEnv === 'production',
    verificationEmailSender,
    fixedVerificationCode: config.nodeEnv === 'test' ? '1234-5678' : null,
  });

  app.get('/api', async () => ({
    name: 'Chalkboard API',
    version: config.applicationVersion,
  }));

  app.get('/api/diagnostics', async (): Promise<ApplicationDiagnostics> => ({
    commit: config.applicationCommit,
    name: 'Chalkboard',
    schemas: CHALKBOARD_SCHEMA_VERSIONS,
    version: config.applicationVersion,
  }));

  app.get('/health/live', async (): Promise<LiveHealthResponse> => ({
    service: SERVICE_NAME,
    status: 'ok',
    timestamp: timestamp(),
  }));

  app.get('/health/ready', async (request, reply) => {
    if (draining) {
      const response: NotReadyHealthResponse = {
        service: SERVICE_NAME,
        status: 'not_ready',
        timestamp: timestamp(),
      };
      return reply.code(503).send(response);
    }
    try {
      await database.ping();

      const response: ReadyHealthResponse = {
        service: SERVICE_NAME,
        status: 'ready',
        timestamp: timestamp(),
      };
      return response;
    } catch (error) {
      request.log.error({ error }, 'Database readiness check failed');
      const response: NotReadyHealthResponse = {
        service: SERVICE_NAME,
        status: 'not_ready',
        timestamp: timestamp(),
      };
      return reply.code(503).send(response);
    }
  });

  app.get('/metrics', async (_request, reply) =>
    reply
      .header('cache-control', 'no-store')
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(
        metrics.renderPrometheus({
          collaboration: collaborationGateway.metricsSnapshot(),
          database: database.metricsSnapshot?.(),
          draining,
        }),
      ),
  );

  const beginDrain = () => {
    if (draining) return;
    draining = true;
    metrics.recordDrainStarted();
    collaborationGateway.beginDrain();
  };
  app.addHook('onClose', () => beginDrain());

  if (ownsDatabase) {
    app.addHook('onClose', async () => {
      await database.close();
    });
  }
  return Object.assign(app, {
    beginDrain,
    invalidateCollaborationBoard: collaborationGateway.invalidateBoard,
    invalidateCollaborationSession: collaborationGateway.invalidateSession,
  });
}
