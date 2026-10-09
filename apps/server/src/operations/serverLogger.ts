/**
 * Defines the production logger and its redaction boundary. Listed paths may
 * contain credentials, cookies, invitation tokens, personal data, or payloads
 * and are removed before a structured record leaves the process.
 */
import type { AppConfig } from '../config.js';

const MAX_LOG_DEPTH = 16;
const MAX_LOG_ENTRIES = 256;
const MAX_LOG_STRING_LENGTH = 4_096;
const SENSITIVE_LOG_KEYS = new Set([
  'accountid',
  'address',
  'arn',
  'authorization',
  'body',
  'code',
  'cookie',
  'databaseurl',
  'destination',
  'email',
  'err',
  'error',
  'exception',
  'exceptionmessage',
  'invitetoken',
  'message',
  'password',
  'providermessage',
  'providermessageid',
  'providerresponsebody',
  'raw',
  'sessiontoken',
  'token',
  'url',
]);

const SERVER_LOG_REDACTION_PATHS = [
  'address',
  'authorization',
  'body',
  'code',
  'cookie',
  'databaseUrl',
  'destination',
  'email',
  'err',
  'error',
  'exception',
  'inviteToken',
  'message',
  'password',
  'providerMessage',
  'raw',
  'sessionToken',
  'token',
  'url',
  '*.address',
  '*.authorization',
  '*.body',
  '*.code',
  '*.cookie',
  '*.databaseUrl',
  '*.destination',
  '*.email',
  '*.err',
  '*.error',
  '*.exception',
  '*.inviteToken',
  '*.message',
  '*.password',
  '*.providerMessage',
  '*.raw',
  '*.sessionToken',
  '*.token',
  '*.url',
  '*.*.address',
  '*.*.authorization',
  '*.*.body',
  '*.*.code',
  '*.*.cookie',
  '*.*.databaseUrl',
  '*.*.destination',
  '*.*.email',
  '*.*.err',
  '*.*.error',
  '*.*.exception',
  '*.*.inviteToken',
  '*.*.message',
  '*.*.password',
  '*.*.providerMessage',
  '*.*.raw',
  '*.*.sessionToken',
  '*.*.token',
  '*.*.url',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
] as const;

function normalizedLogKey(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9]/gu, '').toLocaleLowerCase('en-US');
}

function sanitizeLogValue(
  value: unknown,
  depth: number,
  visited: Set<object>,
): unknown {
  if (typeof value === 'string') {
    return value.length <= MAX_LOG_STRING_LENGTH
      ? value
      : `${value.slice(0, MAX_LOG_STRING_LENGTH)}[Truncated]`;
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return `[${typeof value}]`;
  let isArray: boolean;
  let prototype: object | null;
  try {
    if (value instanceof Error) return '[Redacted]';
    if (value instanceof URL) return '[Redacted]';
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      return '[Binary]';
    }
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    return '[Unavailable]';
  }
  if (depth >= MAX_LOG_DEPTH || visited.has(value)) return '[Truncated]';
  if (prototype !== Object.prototype && prototype !== null && !isArray) {
    return '[Object]';
  }

  visited.add(value);
  try {
    if (isArray) {
      return (value as unknown[])
        .slice(0, MAX_LOG_ENTRIES)
        .map((entry) => sanitizeLogValue(entry, depth + 1, visited));
    }
    const output: Record<string, unknown> = {};
    let keys: string[];
    try {
      keys = Object.keys(value).slice(0, MAX_LOG_ENTRIES);
    } catch {
      return '[Unavailable]';
    }
    for (const key of keys) {
      if (SENSITIVE_LOG_KEYS.has(normalizedLogKey(key))) {
        output[key] = '[Redacted]';
        continue;
      }
      let entry: unknown;
      try {
        entry = Reflect.get(value, key);
      } catch {
        output[key] = '[Unavailable]';
        continue;
      }
      output[key] = sanitizeLogValue(entry, depth + 1, visited);
    }
    return output;
  } finally {
    visited.delete(value);
  }
}

function sanitizeLogObject(
  object: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = sanitizeLogValue(object, 0, new Set());
  return typeof sanitized === 'object' &&
    sanitized !== null &&
    !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : { malformedLogObject: '[Redacted]' };
}

/** Returns structured logger settings with arbitrary-depth credential redaction. */
export function serverLoggerOptions(level: AppConfig['logLevel']): {
  errorKey: string;
  formatters: {
    log(object: Record<string, unknown>): Record<string, unknown>;
  };
  level: AppConfig['logLevel'];
  redact: { censor: string; paths: string[] };
  serializers: {
    err(): {
      [key: string]: unknown;
      message: string;
      stack: string;
      type: string;
    };
    error(): string;
  };
} {
  return {
    // Pino otherwise copies err.message into top-level msg before serializers
    // and redaction run. Raw errors are forbidden; approved diagnostics use
    // operationalError and never this deliberately unreachable special key.
    errorKey: '__chalkboardRawErrorForbidden',
    formatters: { log: sanitizeLogObject },
    level,
    redact: {
      censor: '[Redacted]',
      paths: [...SERVER_LOG_REDACTION_PATHS],
    },
    serializers: {
      err: () => ({
        message: '[Redacted]',
        stack: '',
        type: 'RedactedError',
      }),
      error: () => '[Redacted]',
    },
  };
}
