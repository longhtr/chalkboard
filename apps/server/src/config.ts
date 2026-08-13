/**
 * Parses all process configuration once at startup. Defaults are suitable for
 * local development; production-only invariants fail before opening sockets or
 * connecting application services.
 */
import { z } from 'zod';

import { MAX_NORMAL_COLLABORATION_DOCUMENT_BYTES } from './collaboration/documentAdmission.js';

const publicOriginSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  );
}, 'Must be an HTTP(S) origin without credentials, path, query, or fragment');

const databaseUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'postgres:' || protocol === 'postgresql:';
}, 'Must be a PostgreSQL connection URL');

const environmentSchema = z.object({
  ADMISSION_HMAC_KEY_FILE: z
    .string()
    .trim()
    .min(1)
    .default('/run/secrets/admission-hmac-key'),
  ADMISSION_HMAC_KEY_GENERATION_FILE: z
    .string()
    .trim()
    .min(1)
    .default('/run/secrets/admission-hmac-key-generation'),
  ACCOUNT_REGISTRATION_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .max(250)
    .default(250),
  API_REQUEST_CONCURRENCY_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .max(1_024)
    .default(128),
  ASSET_UPLOAD_CONCURRENCY_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .max(16)
    .default(4),
  AWS_REGION: z.string().trim().min(1).optional(),
  CHALKBOARD_COMMIT: z
    .union([z.literal('development'), z.string().regex(/^[0-9a-f]{40}$/u)])
    .default('development'),
  CHALKBOARD_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
    .default('0.1.0'),
  DATABASE_URL: databaseUrlSchema.default(
    'postgresql://chalkboard:chalkboard@127.0.0.1:5433/chalkboard',
  ),
  EMAIL_CONFIGURATION_SET: z.string().trim().min(1).optional(),
  EMAIL_DAILY_SEND_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .max(80)
    .default(80),
  EMAIL_FROM: z
    .string()
    .trim()
    .min(3)
    .refine(
      (value) => !/(?:^|[<\s])no-?reply@/iu.test(value),
      'Transactional sender must not be a no-reply address',
    )
    .optional(),
  EMAIL_MONTHLY_SEND_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .max(2_400)
    .default(2_400),
  EMAIL_REPLY_TO: z.email().optional(),
  SES_FEEDBACK_TOPIC_ARN: z
    .string()
    .trim()
    .regex(/^arn:aws:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9-_]{1,256}$/)
    .optional(),
  SNS_CONFIRM_SUBSCRIPTION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PASSWORD_WORK_CONCURRENCY_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .max(8)
    .default(4),
  PASSWORD_WORK_PENDING_LIMIT: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(256)
    .default(16),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  PUBLIC_ORIGIN: publicOriginSchema.optional(),
  SHUTDOWN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(300_000)
    .default(30_000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(1).max(2).default(1),
  TURNSTILE_SECRET_FILE: z
    .string()
    .trim()
    .min(1)
    .default('/run/secrets/turnstile-secret'),
  TURNSTILE_SITE_KEY: z.string().trim().min(1).optional(),
  YJS_COMPACTION_UPDATE_THRESHOLD: z.coerce
    .number()
    .int()
    .positive()
    .max(1_000)
    .default(100),
  YJS_MAX_CONCURRENT_COMPACTIONS: z.coerce
    .number()
    .int()
    .positive()
    .max(32)
    .default(4),
  YJS_MAX_DOCUMENT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_NORMAL_COLLABORATION_DOCUMENT_BYTES)
    .default(MAX_NORMAL_COLLABORATION_DOCUMENT_BYTES),
  YJS_MAX_LOADED_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(64 * 1_024 * 1_024)
    .default(32 * 1_024 * 1_024),
  YJS_MAX_LOADED_UPDATES: z.coerce
    .number()
    .int()
    .positive()
    .max(8_192)
    .default(1_000),
  YJS_MAX_UPDATE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(1_000_000)
    .default(900_000),
  YJS_PENDING_COMPACTION_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .max(1_024)
    .default(64),
  YJS_PENDING_PROCESS_BYTE_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .max(256 * 1_024 * 1_024)
    .default(64 * 1_024 * 1_024),
  YJS_PENDING_PROCESS_UPDATE_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .max(65_536)
    .default(4_096),
  YJS_PENDING_ROOM_BYTE_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .max(64 * 1_024 * 1_024)
    .default(8 * 1_024 * 1_024),
  YJS_PENDING_ROOM_UPDATE_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .max(4_096)
    .default(256),
  YJS_PENDING_UPDATE_MAX_AGE_MS: z.coerce
    .number()
    .int()
    .min(10)
    .max(300_000)
    .default(30_000),
});

/** Fully validated runtime settings consumed by server composition. */
export interface AppConfig {
  accountRegistrationLimit: number;
  applicationSecurity: {
    admissionKeyFile: string;
    admissionKeyGenerationFile: string;
    turnstileSecretFile: string;
    turnstileSiteKey: string;
  } | null;
  apiRequestConcurrencyLimit: number;
  applicationCommit: string;
  applicationVersion: string;
  assetUploadConcurrencyLimit: number;
  collaborationCompactionLimits: {
    concurrent: number;
    pending: number;
  };
  collaborationCompactionUpdateThreshold: number;
  collaborationDocumentLimits: {
    documentBytes: number;
    loadedBytes: number;
    loadedUpdates: number;
    updateBytes: number;
  };
  collaborationPersistenceQueueLimits: {
    maximumAgeMilliseconds: number;
    processBytes: number;
    processUpdates: number;
    roomBytes: number;
    roomUpdates: number;
  };
  databaseUrl: string;
  emailCapacityLimits: {
    daily: number;
    monthly: number;
  };
  host: string;
  logLevel: z.infer<typeof environmentSchema>['LOG_LEVEL'];
  nodeEnv: z.infer<typeof environmentSchema>['NODE_ENV'];
  passwordWorkLimits: {
    concurrent: number;
    pending: number;
  };
  port: number;
  publicOrigin: string | null;
  shutdownTimeoutMs: number;
  snsConfirmSubscription: boolean;
  trustProxyHops: number;
  /** Amazon SES delivery configuration. AWS credentials remain ambient. */
  verificationEmail: {
    configurationSet: string;
    feedbackTopicArn: string;
    from: string;
    publicOrigin: string;
    region: string;
    replyTo: string;
  } | null;
}

/**
 * Parses only the database connection, for tools that touch storage and nothing
 * else. The migration runner must not require the serving configuration:
 * demanding a public origin and mail settings it never uses would force an
 * operator to hand unrelated secrets to a migration job.
 */
export function loadDatabaseUrl(
  environment: Record<string, string | undefined> = process.env,
): string {
  const result = z
    .object({ DATABASE_URL: environmentSchema.shape.DATABASE_URL })
    .safeParse(environment);

  if (!result.success) {
    throw new Error(
      `Invalid environment configuration: ${z.prettifyError(result.error)}`,
    );
  }
  return result.data.DATABASE_URL;
}

/** Parses environment strings and rejects unsafe cross-setting combinations. */
export function loadConfig(
  environment: Record<string, string | undefined> = process.env,
): AppConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    throw new Error(
      `Invalid environment configuration: ${z.prettifyError(result.error)}`,
    );
  }

  if (
    result.data.YJS_MAX_LOADED_BYTES < result.data.YJS_MAX_DOCUMENT_BYTES ||
    result.data.YJS_MAX_LOADED_UPDATES <
      result.data.YJS_COMPACTION_UPDATE_THRESHOLD +
        result.data.YJS_PENDING_ROOM_UPDATE_LIMIT -
        1
  ) {
    throw new Error(
      'Invalid environment configuration: Yjs load limits must cover one document and a failed-compaction tail',
    );
  }

  if (
    result.data.EMAIL_DAILY_SEND_LIMIT > result.data.EMAIL_MONTHLY_SEND_LIMIT
  ) {
    throw new Error(
      'Invalid environment configuration: daily email capacity cannot exceed monthly capacity',
    );
  }

  const emailFields = [
    result.data.AWS_REGION,
    result.data.EMAIL_CONFIGURATION_SET,
    result.data.EMAIL_FROM,
    result.data.EMAIL_REPLY_TO,
    result.data.SES_FEEDBACK_TOPIC_ARN,
  ];
  if (
    !emailFields.every((value) => value === undefined) &&
    !emailFields.every((value) => value !== undefined)
  ) {
    throw new Error(
      'Invalid environment configuration: AWS_REGION, EMAIL_CONFIGURATION_SET, EMAIL_FROM, EMAIL_REPLY_TO, and SES_FEEDBACK_TOPIC_ARN must be provided together',
    );
  }
  if (result.data.NODE_ENV === 'production' && emailFields[0] === undefined) {
    throw new Error(
      'Invalid environment configuration: complete email delivery configuration is required in production',
    );
  }
  if (
    result.data.SES_FEEDBACK_TOPIC_ARN !== undefined &&
    result.data.SES_FEEDBACK_TOPIC_ARN.split(':')[3] !== result.data.AWS_REGION
  ) {
    throw new Error(
      'Invalid environment configuration: SES feedback topic and AWS region must match',
    );
  }
  if (
    result.data.NODE_ENV === 'production' &&
    result.data.TURNSTILE_SITE_KEY === undefined
  ) {
    throw new Error(
      'Invalid environment configuration: TURNSTILE_SITE_KEY is required in production',
    );
  }
  if (
    result.data.NODE_ENV === 'production' &&
    (environment.ACCOUNT_REGISTRATION_LIMIT === undefined ||
      environment.EMAIL_DAILY_SEND_LIMIT === undefined ||
      environment.EMAIL_MONTHLY_SEND_LIMIT === undefined)
  ) {
    throw new Error(
      'Invalid environment configuration: production account and email canary limits must be explicit',
    );
  }

  if (
    result.data.NODE_ENV === 'production' &&
    (result.data.CHALKBOARD_COMMIT === 'development' ||
      /^0{40}$/u.test(result.data.CHALKBOARD_COMMIT))
  ) {
    throw new Error(
      'Invalid environment configuration: CHALKBOARD_COMMIT is required in production',
    );
  }

  const publicOriginUrl =
    result.data.PUBLIC_ORIGIN === undefined
      ? null
      : new URL(result.data.PUBLIC_ORIGIN);
  if (
    result.data.NODE_ENV === 'production' &&
    publicOriginUrl !== null &&
    publicOriginUrl.protocol !== 'https:' &&
    !['127.0.0.1', '::1', 'localhost'].includes(publicOriginUrl.hostname)
  ) {
    throw new Error(
      'Invalid environment configuration: PUBLIC_ORIGIN must use HTTPS in production',
    );
  }
  const publicOrigin = publicOriginUrl?.origin ?? null;
  return {
    accountRegistrationLimit: result.data.ACCOUNT_REGISTRATION_LIMIT,
    applicationSecurity:
      result.data.TURNSTILE_SITE_KEY === undefined
        ? null
        : {
            admissionKeyFile: result.data.ADMISSION_HMAC_KEY_FILE,
            admissionKeyGenerationFile:
              result.data.ADMISSION_HMAC_KEY_GENERATION_FILE,
            turnstileSecretFile: result.data.TURNSTILE_SECRET_FILE,
            turnstileSiteKey: result.data.TURNSTILE_SITE_KEY,
          },
    apiRequestConcurrencyLimit: result.data.API_REQUEST_CONCURRENCY_LIMIT,
    applicationCommit: result.data.CHALKBOARD_COMMIT,
    applicationVersion: result.data.CHALKBOARD_VERSION,
    assetUploadConcurrencyLimit: result.data.ASSET_UPLOAD_CONCURRENCY_LIMIT,
    collaborationCompactionLimits: {
      concurrent: result.data.YJS_MAX_CONCURRENT_COMPACTIONS,
      pending: result.data.YJS_PENDING_COMPACTION_LIMIT,
    },
    collaborationCompactionUpdateThreshold:
      result.data.YJS_COMPACTION_UPDATE_THRESHOLD,
    collaborationDocumentLimits: {
      documentBytes: result.data.YJS_MAX_DOCUMENT_BYTES,
      loadedBytes: result.data.YJS_MAX_LOADED_BYTES,
      loadedUpdates: result.data.YJS_MAX_LOADED_UPDATES,
      updateBytes: result.data.YJS_MAX_UPDATE_BYTES,
    },
    collaborationPersistenceQueueLimits: {
      maximumAgeMilliseconds: result.data.YJS_PENDING_UPDATE_MAX_AGE_MS,
      processBytes: result.data.YJS_PENDING_PROCESS_BYTE_LIMIT,
      processUpdates: result.data.YJS_PENDING_PROCESS_UPDATE_LIMIT,
      roomBytes: result.data.YJS_PENDING_ROOM_BYTE_LIMIT,
      roomUpdates: result.data.YJS_PENDING_ROOM_UPDATE_LIMIT,
    },
    databaseUrl: result.data.DATABASE_URL,
    emailCapacityLimits: {
      daily: result.data.EMAIL_DAILY_SEND_LIMIT,
      monthly: result.data.EMAIL_MONTHLY_SEND_LIMIT,
    },
    host: result.data.HOST,
    logLevel: result.data.LOG_LEVEL,
    nodeEnv: result.data.NODE_ENV,
    passwordWorkLimits: {
      concurrent: result.data.PASSWORD_WORK_CONCURRENCY_LIMIT,
      pending: result.data.PASSWORD_WORK_PENDING_LIMIT,
    },
    port: result.data.PORT,
    publicOrigin,
    shutdownTimeoutMs: result.data.SHUTDOWN_TIMEOUT_MS,
    snsConfirmSubscription: result.data.SNS_CONFIRM_SUBSCRIPTION,
    trustProxyHops: result.data.TRUST_PROXY_HOPS,
    verificationEmail:
      result.data.AWS_REGION === undefined ||
      result.data.EMAIL_CONFIGURATION_SET === undefined ||
      result.data.EMAIL_FROM === undefined ||
      result.data.EMAIL_REPLY_TO === undefined ||
      result.data.SES_FEEDBACK_TOPIC_ARN === undefined ||
      publicOrigin === null
        ? null
        : {
            configurationSet: result.data.EMAIL_CONFIGURATION_SET,
            feedbackTopicArn: result.data.SES_FEEDBACK_TOPIC_ARN,
            from: result.data.EMAIL_FROM,
            publicOrigin,
            region: result.data.AWS_REGION,
            replyTo: result.data.EMAIL_REPLY_TO,
          },
  };
}
