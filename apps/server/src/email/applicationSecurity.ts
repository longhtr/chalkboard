/** Reads materialized application secrets from mounted files without logging values. */
import { readFileSync, statSync } from 'node:fs';

import type { AppConfig } from '../config.js';

export interface ApplicationSecurityMaterial {
  admissionKey: Buffer;
  admissionKeyGeneration: number;
  turnstileSecret: string;
}

function readBounded(path: string): string {
  const metadata = statSync(path);
  const runtimeUserId = process.getuid?.();
  if (
    !metadata.isFile() ||
    metadata.size > 4_096 ||
    (metadata.mode & 0o077) !== 0 ||
    (runtimeUserId !== undefined && metadata.uid !== runtimeUserId)
  ) {
    throw new Error('Application security file is not safely materialized');
  }
  const value = readFileSync(path, { encoding: 'utf8' });
  if (Buffer.byteLength(value, 'utf8') > 4_096) {
    throw new Error('Application security file exceeds size limit');
  }
  return value.trim();
}

/**
 * Returns null when materialization is absent or incomplete. Core startup must
 * continue; callers compose unavailable email-only boundaries in that case.
 */
export function loadApplicationSecurityMaterial(
  configuration: AppConfig['applicationSecurity'],
  onFailure: (error: unknown) => void = () => undefined,
): ApplicationSecurityMaterial | null {
  if (configuration === null) return null;
  try {
    const encodedAdmissionKey = readBounded(configuration.admissionKeyFile);
    const admissionKey = Buffer.from(encodedAdmissionKey, 'base64url');
    const encodedGeneration = readBounded(
      configuration.admissionKeyGenerationFile,
    );
    const admissionKeyGeneration = Number(encodedGeneration);
    const turnstileSecret = readBounded(configuration.turnstileSecretFile);
    if (
      admissionKey.byteLength < 32 ||
      !/^\d+$/u.test(encodedGeneration) ||
      !Number.isSafeInteger(admissionKeyGeneration) ||
      admissionKeyGeneration < 1 ||
      turnstileSecret.length < 8
    ) {
      try {
        onFailure(new Error('Application security material failed validation'));
      } catch {
        // Failure reporting must not change fail-closed startup behavior.
      }
      return null;
    }
    return { admissionKey, admissionKeyGeneration, turnstileSecret };
  } catch (error) {
    try {
      onFailure(error);
    } catch {
      // Failure reporting must not change fail-closed startup behavior.
    }
    return null;
  }
}

/** Fixed non-secret material used only by local development and ordinary tests. */
export function developmentApplicationSecurityMaterial(): ApplicationSecurityMaterial {
  return {
    admissionKey: Buffer.from(
      'chalkboard-development-admission-key-not-for-production',
      'utf8',
    ),
    admissionKeyGeneration: 1,
    turnstileSecret: 'development-turnstile-secret',
  };
}
