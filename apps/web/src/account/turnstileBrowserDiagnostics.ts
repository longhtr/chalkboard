/** Bounded, local-only Cloudflare Turnstile lifecycle and failure evidence. */
import { bestEffortLocalStorage } from '../bestEffortStorage';
import {
  captureBrowserErrorEvidence,
  isBrowserDiagnosticRoute,
  type BrowserErrorDiagnostic,
  type BrowserErrorFingerprintDiagnostic,
} from '../components/browserErrorDiagnostics';

export const TURNSTILE_BROWSER_DIAGNOSTICS_KEY =
  'chalkboard:turnstile-provider-diagnostics';
const MAX_RECORDS = 20;
const MAX_RECORD_LENGTH = 32 * 1024;
const ERROR_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const RECORD_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/u;
const SAFE_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/u;
const SAFE_VISIBILITY_PATTERN = /^[A-Za-z-]{1,32}$/u;
const MAX_STACK_FRAMES = 12;
const MAX_STACK_FRAME_LENGTH = 512;
const MAX_STACK_LENGTH = 1_000_000_000;
const STAGES = new Set<TurnstileBrowserStage>([
  'completed',
  'expired',
  'invalid-token',
  'missing-api',
  'provider-error',
  'provider-timeout',
  'removal',
  'render',
  'rendered',
  'script-error',
  'script-loaded',
  'script-timeout',
]);
let fallbackRecordSequence = 0;

export type TurnstileBrowserStage =
  | 'completed'
  | 'expired'
  | 'invalid-token'
  | 'missing-api'
  | 'provider-error'
  | 'provider-timeout'
  | 'removal'
  | 'render'
  | 'rendered'
  | 'script-error'
  | 'script-loaded'
  | 'script-timeout';

export interface TurnstileBrowserDiagnostic {
  action: 'password-reset' | 'registration';
  attempt: number;
  elapsedMilliseconds: number;
  online: boolean | null;
  operationalError: BrowserErrorDiagnostic | null;
  outcome: 'debug' | 'failure';
  provider: 'cloudflare-turnstile';
  providerErrorCode: string | null;
  recordId: string;
  scriptHost: 'challenges.cloudflare.com';
  scriptPath: '/turnstile/v0/api.js';
  stage: TurnstileBrowserStage;
  timestamp: string;
  visibilityState: string | null;
}

function safeBrowserState(): {
  online: boolean | null;
  visibilityState: string | null;
} {
  const online = (() => {
    try {
      return typeof navigator.onLine === 'boolean' ? navigator.onLine : null;
    } catch {
      return null;
    }
  })();
  const visibilityState = (() => {
    try {
      return /^[A-Za-z-]{1,32}$/u.test(document.visibilityState)
        ? document.visibilityState
        : null;
    } catch {
      return null;
    }
  })();
  return { online, visibilityState };
}

function sanitizedOperationalError(error: unknown): {
  diagnostic: BrowserErrorDiagnostic;
  fingerprint: Promise<BrowserErrorFingerprintDiagnostic>;
} {
  const evidence = captureBrowserErrorEvidence(error);
  return {
    ...evidence,
    diagnostic: {
      ...evidence.diagnostic,
      messageSummary: 'External provider operational failure',
      messageSummaryOmittedAsPrivate: true,
      stackFrames: evidence.diagnostic.stackFrames.map(
        () => 'at [provider-frame]',
      ),
      stackFramesOmittedAsPrivate: true,
    },
  };
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

function decodedOperationalError(
  value: unknown,
): BrowserErrorDiagnostic | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const fingerprint =
    candidate.fingerprint === null ||
    (typeof candidate.fingerprint === 'string' &&
      /^[0-9a-f]{64}$/u.test(candidate.fingerprint))
      ? candidate.fingerprint
      : null;
  const fingerprintCoversCompleteValue =
    candidate.fingerprintCoversCompleteValue === null ||
    typeof candidate.fingerprintCoversCompleteValue === 'boolean'
      ? candidate.fingerprintCoversCompleteValue
      : null;
  const messageByteLength = boundedInteger(
    candidate.messageByteLength,
    0,
    MAX_STACK_LENGTH,
  );
  const messageLength = boundedInteger(
    candidate.messageLength,
    0,
    MAX_STACK_LENGTH,
  );
  const stackByteLength = boundedInteger(
    candidate.stackByteLength,
    0,
    MAX_STACK_LENGTH,
  );
  const stackFramesObserved = boundedInteger(
    candidate.stackFramesObserved,
    0,
    MAX_STACK_LENGTH,
  );
  const stackFramesOmitted = boundedInteger(
    candidate.stackFramesOmitted,
    0,
    MAX_STACK_LENGTH,
  );
  const stackLength = boundedInteger(
    candidate.stackLength,
    0,
    MAX_STACK_LENGTH,
  );
  if (
    messageByteLength === null ||
    messageLength === null ||
    typeof candidate.messageTruncated !== 'boolean' ||
    stackByteLength === null ||
    typeof candidate.stackFramesComplete !== 'boolean' ||
    stackFramesObserved === null ||
    stackFramesOmitted === null ||
    typeof candidate.stackInspectionTruncated !== 'boolean' ||
    stackLength === null ||
    typeof candidate.name !== 'string' ||
    !SAFE_NAME_PATTERN.test(candidate.name) ||
    typeof candidate.route !== 'string' ||
    !isBrowserDiagnosticRoute(candidate.route) ||
    !Array.isArray(candidate.stackFrames) ||
    candidate.stackFrames.length > MAX_STACK_FRAMES ||
    candidate.stackFrames.some(
      (frame) =>
        typeof frame !== 'string' ||
        frame.length > MAX_STACK_FRAME_LENGTH ||
        !frame.startsWith('at '),
    ) ||
    stackFramesObserved !== candidate.stackFrames.length + stackFramesOmitted ||
    candidate.stackFramesComplete === candidate.stackInspectionTruncated ||
    (fingerprint === null && fingerprintCoversCompleteValue !== null) ||
    typeof candidate.timestamp !== 'string' ||
    !Number.isFinite(Date.parse(candidate.timestamp))
  ) {
    return null;
  }
  return {
    fingerprint,
    fingerprintCoversCompleteValue,
    messageByteLength,
    messageLength,
    messageSummary: 'External provider operational failure',
    messageSummaryOmittedAsPrivate: true,
    messageTruncated: candidate.messageTruncated === true,
    name: candidate.name,
    route: candidate.route,
    stackByteLength,
    stackFrames: candidate.stackFrames.map(() => 'at [provider-frame]'),
    stackFramesComplete: candidate.stackFramesComplete,
    stackFramesObserved,
    stackFramesOmitted,
    stackFramesOmittedAsPrivate: true,
    stackInspectionTruncated: candidate.stackInspectionTruncated,
    stackLength,
    timestamp: new Date(candidate.timestamp).toISOString(),
  };
}

function decodeRecord(value: unknown): TurnstileBrowserDiagnostic | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const attempt = boundedInteger(candidate.attempt, 1, 100);
  const elapsedMilliseconds = boundedInteger(
    candidate.elapsedMilliseconds,
    0,
    10 * 60_000,
  );
  if (
    (candidate.action !== 'registration' &&
      candidate.action !== 'password-reset') ||
    attempt === null ||
    elapsedMilliseconds === null ||
    (candidate.online !== null && typeof candidate.online !== 'boolean') ||
    (candidate.outcome !== 'debug' && candidate.outcome !== 'failure') ||
    candidate.provider !== 'cloudflare-turnstile' ||
    (candidate.providerErrorCode !== null &&
      (typeof candidate.providerErrorCode !== 'string' ||
        !ERROR_CODE_PATTERN.test(candidate.providerErrorCode))) ||
    typeof candidate.recordId !== 'string' ||
    !RECORD_ID_PATTERN.test(candidate.recordId) ||
    candidate.scriptHost !== 'challenges.cloudflare.com' ||
    candidate.scriptPath !== '/turnstile/v0/api.js' ||
    typeof candidate.stage !== 'string' ||
    !STAGES.has(candidate.stage as TurnstileBrowserStage) ||
    typeof candidate.timestamp !== 'string' ||
    !Number.isFinite(Date.parse(candidate.timestamp)) ||
    (candidate.visibilityState !== null &&
      (typeof candidate.visibilityState !== 'string' ||
        !SAFE_VISIBILITY_PATTERN.test(candidate.visibilityState)))
  ) {
    return null;
  }
  return {
    action: candidate.action,
    attempt,
    elapsedMilliseconds,
    online: candidate.online,
    operationalError: decodedOperationalError(candidate.operationalError),
    outcome: candidate.outcome,
    provider: 'cloudflare-turnstile',
    providerErrorCode: candidate.providerErrorCode,
    recordId: candidate.recordId,
    scriptHost: 'challenges.cloudflare.com',
    scriptPath: '/turnstile/v0/api.js',
    stage: candidate.stage as TurnstileBrowserStage,
    timestamp: new Date(candidate.timestamp).toISOString(),
    visibilityState: candidate.visibilityState,
  };
}

function parseRecords(value: string | null): TurnstileBrowserDiagnostic[] {
  if (value === null || value.length > MAX_RECORD_LENGTH) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => decodeRecord(entry))
      .filter((entry): entry is TurnstileBrowserDiagnostic => entry !== null)
      .slice(-MAX_RECORDS);
  } catch {
    return [];
  }
}

function writeRecords(records: TurnstileBrowserDiagnostic[]): void {
  const serialized = JSON.stringify(records.slice(-MAX_RECORDS));
  if (serialized.length <= MAX_RECORD_LENGTH) {
    bestEffortLocalStorage.setItem(
      TURNSTILE_BROWSER_DIAGNOSTICS_KEY,
      serialized,
    );
  }
}

function randomRecordId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    fallbackRecordSequence = (fallbackRecordSequence + 1) % 1_000_000;
    return `${Date.now()}-${fallbackRecordSequence}`;
  }
}

/** Clears the local-only provider record from storage and its memory overlay. */
export function clearTurnstileBrowserDiagnostics(): void {
  bestEffortLocalStorage.removeItem(TURNSTILE_BROWSER_DIAGNOSTICS_KEY);
}

/** Returns a detached snapshot for local support/recovery inspection. */
export function readTurnstileBrowserDiagnostics(): TurnstileBrowserDiagnostic[] {
  return parseRecords(
    bestEffortLocalStorage.getItem(TURNSTILE_BROWSER_DIAGNOSTICS_KEY),
  ).map((record) => ({
    ...record,
    operationalError:
      record.operationalError === null ? null : { ...record.operationalError },
  }));
}

/** Appends one sanitized local provider event and asynchronously adds its hash. */
export function recordTurnstileBrowserDiagnostic(input: {
  action: TurnstileBrowserDiagnostic['action'];
  attempt: number;
  elapsedMilliseconds: number;
  error?: unknown;
  outcome: TurnstileBrowserDiagnostic['outcome'];
  providerErrorCode?: unknown;
  stage: TurnstileBrowserStage;
}): void {
  const recordId = randomRecordId();
  const browser = safeBrowserState();
  const operationalEvidence =
    input.error === undefined ? null : sanitizedOperationalError(input.error);
  const record: TurnstileBrowserDiagnostic = {
    action: input.action,
    attempt: Math.max(1, Math.min(100, Math.trunc(input.attempt))),
    elapsedMilliseconds: Math.max(
      0,
      Math.min(10 * 60_000, Math.round(input.elapsedMilliseconds)),
    ),
    ...browser,
    operationalError: operationalEvidence?.diagnostic ?? null,
    outcome: input.outcome,
    provider: 'cloudflare-turnstile',
    providerErrorCode:
      typeof input.providerErrorCode === 'string' &&
      ERROR_CODE_PATTERN.test(input.providerErrorCode)
        ? input.providerErrorCode
        : null,
    recordId,
    scriptHost: 'challenges.cloudflare.com',
    scriptPath: '/turnstile/v0/api.js',
    stage: input.stage,
    timestamp: new Date().toISOString(),
  };
  writeRecords([...readTurnstileBrowserDiagnostics(), record]);
  if (operationalEvidence === null) return;
  void operationalEvidence.fingerprint
    .then((fingerprintDiagnostic) => {
      const records = readTurnstileBrowserDiagnostics();
      const target = records.find((entry) => entry.recordId === recordId);
      if (target?.operationalError === null || target === undefined) return;
      Object.assign(target.operationalError, fingerprintDiagnostic);
      writeRecords(records);
    })
    .catch(() => {
      // The complete bounded structural diagnostic is already retained.
    });
}
