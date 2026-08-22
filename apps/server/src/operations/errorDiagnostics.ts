/**
 * Converts unknown failures into bounded, correlation-friendly diagnostics.
 * Raw errors never enter structured logs: messages and stack frames are
 * redacted here, while a full-input fingerprint preserves repeat detection.
 */
import { createHash } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

const MAX_CAUSE_DEPTH = 3;
const MAX_AGGREGATE_ERRORS = 5;
const MAX_MESSAGE_LENGTH = 2_048;
const MAX_MESSAGE_INPUT_LENGTH = 8 * 1_024;
const MAX_STACK_FRAMES = 12;
const MAX_STACK_FRAME_LENGTH = 512;
const MAX_STACK_INPUT_LENGTH = 64 * 1_024;
const MAX_ERROR_NAME_LENGTH = 128;
const MAX_ERROR_CODE_LENGTH = 64;

export interface OperationalErrorDiagnostic {
  aggregateErrors: OperationalErrorDiagnostic[];
  aggregateErrorsComplete: boolean | null;
  aggregateErrorsObserved: number;
  aggregateErrorsOmitted: number;
  cause: OperationalErrorDiagnostic | null;
  causeOmitted: boolean;
  causeUnavailable: boolean;
  errorCode: string | null;
  fingerprint: string;
  fingerprintCoversCompleteValue: true;
  messageByteLength: number;
  messageInspectionTruncated: boolean;
  messageLength: number;
  messageSummary: string;
  messageSummaryOmittedAsPrivate: boolean;
  messageTruncated: boolean;
  name: string;
  stackByteLength: number;
  stackFrames: string[];
  stackFramesComplete: boolean;
  stackFramesObserved: number;
  stackFramesOmitted: number;
  stackFramesOmittedAsPrivate: boolean;
  stackInspectionTruncated: boolean;
  stackLength: number;
  statusCode: number | null;
}

type ErrorClass<T extends Error> = abstract new (...arguments_: never[]) => T;

/** Checks one caught value without allowing a hostile Proxy trap to escape. */
export function isErrorInstance<T extends Error>(
  value: unknown,
  errorClass: ErrorClass<T>,
): value is T {
  try {
    return value instanceof errorClass;
  } catch {
    return false;
  }
}

/** Reads one property from an unknown failure without invoking an escaping trap. */
export function readUnknownProperty(value: unknown, key: PropertyKey): unknown {
  return readUnknownPropertyResult(value, key).value;
}

/** Distinguishes an absent/undefined property from an unreadable Proxy trap. */
export function readUnknownPropertyResult(
  value: unknown,
  key: PropertyKey,
): { unavailable: boolean; value: unknown } {
  if (
    (typeof value !== 'object' || value === null) &&
    typeof value !== 'function'
  ) {
    return { unavailable: false, value: undefined };
  }
  try {
    return { unavailable: false, value: Reflect.get(value, key) };
  } catch {
    return { unavailable: true, value: undefined };
  }
}

function boundedIdentifier(
  value: unknown,
  fallback: string,
  maximumLength: number,
): string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    /^[A-Za-z0-9_.-]+$/u.test(value)
    ? value
    : fallback;
}

function errorStatusCode(value: object): number | null {
  const candidate = readUnknownProperty(value, 'statusCode');
  return typeof candidate === 'number' &&
    Number.isInteger(candidate) &&
    candidate >= 100 &&
    candidate <= 599
    ? candidate
    : null;
}

function errorCode(value: object): string | null {
  const candidate = readUnknownProperty(value, 'code');
  return typeof candidate === 'string' &&
    candidate.length > 0 &&
    candidate.length <= MAX_ERROR_CODE_LENGTH &&
    /^[A-Za-z0-9_.-]+$/u.test(candidate)
    ? candidate
    : null;
}

function redactArn(value: string): string {
  return value.replace(
    /arn:([a-z0-9-]+):([a-z0-9-]*):([^:\s]*):(\d{12}):([^\s'"`]+)/giu,
    (
      _match,
      partition: string,
      service: string,
      region: string,
      _account,
      resource: string,
    ) => {
      const resourceType = resource.split(/[/:]/u, 1)[0] ?? '';
      const safeResourceType = /^[A-Za-z0-9_.-]{1,64}$/u.test(resourceType)
        ? resourceType
        : 'resource';
      return `arn:${partition}:${service}:${region}:[account]:${safeResourceType}/[redacted]`;
    },
  );
}

/** Redacts common credential and private-identifier forms from diagnostic text. */
export function redactDiagnosticText(value: string): string {
  return redactArn(value)
    .replace(
      /\bKey \(([^)\r\n]{1,256})\)=\(([^)\r\n]*)\)/giu,
      'Key ($1)=([redacted])',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [redacted]')
    .replace(
      /\b(authorization|cookie|database_?url|invite_?token|password|secret|session_?token|token)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      '$1=[redacted]',
    )
    .replace(
      /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss):\/\/[^\s'"`]+/giu,
      '[database-url]',
    )
    .replace(/\bhttps?:\/\/[^\s'"`]+/giu, (candidate) => {
      try {
        return `[url:${new URL(candidate).hostname}]`;
      } catch {
        return '[url]';
      }
    })
    .replace(
      /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}/giu,
      '[email]',
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
      '[uuid]',
    )
    .replace(/(?<!\d)\d{12}(?!\d)/gu, '[account]')
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu, '[aws-access-key]')
    .replace(
      /\beyJ[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{20,}){1,2}\b/gu,
      '[token]',
    )
    .replace(/\b[0-9a-f]{48,}\b/giu, '[opaque]')
    .replace(/\b[A-Za-z0-9_-]{64,}\b/gu, '[opaque]')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

interface ErrorSnapshot {
  code: string | null;
  isError: boolean;
  message: string;
  name: string;
  stack: string;
  statusCode: number | null;
}

function captureErrorSnapshot(value: unknown): ErrorSnapshot {
  const object = typeof value === 'object' && value !== null ? value : null;
  const isError = isErrorInstance(value, Error);
  const message = isError ? readUnknownProperty(value, 'message') : undefined;
  const stack = isError ? readUnknownProperty(value, 'stack') : undefined;
  return {
    code: object === null ? null : errorCode(object),
    isError,
    message: isError
      ? typeof message === 'string'
        ? message
        : 'Error message was unavailable'
      : value === null
        ? 'A null value was thrown'
        : value === undefined
          ? 'An undefined value was thrown'
          : `A non-Error ${typeof value} value was thrown`,
    name: isError
      ? boundedIdentifier(
          readUnknownProperty(value, 'name'),
          'Error',
          MAX_ERROR_NAME_LENGTH,
        )
      : 'NonErrorThrow',
    stack: typeof stack === 'string' ? stack : '',
    statusCode: object === null ? null : errorStatusCode(object),
  };
}

function fingerprint(snapshot: ErrorSnapshot): string {
  return createHash('sha256')
    .update(snapshot.name, 'utf8')
    .update('\0', 'utf8')
    .update(snapshot.message, 'utf8')
    .update('\0', 'utf8')
    .update(snapshot.code ?? '', 'utf8')
    .update('\0', 'utf8')
    .update(
      snapshot.statusCode === null ? '' : String(snapshot.statusCode),
      'utf8',
    )
    .update('\0', 'utf8')
    .update(snapshot.stack, 'utf8')
    .digest('hex');
}

function diagnosticStackFrames(rawStack: string): {
  complete: boolean;
  frames: string[];
  observed: number;
  omitted: number;
} {
  const complete = rawStack.length <= MAX_STACK_INPUT_LENGTH;
  const candidates = rawStack
    .slice(0, MAX_STACK_INPUT_LENGTH)
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => redactDiagnosticText(line))
    .filter((line) => line.startsWith('at '));
  const frames = candidates
    .slice(0, MAX_STACK_FRAMES)
    .map((line) => line.slice(0, MAX_STACK_FRAME_LENGTH));
  return {
    complete,
    frames,
    observed: candidates.length,
    omitted: Math.max(0, candidates.length - frames.length),
  };
}

function aggregateSnapshot(value: unknown): {
  complete: boolean | null;
  entries: unknown[];
  observed: number;
  omitted: number;
} {
  try {
    if (!Array.isArray(value)) {
      return value === null
        ? { complete: true, entries: [], observed: 0, omitted: 0 }
        : { complete: null, entries: [], observed: 0, omitted: 0 };
    }
  } catch {
    return { complete: null, entries: [], observed: 0, omitted: 0 };
  }
  if (!Array.isArray(value)) {
    return { complete: null, entries: [], observed: 0, omitted: 0 };
  }
  try {
    const observed = value.length;
    if (!Number.isSafeInteger(observed) || observed < 0) {
      return { complete: null, entries: [], observed: 0, omitted: 0 };
    }
    const retained = value.slice(0, MAX_AGGREGATE_ERRORS);
    return {
      complete: observed <= MAX_AGGREGATE_ERRORS,
      entries: retained,
      observed,
      omitted: Math.max(0, observed - retained.length),
    };
  } catch {
    return { complete: null, entries: [], observed: 0, omitted: 0 };
  }
}

function buildDiagnostic(
  value: unknown,
  depth: number,
  visited: Set<object>,
): OperationalErrorDiagnostic {
  const snapshot = captureErrorSnapshot(value);
  const messageInputTruncated =
    snapshot.message.length > MAX_MESSAGE_INPUT_LENGTH;
  const redactedMessage = redactDiagnosticText(
    snapshot.message.slice(0, MAX_MESSAGE_INPUT_LENGTH),
  );
  const object = typeof value === 'object' && value !== null ? value : null;
  const stack = snapshot.isError
    ? diagnosticStackFrames(snapshot.stack)
    : { complete: true, frames: [], observed: 0, omitted: 0 };
  const base = {
    errorCode: snapshot.code,
    fingerprint: fingerprint(snapshot),
    fingerprintCoversCompleteValue: true as const,
    messageByteLength: Buffer.byteLength(snapshot.message, 'utf8'),
    messageInspectionTruncated: messageInputTruncated,
    messageLength: snapshot.message.length,
    messageSummary: redactedMessage.slice(0, MAX_MESSAGE_LENGTH),
    messageSummaryOmittedAsPrivate: false,
    messageTruncated:
      messageInputTruncated || redactedMessage.length > MAX_MESSAGE_LENGTH,
    name: snapshot.name,
    stackByteLength: Buffer.byteLength(snapshot.stack, 'utf8'),
    stackFrames: stack.frames,
    stackFramesComplete: stack.complete,
    stackFramesObserved: stack.observed,
    stackFramesOmitted: stack.omitted,
    stackFramesOmittedAsPrivate: false,
    stackInspectionTruncated: !stack.complete,
    stackLength: snapshot.stack.length,
    statusCode: snapshot.statusCode,
  };
  if (object === null) {
    return {
      ...base,
      aggregateErrors: [],
      aggregateErrorsComplete: true,
      aggregateErrorsObserved: 0,
      aggregateErrorsOmitted: 0,
      cause: null,
      causeOmitted: false,
      causeUnavailable: false,
    };
  }

  const aggregateCandidate =
    snapshot.isError && isErrorInstance(value, AggregateError)
      ? readUnknownPropertyResult(value, 'errors')
      : { unavailable: false, value: null };
  const aggregate = aggregateCandidate.unavailable
    ? { complete: null, entries: [], observed: 0, omitted: 0 }
    : aggregateSnapshot(aggregateCandidate.value);
  const causeResult = readUnknownPropertyResult(object, 'cause');
  const cause = causeResult.value;
  const hasCause =
    !causeResult.unavailable && cause !== undefined && cause !== object;
  const boundary = depth >= MAX_CAUSE_DEPTH || visited.has(object);
  if (boundary) {
    return {
      ...base,
      aggregateErrors: [],
      aggregateErrorsComplete:
        aggregate.complete === true && aggregate.observed === 0 ? true : false,
      aggregateErrorsObserved: aggregate.observed,
      aggregateErrorsOmitted: aggregate.observed,
      cause: null,
      causeOmitted: hasCause,
      causeUnavailable: causeResult.unavailable,
    };
  }

  visited.add(object);
  const result: OperationalErrorDiagnostic = {
    ...base,
    aggregateErrors: aggregate.entries.map((entry) =>
      buildDiagnostic(entry, depth + 1, visited),
    ),
    aggregateErrorsComplete: aggregate.complete,
    aggregateErrorsObserved: aggregate.observed,
    aggregateErrorsOmitted: aggregate.omitted,
    cause: hasCause ? buildDiagnostic(cause, depth + 1, visited) : null,
    causeOmitted: false,
    causeUnavailable: causeResult.unavailable,
  };
  visited.delete(object);
  return result;
}

/** Produces one bounded diagnostic without returning the original error. */
export function diagnoseOperationalError(
  error: unknown,
): OperationalErrorDiagnostic {
  return buildDiagnostic(error, 0, new Set());
}

/** Emits an unexpected failure through a structured server logger. */
export function logOperationalError(
  log: Pick<FastifyBaseLogger, 'error' | 'fatal'>,
  event: string,
  error: unknown,
  level: 'error' | 'fatal' = 'error',
): void {
  log[level](
    {
      operationalError: {
        diagnostic: diagnoseOperationalError(error),
        event,
      },
    },
    'Operational failure',
  );
}

/** Writes a bounded startup/tool failure before a structured logger exists. */
export function writeOperationalError(
  event: string,
  error: unknown,
  output: Pick<NodeJS.WriteStream, 'write'> = process.stderr,
): void {
  output.write(
    `${JSON.stringify({
      level: 'error',
      operationalError: {
        diagnostic: diagnoseOperationalError(error),
        event,
      },
      time: new Date().toISOString(),
    })}\n`,
  );
}
