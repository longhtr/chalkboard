/**
 * Defines the production logger and its redaction boundary. Listed paths may
 * contain credentials, cookies, invitation tokens, personal data, or payloads
 * and are removed before a structured record leaves the process.
 */
import type { AppConfig } from '../config.js';

const SERVER_LOG_REDACTION_PATHS = [
  'authorization',
  'cookie',
  'databaseUrl',
  'inviteToken',
  'password',
  'sessionToken',
  'token',
  '*.authorization',
  '*.cookie',
  '*.databaseUrl',
  '*.inviteToken',
  '*.password',
  '*.sessionToken',
  '*.token',
  '*.*.authorization',
  '*.*.cookie',
  '*.*.databaseUrl',
  '*.*.inviteToken',
  '*.*.password',
  '*.*.sessionToken',
  '*.*.token',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
] as const;

/** Returns structured logger settings with recursive credential redaction. */
export function serverLoggerOptions(level: AppConfig['logLevel']): {
  level: AppConfig['logLevel'];
  redact: { censor: string; paths: string[] };
} {
  return {
    level,
    redact: {
      censor: '[Redacted]',
      paths: [...SERVER_LOG_REDACTION_PATHS],
    },
  };
}
