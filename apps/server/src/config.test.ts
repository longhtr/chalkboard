/** Covers every environment default, bound, production requirement, and invalid configuration rejection. */
import { describe, expect, it } from 'vitest';

import { loadConfig, loadDatabaseUrl } from './config.js';

const productionEmail = {
  ACCOUNT_REGISTRATION_LIMIT: '10',
  EMAIL_DAILY_SEND_LIMIT: '10',
  EMAIL_FROM: 'Chalkboard <accounts@example.com>',
  EMAIL_MONTHLY_SEND_LIMIT: '100',
  EMAIL_REPLY_TO: 'support@example.com',
  TURNSTILE_SITE_KEY: 'turnstile-site-key',
};

describe('loadDatabaseUrl', () => {
  it('reads storage configuration without the serving requirements', () => {
    // A migration job must not be handed a public origin or mail settings it
    // never uses, so production here supplies neither.
    expect(
      loadDatabaseUrl({
        DATABASE_URL: 'postgresql://user:secret@db.example.com:5432/chalkboard',
        NODE_ENV: 'production',
      }),
    ).toBe('postgresql://user:secret@db.example.com:5432/chalkboard');
  });

  it('still rejects a connection string that is not PostgreSQL', () => {
    expect(() =>
      loadDatabaseUrl({ DATABASE_URL: 'mysql://db.example.com' }),
    ).toThrow(/Invalid environment configuration/u);
  });
});

describe('loadConfig', () => {
  it('provides safe development defaults', () => {
    const config = loadConfig({});

    expect(config).toMatchObject({
      accountRegistrationLimit: 250,
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
      emailCapacityLimits: { daily: 100, monthly: 3_000 },
      host: '0.0.0.0',
      nodeEnv: 'development',
      passwordWorkLimits: { concurrent: 4, pending: 16 },
      port: 3000,
      publicOrigin: null,
      shutdownTimeoutMs: 30_000,
      trustProxyHops: 1,
    });
  });

  it('configures bounded API and asset request admission', () => {
    expect(
      loadConfig({
        API_REQUEST_CONCURRENCY_LIMIT: '32',
        ASSET_UPLOAD_CONCURRENCY_LIMIT: '2',
      }),
    ).toMatchObject({
      apiRequestConcurrencyLimit: 32,
      assetUploadConcurrencyLimit: 2,
    });
    expect(() => loadConfig({ API_REQUEST_CONCURRENCY_LIMIT: '0' })).toThrow(
      'Invalid environment configuration',
    );
    expect(() => loadConfig({ ASSET_UPLOAD_CONCURRENCY_LIMIT: '0' })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('coerces a valid port', () => {
    expect(loadConfig({ PORT: '4000' }).port).toBe(4000);
  });

  it('configures a bounded collaboration compaction threshold', () => {
    expect(
      loadConfig({ YJS_COMPACTION_UPDATE_THRESHOLD: '250' })
        .collaborationCompactionUpdateThreshold,
    ).toBe(250);
    expect(() => loadConfig({ YJS_COMPACTION_UPDATE_THRESHOLD: '0' })).toThrow(
      'Invalid environment configuration',
    );
    expect(() =>
      loadConfig({ YJS_COMPACTION_UPDATE_THRESHOLD: '1001' }),
    ).toThrow('Invalid environment configuration');
  });

  it('configures bounded collaboration documents and compactions', () => {
    expect(
      loadConfig({
        YJS_COMPACTION_UPDATE_THRESHOLD: '20',
        YJS_MAX_CONCURRENT_COMPACTIONS: '2',
        YJS_MAX_DOCUMENT_BYTES: '1000',
        YJS_MAX_LOADED_BYTES: '2000',
        YJS_MAX_LOADED_UPDATES: '20',
        YJS_MAX_UPDATE_BYTES: '500',
        YJS_PENDING_COMPACTION_LIMIT: '8',
        YJS_PENDING_ROOM_UPDATE_LIMIT: '1',
      }),
    ).toMatchObject({
      collaborationCompactionLimits: { concurrent: 2, pending: 8 },
      collaborationDocumentLimits: {
        documentBytes: 1_000,
        loadedBytes: 2_000,
        loadedUpdates: 20,
        updateBytes: 500,
      },
    });
    expect(() => loadConfig({ YJS_MAX_CONCURRENT_COMPACTIONS: '0' })).toThrow(
      'Invalid environment configuration',
    );
    expect(() =>
      loadConfig({ YJS_MAX_DOCUMENT_BYTES: String(5 * 1_024 * 1_024 + 1) }),
    ).toThrow('Invalid environment configuration');
    expect(() =>
      loadConfig({
        YJS_MAX_DOCUMENT_BYTES: '2000',
        YJS_MAX_LOADED_BYTES: '1000',
      }),
    ).toThrow('load limits must cover');
    expect(() =>
      loadConfig({
        YJS_COMPACTION_UPDATE_THRESHOLD: '11',
        YJS_MAX_LOADED_UPDATES: '10',
      }),
    ).toThrow('load limits must cover');
  });

  it('configures a lower account canary without exceeding the hard cap', () => {
    expect(
      loadConfig({ ACCOUNT_REGISTRATION_LIMIT: '10' }).accountRegistrationLimit,
    ).toBe(10);
    expect(() => loadConfig({ ACCOUNT_REGISTRATION_LIMIT: '251' })).toThrow(
      'Invalid environment configuration',
    );
    expect(() =>
      loadConfig({
        ...productionEmail,
        ACCOUNT_REGISTRATION_LIMIT: undefined,
        CHALKBOARD_COMMIT: 'a'.repeat(40),
        EMAIL_DAILY_SEND_LIMIT: undefined,
        EMAIL_MONTHLY_SEND_LIMIT: undefined,
        NODE_ENV: 'production',
        PUBLIC_ORIGIN: 'https://chalkboard.example',
      }),
    ).toThrow('canary limits must be explicit');
  });

  it('configures lower canary email capacity without exceeding hard caps', () => {
    expect(
      loadConfig({
        EMAIL_DAILY_SEND_LIMIT: '10',
        EMAIL_MONTHLY_SEND_LIMIT: '100',
      }).emailCapacityLimits,
    ).toEqual({ daily: 10, monthly: 100 });
    expect(() => loadConfig({ EMAIL_DAILY_SEND_LIMIT: '101' })).toThrow(
      'Invalid environment configuration',
    );
    expect(() => loadConfig({ EMAIL_MONTHLY_SEND_LIMIT: '3001' })).toThrow(
      'Invalid environment configuration',
    );
    expect(() =>
      loadConfig({
        EMAIL_DAILY_SEND_LIMIT: '20',
        EMAIL_MONTHLY_SEND_LIMIT: '10',
      }),
    ).toThrow('daily email capacity cannot exceed monthly capacity');
  });

  it('configures bounded password work admission', () => {
    expect(
      loadConfig({
        PASSWORD_WORK_CONCURRENCY_LIMIT: '2',
        PASSWORD_WORK_PENDING_LIMIT: '8',
      }).passwordWorkLimits,
    ).toEqual({ concurrent: 2, pending: 8 });
    expect(() => loadConfig({ PASSWORD_WORK_CONCURRENCY_LIMIT: '0' })).toThrow(
      'Invalid environment configuration',
    );
    expect(() => loadConfig({ PASSWORD_WORK_PENDING_LIMIT: '-1' })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('configures bounded collaboration persistence queues', () => {
    expect(
      loadConfig({
        YJS_PENDING_PROCESS_BYTE_LIMIT: '4000',
        YJS_PENDING_PROCESS_UPDATE_LIMIT: '40',
        YJS_PENDING_ROOM_BYTE_LIMIT: '1000',
        YJS_PENDING_ROOM_UPDATE_LIMIT: '10',
        YJS_PENDING_UPDATE_MAX_AGE_MS: '250',
      }).collaborationPersistenceQueueLimits,
    ).toEqual({
      maximumAgeMilliseconds: 250,
      processBytes: 4_000,
      processUpdates: 40,
      roomBytes: 1_000,
      roomUpdates: 10,
    });
    expect(() => loadConfig({ YJS_PENDING_ROOM_UPDATE_LIMIT: '0' })).toThrow(
      'Invalid environment configuration',
    );
    expect(() => loadConfig({ YJS_PENDING_UPDATE_MAX_AGE_MS: '9' })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('normalizes the configured public origin', () => {
    expect(
      loadConfig({
        ...productionEmail,
        CHALKBOARD_COMMIT: 'a'.repeat(40),
        NODE_ENV: 'production',
        PUBLIC_ORIGIN: 'https://chalkboard.example/',
      }).publicOrigin,
    ).toBe('https://chalkboard.example');
    expect(() =>
      loadConfig({ PUBLIC_ORIGIN: 'https://chalkboard.example/path' }),
    ).toThrow('Invalid environment configuration');
    expect(() => loadConfig({ PUBLIC_ORIGIN: 'javascript:alert(1)' })).toThrow(
      'Invalid environment configuration',
    );
    expect(() =>
      loadConfig({
        ...productionEmail,
        CHALKBOARD_COMMIT: 'a'.repeat(40),
        NODE_ENV: 'production',
        PUBLIC_ORIGIN: 'http://chalkboard.example',
      }),
    ).toThrow('must use HTTPS');
    expect(
      loadConfig({
        ...productionEmail,
        CHALKBOARD_COMMIT: 'a'.repeat(40),
        NODE_ENV: 'production',
        PUBLIC_ORIGIN: 'http://127.0.0.1:8080',
      }).publicOrigin,
    ).toBe('http://127.0.0.1:8080');
  });

  it('requires complete email delivery configuration in production', () => {
    expect(loadConfig({}).resendEmail).toBeNull();
    expect(() =>
      loadConfig({
        CHALKBOARD_COMMIT: 'a'.repeat(40),
        NODE_ENV: 'production',
        PUBLIC_ORIGIN: 'https://chalkboard.example',
      }),
    ).toThrow('complete email delivery configuration is required');
    expect(() =>
      loadConfig({
        ...productionEmail,
        EMAIL_FROM: 'Chalkboard <noreply@example.com>',
        PUBLIC_ORIGIN: 'https://chalkboard.example',
      }),
    ).toThrow('no-reply');
    expect(() => loadConfig({ EMAIL_FROM: 'incomplete@example.com' })).toThrow(
      'must be provided together',
    );
  });

  it('builds Resend delivery configuration from the sender settings', () => {
    expect(
      loadConfig({
        EMAIL_FROM: 'Chalkboard <accounts@example.com>',
        EMAIL_REPLY_TO: 'support@example.com',
        PUBLIC_ORIGIN: 'https://chalkboard.example',
      }).resendEmail,
    ).toEqual({
      apiKeyFile: '/run/secrets/resend-api-key',
      from: 'Chalkboard <accounts@example.com>',
      replyTo: 'support@example.com',
      webhookSecretFile: '/run/secrets/resend-webhook-secret',
    });
  });

  it('refuses retired provider settings instead of ignoring them', () => {
    // Unknown keys are stripped by the schema, so without an explicit check a
    // stale setting would survive in a deployed environment file unnoticed.
    const retired: Array<[string, string]> = [
      ['AWS_REGION', 'ap-southeast-1'],
      ['EMAIL_CONFIGURATION_SET', 'chalkboard-transactional'],
      ['SES_FEEDBACK_TOPIC_ARN', 'arn:aws:sns:ap-southeast-1:000000000000:x'],
      ['SNS_CONFIRM_SUBSCRIPTION', 'false'],
    ];
    for (const [name, value] of retired) {
      expect(() =>
        loadConfig({
          ...productionEmail,
          [name]: value,
          PUBLIC_ORIGIN: 'https://chalkboard.example',
        }),
      ).toThrow(
        new RegExp(`${name} is no longer used and must be removed`, 'u'),
      );
    }
    expect(() =>
      loadConfig({
        AWS_REGION: 'ap-southeast-1',
        SNS_CONFIRM_SUBSCRIPTION: 'false',
      }),
    ).toThrow(/AWS_REGION, SNS_CONFIRM_SUBSCRIPTION are no longer used/u);
  });

  it('requires a complete Resend sender in production', () => {
    expect(() =>
      loadConfig({
        CHALKBOARD_COMMIT: 'a'.repeat(40),
        NODE_ENV: 'production',
        PUBLIC_ORIGIN: 'https://chalkboard.example',
        TURNSTILE_SITE_KEY: 'turnstile-site-key',
      }),
    ).toThrow('complete email delivery configuration is required');
    expect(() =>
      loadConfig({
        EMAIL_FROM: 'Chalkboard <accounts@example.com>',
        PUBLIC_ORIGIN: 'https://chalkboard.example',
      }),
    ).toThrow('EMAIL_FROM and EMAIL_REPLY_TO must be provided together');
    expect(() =>
      loadConfig({
        EMAIL_FROM: 'Chalkboard <noreply@example.com>',
        EMAIL_REPLY_TO: 'support@example.com',
        PUBLIC_ORIGIN: 'https://chalkboard.example',
      }),
    ).toThrow('no-reply');
  });

  it('reads the provider secret paths from the environment', () => {
    expect(
      loadConfig({
        EMAIL_FROM: 'Chalkboard <accounts@example.com>',
        EMAIL_REPLY_TO: 'support@example.com',
        PUBLIC_ORIGIN: 'https://chalkboard.example',
        RESEND_API_KEY_FILE: '/run/secrets/custom-key',
        RESEND_WEBHOOK_SECRET_FILE: '/run/secrets/custom-webhook',
      }).resendEmail,
    ).toMatchObject({
      apiKeyFile: '/run/secrets/custom-key',
      webhookSecretFile: '/run/secrets/custom-webhook',
    });
  });

  it('requires exact application identity in production', () => {
    expect(() =>
      loadConfig({
        ...productionEmail,
        NODE_ENV: 'production',
        PUBLIC_ORIGIN: 'https://chalkboard.example',
      }),
    ).toThrow('CHALKBOARD_COMMIT is required in production');
    expect(() => loadConfig({ CHALKBOARD_COMMIT: 'not-a-commit' })).toThrow(
      'Invalid environment configuration',
    );
    expect(() =>
      loadConfig({
        ...productionEmail,
        CHALKBOARD_COMMIT: '0'.repeat(40),
        NODE_ENV: 'production',
        PUBLIC_ORIGIN: 'https://chalkboard.example',
      }),
    ).toThrow('CHALKBOARD_COMMIT is required');
    expect(
      loadConfig({
        CHALKBOARD_COMMIT: 'b'.repeat(40),
        CHALKBOARD_VERSION: '0.1.0',
      }),
    ).toMatchObject({
      applicationCommit: 'b'.repeat(40),
      applicationVersion: '0.1.0',
    });
  });

  it('requires a PostgreSQL database URL', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'https://database.example' }),
    ).toThrow('Must be a PostgreSQL connection URL');
  });

  it('bounds the trusted reverse-proxy depth', () => {
    expect(loadConfig({ TRUST_PROXY_HOPS: '2' }).trustProxyHops).toBe(2);
    expect(() => loadConfig({ TRUST_PROXY_HOPS: '0' })).toThrow(
      'Invalid environment configuration',
    );
    expect(() => loadConfig({ TRUST_PROXY_HOPS: '3' })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('configures a bounded graceful shutdown timeout', () => {
    expect(loadConfig({ SHUTDOWN_TIMEOUT_MS: '45000' }).shutdownTimeoutMs).toBe(
      45_000,
    );
    expect(() => loadConfig({ SHUTDOWN_TIMEOUT_MS: '0' })).toThrow(
      'Invalid environment configuration',
    );
    expect(() => loadConfig({ SHUTDOWN_TIMEOUT_MS: '300001' })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow(
      'Invalid environment configuration',
    );
  });
});
