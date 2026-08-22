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
import Fastify, { LogController } from 'fastify';

import {
  createDevelopmentVerificationEmailSender,
  createUnavailableVerificationEmailSender,
  type DevelopmentEmailInbox,
  type VerificationEmailSender,
} from './accounts/verificationEmail.js';
import { createResendVerificationEmailSender } from './accounts/resendVerificationEmail.js';
import { createResendWebhookVerifier } from './email/resendFeedback.js';
import { installResendFeedbackRoutes } from './api/resendFeedbackRoutes.js';
import { installApiRoutes } from './api/routes.js';
import { installCollaborationGateway } from './collaboration/gateway.js';
import type { AppConfig } from './config.js';
import { createDatabase, type Database } from './db/database.js';
import { startDemoSandboxMaintenance } from './demo/demoSandbox.js';
import {
  createEmailAddressValidator,
  createTestEmailAddressValidator,
  type EmailAddressValidator,
} from './email/addressValidation.js';
import {
  developmentApplicationSecurityMaterial,
  loadApplicationSecurityMaterial,
  loadResendMaterial,
} from './email/applicationSecurity.js';
import { startEmailSecurityMaintenance } from './email/emailSecurity.js';
import {
  createDevelopmentHumanVerifier,
  createTurnstileHumanVerifier,
  createUnavailableHumanVerifier,
  type HumanVerifier,
} from './humanVerification/humanVerifier.js';
import { OperationalMetrics } from './operations/metrics.js';
import {
  logOperationalError,
  readUnknownProperty,
} from './operations/errorDiagnostics.js';
import {
  logDnsProviderFailure,
  logTurnstileProviderFailure,
} from './operations/externalProviderLogger.js';
import { serverLoggerOptions } from './operations/serverLogger.js';

interface BuildAppOptions {
  config: AppConfig;
  database?: Database;
  emailAddressValidator?: EmailAddressValidator;
  humanVerifier?: HumanVerifier;
  verificationEmailSender?: VerificationEmailSender;
}

function timestamp(): string {
  return new Date().toISOString();
}

function isLoopbackAddress(value: string): boolean {
  return (
    value === '::1' ||
    value.startsWith('127.') ||
    value.toLocaleLowerCase('en-US').startsWith('::ffff:127.')
  );
}

/**
 * Composes one Fastify process and its independent HTTP, collaboration,
 * database, health, security-header, and drain boundaries.
 */
export function buildApp({
  config,
  database: injectedDatabase,
  emailAddressValidator: injectedEmailAddressValidator,
  humanVerifier: injectedHumanVerifier,
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
  let applicationSecurityFailure: unknown = null;
  const applicationSecurity =
    config.nodeEnv === 'production'
      ? loadApplicationSecurityMaterial(config.applicationSecurity, (error) => {
          applicationSecurityFailure = error;
        })
      : developmentApplicationSecurityMaterial();
  const database =
    injectedDatabase ??
    createDatabase(
      config.databaseUrl,
      config.passwordWorkLimits,
      applicationSecurity,
      config.nodeEnv === 'production'
        ? undefined
        : {
            'email-change': true,
            'password-reset': true,
            registration: true,
          },
      config.emailCapacityLimits,
      config.accountRegistrationLimit,
      config.nodeEnv === 'production' ? 1 : 100,
    );
  const ownsDatabase = injectedDatabase === undefined;
  const metrics = new OperationalMetrics();
  let draining = false;
  const app = Fastify({
    bodyLimit: 64 * 1_024,
    connectionTimeout: 10_000,
    keepAliveTimeout: 72_000,
    logController: new LogController({ disableRequestLogging: true }),
    requestTimeout: 30_000,
    trustProxy: config.nodeEnv === 'production' ? config.trustProxyHops : false,
    logger:
      config.nodeEnv === 'test' ? false : serverLoggerOptions(config.logLevel),
  });
  app.setErrorHandler((error, request, reply) => {
    const rawStatusCode = readUnknownProperty(error, 'statusCode');
    const candidateStatusCode =
      typeof rawStatusCode === 'number' ? rawStatusCode : null;
    const statusCode =
      candidateStatusCode !== null &&
      Number.isInteger(candidateStatusCode) &&
      candidateStatusCode >= 400 &&
      candidateStatusCode < 500
        ? candidateStatusCode
        : 500;
    if (statusCode >= 500) {
      logOperationalError(request.log, 'http.unhandled', error);
    }
    return reply.code(statusCode).send({
      error:
        statusCode >= 500
          ? 'Internal Server Error'
          : statusCode === 413
            ? 'Request body is too large'
            : 'Invalid request',
      requestId: request.id,
    });
  });
  if (config.nodeEnv === 'production' && applicationSecurity === null) {
    if (applicationSecurityFailure !== null) {
      logOperationalError(
        app.log,
        'application-security.materialization',
        applicationSecurityFailure,
      );
    }
    app.log.warn(
      'Application security material is unavailable; email-triggering flows will fail closed',
    );
  }

  let resendMaterialFailure: unknown = null;
  const resendConfiguration = config.resendEmail;
  const resendMaterial =
    config.nodeEnv === 'production'
      ? loadResendMaterial(resendConfiguration, (error) => {
          resendMaterialFailure = error;
        })
      : null;
  /** Non-null only when both the configuration and its credentials are usable. */
  const resendDelivery =
    resendConfiguration === null || resendMaterial === null
      ? null
      : { ...resendConfiguration, ...resendMaterial };
  if (
    config.nodeEnv === 'production' &&
    resendConfiguration !== null &&
    resendMaterial === null
  ) {
    if (resendMaterialFailure !== null) {
      logOperationalError(
        app.log,
        'application-security.resend-materialization',
        resendMaterialFailure,
      );
    }
    app.log.warn(
      'Resend credentials are unavailable; email delivery will fail closed',
    );
  }

  let developmentEmailInbox: DevelopmentEmailInbox | null = null;
  let verificationEmailSender = injectedVerificationEmailSender;
  if (verificationEmailSender === undefined) {
    if (config.nodeEnv === 'production') {
      verificationEmailSender =
        resendDelivery === null
          ? createUnavailableVerificationEmailSender()
          : createResendVerificationEmailSender(resendDelivery);
    } else {
      const development = createDevelopmentVerificationEmailSender();
      verificationEmailSender = development.sender;
      developmentEmailInbox = development.inbox;
    }
  }
  const emailAddressValidator =
    injectedEmailAddressValidator ??
    (config.nodeEnv === 'test'
      ? createTestEmailAddressValidator()
      : createEmailAddressValidator({
          ...(config.nodeEnv === 'development'
            ? { developmentTestDomain: 'chalkboard.test' }
            : {}),
          onFailure: (diagnostic) => logDnsProviderFailure(app.log, diagnostic),
        }));
  const humanVerifier =
    injectedHumanVerifier ??
    (config.nodeEnv !== 'production'
      ? createDevelopmentHumanVerifier()
      : applicationSecurity === null || config.publicOrigin === null
        ? createUnavailableHumanVerifier()
        : createTurnstileHumanVerifier({
            expectedHostname: new URL(config.publicOrigin).hostname,
            onFailure: (diagnostic) =>
              logTurnstileProviderFailure(app.log, diagnostic),
            secret: applicationSecurity.turnstileSecret,
          }));
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

  app.addHook('onResponse', (request, reply, done) => {
    metrics.recordHttpResponse(reply.statusCode);
    request.log.info(
      {
        httpRequest: {
          durationMs: Math.round(reply.elapsedTime * 100) / 100,
          method: request.method,
          requestId: request.id,
          route: request.routeOptions.url ?? 'unmatched',
          statusCode: reply.statusCode,
        },
      },
      'HTTP request completed',
    );
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
    emailAddressValidator,
    emailRateLimitMultiplier: config.nodeEnv === 'production' ? 1 : 100,
    emailSecurity: database.emailSecurity,
    humanVerifier,
    metrics,
    publicOrigin: config.publicOrigin,
    secureCookies: config.nodeEnv === 'production',
    verificationEmailSender,
    fixedVerificationCode: config.nodeEnv === 'test' ? '1234-5678' : null,
  });

  if (resendDelivery !== null && database.emailFeedback !== undefined) {
    installResendFeedbackRoutes(app, {
      feedback: database.emailFeedback,
      verifier: createResendWebhookVerifier({
        signingSecret: resendDelivery.webhookSecret,
      }),
    });
  }

  if (config.nodeEnv === 'development' && developmentEmailInbox !== null) {
    app.get('/api/development/emails', async (request, reply) => {
      if (!isLoopbackAddress(request.ip)) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return { emails: developmentEmailInbox.list() };
    });
  }

  let stopEmailSecurityMaintenance: (() => void) | null = null;
  const emailSecurityMaintenanceService = database.emailSecurity;
  if (
    emailSecurityMaintenanceService !== undefined &&
    config.nodeEnv !== 'test'
  ) {
    app.addHook('onReady', () => {
      stopEmailSecurityMaintenance = startEmailSecurityMaintenance({
        onError: (error) =>
          logOperationalError(app.log, 'email-security.maintenance', error),
        service: emailSecurityMaintenanceService,
      });
    });
    app.addHook('onClose', () => {
      stopEmailSecurityMaintenance?.();
      stopEmailSecurityMaintenance = null;
    });
  }

  let stopDemoMaintenance: (() => void) | null = null;
  const demoSandbox = database.demoSandbox;
  if (demoSandbox !== undefined && config.nodeEnv !== 'test') {
    app.addHook('onReady', () => {
      stopDemoMaintenance = startDemoSandboxMaintenance({
        service: demoSandbox,
        onError: (error) => {
          logOperationalError(app.log, 'demo-sandbox.maintenance', error);
        },
        onReset: (reset) => {
          for (const boardId of reset.boardIds) {
            collaborationGateway.invalidateBoard(boardId);
          }
          for (const userId of reset.userIds) {
            collaborationGateway.invalidateUser(userId);
          }
          app.log.info(
            {
              deletedBoardCount: reset.boardIds.length,
              deletedSessionCount: reset.deletedSessionCount,
              resetAt: reset.succeededAt,
              userCount: reset.userIds.length,
            },
            'Demo sandbox reset completed',
          );
        },
      });
    });
    app.addHook('onClose', () => {
      stopDemoMaintenance?.();
      stopDemoMaintenance = null;
    });
  }

  app.get('/api', async () => ({
    name: 'Chalkboard API',
    version: config.applicationVersion,
  }));

  app.get('/api/public-config', async () => ({
    humanVerification:
      config.applicationSecurity === null
        ? { provider: 'development' as const }
        : {
            provider: 'turnstile' as const,
            siteKey: config.applicationSecurity.turnstileSiteKey,
          },
  }));

  app.get('/api/diagnostics', async (): Promise<ApplicationDiagnostics> => {
    let demoStatus: ApplicationDiagnostics['demo'] = {
      accountCount: null,
      boardCount: null,
      contentBytes: null,
      lastResetAt: null,
      resetHealth: 'unavailable',
      sessionCount: null,
    };
    if (database.demoSandbox !== undefined) {
      try {
        const status = await database.demoSandbox.status();
        demoStatus = {
          accountCount: status.accountCount,
          boardCount: status.boardCount,
          contentBytes: status.contentBytes,
          lastResetAt: status.lastSucceededAt,
          resetHealth: status.healthy ? 'healthy' : 'overdue',
          sessionCount: status.sessionCount,
        };
      } catch (error) {
        logOperationalError(app.log, 'demo-sandbox.diagnostics', error);
      }
    }

    let flowStatusAvailable = database.emailOperationalStatus !== undefined;
    let operationalStatus = {
      flows: {
        'email-change': false,
        'password-reset': false,
        registration: false,
      },
      verifiedAccountCount: null as number | null,
      verifiedAccountLimit: null as number | null,
    };
    try {
      operationalStatus =
        (await database.emailOperationalStatus?.()) ?? operationalStatus;
    } catch (error) {
      flowStatusAvailable = false;
      logOperationalError(app.log, 'account-email.diagnostics', error);
    }
    return {
      commit: config.applicationCommit,
      demo: demoStatus,
      email: {
        delivery:
          config.nodeEnv !== 'production'
            ? 'development'
            : resendDelivery === null
              ? 'unavailable'
              : 'resend',
        flowStatusAvailable,
        flows: {
          emailChange: operationalStatus.flows['email-change'],
          passwordReset: operationalStatus.flows['password-reset'],
          registration: operationalStatus.flows.registration,
        },
        humanVerification:
          config.nodeEnv !== 'production'
            ? 'development'
            : applicationSecurity === null
              ? 'unavailable'
              : 'turnstile',
        material:
          config.nodeEnv !== 'production'
            ? 'development'
            : applicationSecurity === null
              ? 'unavailable'
              : 'materialized',
        verifiedAccountCount: operationalStatus.verifiedAccountCount,
        verifiedAccountLimit: operationalStatus.verifiedAccountLimit,
      },
      name: 'Chalkboard',
      schemas: CHALKBOARD_SCHEMA_VERSIONS,
      version: config.applicationVersion,
    };
  });

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
      logOperationalError(request.log, 'database.readiness', error);
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
