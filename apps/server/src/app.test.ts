/**
 * Verifies Fastify composition: security headers, health/readiness, diagnostics,
 * metrics, drain ordering, and database ownership without a real listener.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from './app.js';
import type { AppConfig } from './config.js';
import type { Database } from './db/database.js';

const config: AppConfig = {
  accountRegistrationLimit: 250,
  applicationSecurity: null,
  apiRequestConcurrencyLimit: 128,
  applicationCommit: 'development',
  applicationVersion: '0.1.0',
  assetUploadConcurrencyLimit: 4,
  collaborationCompactionLimits: { concurrent: 4, pending: 64 },
  collaborationCompactionUpdateThreshold: 100,
  collaborationDocumentLimits: {
    documentBytes: 5 * 1_024 * 1_024,
    loadedBytes: 32 * 1_024 * 1_024,
    loadedUpdates: 1_000,
    updateBytes: 900_000,
  },
  collaborationPersistenceQueueLimits: {
    maximumAgeMilliseconds: 30_000,
    processBytes: 64 * 1_024 * 1_024,
    processUpdates: 4_096,
    roomBytes: 8 * 1_024 * 1_024,
    roomUpdates: 256,
  },
  databaseUrl: 'postgresql://unused',
  emailCapacityLimits: { daily: 80, monthly: 2_400 },
  host: '127.0.0.1',
  logLevel: 'silent',
  nodeEnv: 'test',
  passwordWorkLimits: { concurrent: 4, pending: 16 },
  port: 3000,
  publicOrigin: null,
  shutdownTimeoutMs: 30_000,
  snsConfirmSubscription: false,
  trustProxyHops: 1,
  verificationEmail: null,
};

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createApp(database: Database) {
  const app = buildApp({ config, database });
  apps.push(app);
  return app;
}

describe('verification email transport', () => {
  it('serves when the transport cannot be reached', async () => {
    // Email is peripheral to collaboration. If an unreachable provider stopped
    // startup, a provider outage would block every restart and rolling deploy.
    const app = buildApp({
      config,
      database: { close: vi.fn(), ping: vi.fn() },
      verificationEmailSender: {
        close: vi.fn(),
        send: vi.fn(() => Promise.reject(new Error('Provider unavailable'))),
      },
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ready' });
  });
});

describe('health routes', () => {
  it('refuses to start production without a pinned public origin', () => {
    expect(() =>
      buildApp({
        config: { ...config, nodeEnv: 'production', publicOrigin: null },
        database: { close: vi.fn(), ping: vi.fn() },
      }),
    ).toThrow('PUBLIC_ORIGIN is required in production');
  });

  it('refuses a non-TLS public production origin', () => {
    expect(() =>
      buildApp({
        config: {
          ...config,
          applicationCommit: 'a'.repeat(40),
          nodeEnv: 'production',
          publicOrigin: 'http://chalkboard.example',
        },
        database: { close: vi.fn(), ping: vi.fn() },
      }),
    ).toThrow('must use HTTPS');
  });

  it('refuses to start unidentified production code', () => {
    expect(() =>
      buildApp({
        config: {
          ...config,
          nodeEnv: 'production',
          publicOrigin: 'https://chalkboard.example',
        },
        database: { close: vi.fn(), ping: vi.fn() },
      }),
    ).toThrow('CHALKBOARD_COMMIT is required in production');
  });

  it('requires and acquires the single-server production runtime lock', async () => {
    const productionConfig: AppConfig = {
      ...config,
      applicationCommit: 'a'.repeat(40),
      nodeEnv: 'production',
      publicOrigin: 'https://chalkboard.example',
    };
    expect(() =>
      buildApp({
        config: productionConfig,
        database: { close: vi.fn(), ping: vi.fn() },
      }),
    ).toThrow('runtime lock is unavailable');

    const acquireRuntimeLock = vi.fn().mockResolvedValue(undefined);
    const app = buildApp({
      config: productionConfig,
      database: {
        acquireRuntimeLock,
        close: vi.fn(),
        ping: vi.fn().mockResolvedValue(undefined),
      },
    });
    apps.push(app);
    await app.ready();
    expect(acquireRuntimeLock).toHaveBeenCalledOnce();
    expect(
      (await app.inject({ method: 'GET', url: '/health/ready' })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/api/diagnostics' })).json()
        .email,
    ).toEqual({
      delivery: 'unavailable',
      flowStatusAvailable: false,
      flows: {
        emailChange: false,
        passwordReset: false,
        registration: false,
      },
      humanVerification: 'unavailable',
      material: 'unavailable',
      verifiedAccountCount: null,
      verifiedAccountLimit: null,
    });
  });

  it('uses only the configured bounded proxy chain for client identity', async () => {
    const createProxyApp = (trustProxyHops: number) => {
      const app = buildApp({
        config: {
          ...config,
          applicationCommit: 'a'.repeat(40),
          nodeEnv: 'production',
          publicOrigin: 'https://chalkboard.example',
          trustProxyHops,
        },
        database: {
          acquireRuntimeLock: vi.fn().mockResolvedValue(undefined),
          close: vi.fn(),
          ping: vi.fn().mockResolvedValue(undefined),
        },
      });
      app.get('/client-ip', async (request) => ({ ip: request.ip }));
      apps.push(app);
      return app;
    };
    const oneHop = createProxyApp(1);
    const twoHops = createProxyApp(2);

    expect(
      (
        await oneHop.inject({
          headers: { 'x-forwarded-for': '198.51.100.5, 203.0.113.10' },
          method: 'GET',
          url: '/client-ip',
        })
      ).json(),
    ).toEqual({ ip: '203.0.113.10' });
    expect(
      (
        await twoHops.inject({
          headers: { 'x-forwarded-for': '198.51.100.5, 203.0.113.10' },
          method: 'GET',
          url: '/client-ip',
        })
      ).json(),
    ).toEqual({ ip: '198.51.100.5' });
  });

  it('keeps the development email inbox restricted to loopback clients', async () => {
    const app = buildApp({
      config: { ...config, nodeEnv: 'development' },
      database: { close: vi.fn(), ping: vi.fn().mockResolvedValue(undefined) },
    });
    apps.push(app);

    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/development/emails',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          remoteAddress: '198.51.100.10',
          url: '/api/development/emails',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('exposes only public human-verification browser configuration', async () => {
    const app = createApp({
      close: vi.fn(),
      ping: vi.fn().mockResolvedValue(undefined),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/public-config',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      humanVerification: { provider: 'development' },
    });
  });

  it('exposes application and schema diagnostics without document content', async () => {
    const app = createApp({
      close: vi.fn(),
      ping: vi.fn().mockResolvedValue(undefined),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/diagnostics',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      commit: 'development',
      demo: {
        accountCount: null,
        boardCount: null,
        contentBytes: null,
        lastResetAt: null,
        resetHealth: 'unavailable',
        sessionCount: null,
      },
      email: {
        delivery: 'development',
        flowStatusAvailable: false,
        flows: {
          emailChange: false,
          passwordReset: false,
          registration: false,
        },
        humanVerification: 'development',
        material: 'development',
        verifiedAccountCount: null,
        verifiedAccountLimit: null,
      },
      name: 'Chalkboard',
      schemas: {
        archive: 1,
        archiveBoard: 1,
        cloudBoard: 1,
        indexedDb: 5,
        localBoardRecord: 2,
        mixedContent: 1,
        postgresMigration: '0009_maintenance_cleanup_indexes.sql',
      },
      version: '0.1.0',
    });
    expect(response.body).not.toMatch(/element|source|title/iu);
  });

  it('reports redacted flow and account-capacity diagnostics without identifiers', async () => {
    const app = createApp({
      close: vi.fn(),
      demoSandbox: {
        resetIfDue: vi.fn(async () => null),
        status: vi.fn(async () => ({
          accountCount: 5,
          boardCount: 2,
          contentBytes: 1_024,
          healthy: true,
          lastSucceededAt: '2026-08-11T00:00:00.000Z',
          sessionCount: 7,
        })),
      },
      emailOperationalStatus: vi.fn(async () => ({
        flows: {
          'email-change': true,
          'password-reset': false,
          registration: false,
        },
        verifiedAccountCount: 4,
        verifiedAccountLimit: 10,
      })),
      ping: vi.fn().mockResolvedValue(undefined),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/diagnostics',
    });
    expect(response.json().demo).toEqual({
      accountCount: 5,
      boardCount: 2,
      contentBytes: 1_024,
      lastResetAt: '2026-08-11T00:00:00.000Z',
      resetHealth: 'healthy',
      sessionCount: 7,
    });
    expect(response.json().email).toMatchObject({
      flowStatusAvailable: true,
      flows: {
        emailChange: true,
        passwordReset: false,
        registration: false,
      },
      verifiedAccountCount: 4,
      verifiedAccountLimit: 10,
    });
    expect(response.body).not.toMatch(/@|destination|digest|code|token/iu);
  });

  it('keeps diagnostics available when demo maintenance status fails', async () => {
    const app = createApp({
      close: vi.fn(),
      demoSandbox: {
        resetIfDue: vi.fn(async () => null),
        status: vi.fn(async () => {
          throw new Error('maintenance unavailable');
        }),
      },
      ping: vi.fn().mockResolvedValue(undefined),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/diagnostics',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().demo).toEqual({
      accountCount: null,
      boardCount: null,
      contentBytes: null,
      lastResetAt: null,
      resetHealth: 'unavailable',
      sessionCount: null,
    });
  });

  it('reports that the process is live', async () => {
    const app = createApp({
      close: vi.fn(),
      ping: vi.fn().mockResolvedValue(undefined),
    });

    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: 'chalkboard-server',
      status: 'ok',
    });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('same-origin');
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(response.headers['cross-origin-resource-policy']).toBe(
      'same-origin',
    );
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    expect(response.headers['x-request-id']).toBeTypeOf('string');
  });

  it('rejects JSON request bodies above the explicit global limit', async () => {
    const app = createApp({
      close: vi.fn(),
      ping: vi.fn().mockResolvedValue(undefined),
    });
    app.post('/limit-check', async () => ({ accepted: true }));

    const response = await app.inject({
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      payload: JSON.stringify({ value: 'x'.repeat(70 * 1_024) }),
      url: '/limit-check',
    });

    expect(response.statusCode).toBe(413);
  });

  it('returns one fixed correlated response for a revoked thrown Proxy', async () => {
    const app = createApp({
      close: vi.fn(),
      ping: vi.fn().mockResolvedValue(undefined),
    });
    const revocable = Proxy.revocable(new Error('private server failure'), {});
    revocable.revoke();
    app.get('/revoked-error', async () => Promise.reject(revocable.proxy));

    const response = await app.inject({
      method: 'GET',
      url: '/revoked-error',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: 'Internal Server Error',
      requestId: response.headers['x-request-id'],
    });
    expect(response.body).not.toContain('private server failure');
  });

  it('exports operational metrics with request and collaboration gauges', async () => {
    const app = createApp({
      close: vi.fn(),
      metricsSnapshot: () => ({
        idleConnections: 2,
        maximumConnections: 10,
        passwordWorkActive: 2,
        passwordWorkConcurrent: 4,
        passwordWorkPending: 16,
        passwordWorkQueued: 3,
        totalConnections: 3,
        waitingRequests: 1,
      }),
      ping: vi.fn().mockResolvedValue(undefined),
    });
    await app.inject({ method: 'GET', url: '/health/live' });

    const response = await app.inject({ method: 'GET', url: '/metrics' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toContain('chalkboard_http_requests_total 1');
    expect(response.body).toContain('chalkboard_password_work_active 2');
    expect(response.body).toContain('chalkboard_password_work_queued 3');
    expect(response.body).toContain(
      'chalkboard_database_pool_max_connections 10',
    );
    expect(response.body).toContain('chalkboard_database_pool_connections 3');
    expect(response.body).toContain(
      'chalkboard_database_pool_waiting_requests 1',
    );
    expect(response.body).toContain('chalkboard_collaboration_active_rooms 0');
    expect(response.body).toContain(
      'chalkboard_collaboration_pending_persistence_writes 0',
    );
  });

  it('fails readiness but retains liveness after drain begins', async () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    const app = createApp({ close: vi.fn(), ping });
    expect(
      (await app.inject({ method: 'GET', url: '/health/ready' })).statusCode,
    ).toBe(200);

    app.beginDrain();

    const readiness = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });
    expect(readiness.statusCode).toBe(503);
    expect(readiness.json()).toMatchObject({ status: 'not_ready' });
    expect(
      (await app.inject({ method: 'GET', url: '/health/live' })).statusCode,
    ).toBe(200);
    expect(ping).toHaveBeenCalledTimes(1);
    const drainingMetrics = await app.inject({
      method: 'GET',
      url: '/metrics',
    });
    expect(drainingMetrics.body).toContain(
      'chalkboard_shutdown_drain_starts_total 1',
    );
  });

  it('reports readiness when PostgreSQL is available', async () => {
    const app = createApp({
      close: vi.fn(),
      ping: vi.fn().mockResolvedValue(undefined),
    });

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ready' });
  });

  it('returns 503 when PostgreSQL is unavailable', async () => {
    const app = createApp({
      close: vi.fn(),
      ping: vi.fn().mockRejectedValue(new Error('unavailable')),
    });

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'not_ready' });
  });
});
