/** Builds bounded browser-failure evidence without persisting private text. */
const MAX_MESSAGE_LENGTH = 2_048;
const MAX_MESSAGE_INPUT_LENGTH = 8 * 1_024;
const MAX_STACK_FRAMES = 12;
const MAX_STACK_FRAME_LENGTH = 512;
const MAX_STACK_INPUT_LENGTH = 64 * 1_024;

export interface BrowserErrorDiagnostic {
  fingerprint: string | null;
  fingerprintCoversCompleteValue: boolean | null;
  messageByteLength: number;
  messageLength: number;
  messageSummary: string;
  messageSummaryOmittedAsPrivate: boolean;
  messageTruncated: boolean;
  name: string;
  route: string;
  stackByteLength: number;
  stackFrames: string[];
  stackFramesComplete: boolean;
  stackFramesObserved: number;
  stackFramesOmitted: number;
  stackFramesOmittedAsPrivate: boolean;
  stackInspectionTruncated: boolean;
  stackLength: number;
  timestamp: string;
}

export interface BrowserErrorFingerprintDiagnostic {
  fingerprint: string | null;
  fingerprintCoversCompleteValue: boolean | null;
}

function boundedName(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/u.test(value)
    ? value
    : 'Error';
}

export function redactBrowserDiagnosticText(value: string): string {
  return value
    .replace(/\bhttps?:\/\/[^\s'"`]+/giu, (candidate) => {
      try {
        const url = new URL(candidate);
        return `[url:${url.hostname}]`;
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
    .replace(
      /\b(?:authorization|cookie|invite_?token|password|secret|session_?token|token)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      '[redacted]',
    )
    .replace(/\b[A-Za-z0-9_-]{64,}\b/gu, '[opaque]')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

const STATIC_DIAGNOSTIC_ROUTES = new Set([
  '/',
  '/acceptable-use',
  '/account-deletion',
  '/contact',
  '/development/emails',
  '/local',
  '/privacy',
  '/privacy-policy',
  '/retention',
  '/terms',
  '/terms-of-use',
]);

export function isBrowserDiagnosticRoute(value: string): boolean {
  return (
    value === '/boards/:boardId' ||
    value === '/local/:boardId' ||
    value === 'unmatched' ||
    STATIC_DIAGNOSTIC_ROUTES.has(value)
  );
}

function diagnosticRoute(pathname: string): string {
  if (/^\/boards\/[^/]+\/?$/u.test(pathname)) return '/boards/:boardId';
  if (/^\/local\/[^/]+\/?$/u.test(pathname)) return '/local/:boardId';
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/u, '') : '/';
  return STATIC_DIAGNOSTIC_ROUTES.has(normalized) ? normalized : 'unmatched';
}

function safeErrorProperty(error: Error, key: PropertyKey): unknown {
  try {
    return Reflect.get(error, key);
  } catch {
    return undefined;
  }
}

function rawFailure(error: unknown): {
  message: string;
  name: string;
  stack: string;
} {
  let isError = false;
  try {
    isError = error instanceof Error;
  } catch {
    // A hostile thrown Proxy is treated as a non-Error value.
  }
  if (isError) {
    const typedError = error as Error;
    const message = safeErrorProperty(typedError, 'message');
    const stack = safeErrorProperty(typedError, 'stack');
    return {
      message:
        typeof message === 'string' ? message : 'Error message was unavailable',
      name: boundedName(safeErrorProperty(typedError, 'name')),
      stack: typeof stack === 'string' ? stack : '',
    };
  }
  if (error === null) {
    return {
      message: 'A null value was thrown',
      name: 'NonErrorThrow',
      stack: '',
    };
  }
  return {
    message: `A non-Error ${typeof error} value was thrown`,
    name: 'NonErrorThrow',
    stack: '',
  };
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) length += 1;
    else if (code <= 0x7ff) length += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      length += 4;
      index += 1;
    } else length += 3;
  }
  return length;
}

function diagnosticFromFailure(
  failure: ReturnType<typeof rawFailure>,
  location: Pick<Location, 'pathname'>,
): BrowserErrorDiagnostic {
  const messageInputTruncated =
    failure.message.length > MAX_MESSAGE_INPUT_LENGTH;
  const redactedMessage = redactBrowserDiagnosticText(
    failure.message.slice(0, MAX_MESSAGE_INPUT_LENGTH),
  );
  const stackInputTruncated = failure.stack.length > MAX_STACK_INPUT_LENGTH;
  const frames = failure.stack
    .slice(0, MAX_STACK_INPUT_LENGTH)
    .split(/\r?\n/u)
    .slice(1)
    .map((frame) => redactBrowserDiagnosticText(frame))
    .filter((frame) => frame.startsWith('at '));
  return {
    fingerprint: null,
    fingerprintCoversCompleteValue: null,
    messageByteLength: utf8ByteLength(failure.message),
    messageLength: failure.message.length,
    messageSummary: redactedMessage.slice(0, MAX_MESSAGE_LENGTH),
    messageSummaryOmittedAsPrivate: false,
    messageTruncated:
      messageInputTruncated || redactedMessage.length > MAX_MESSAGE_LENGTH,
    name: failure.name,
    route: diagnosticRoute(location.pathname),
    stackByteLength: utf8ByteLength(failure.stack),
    stackFrames: frames
      .slice(0, MAX_STACK_FRAMES)
      .map((frame) => frame.slice(0, MAX_STACK_FRAME_LENGTH)),
    stackFramesComplete: !stackInputTruncated,
    stackFramesObserved: frames.length,
    stackFramesOmitted: Math.max(0, frames.length - MAX_STACK_FRAMES),
    stackFramesOmittedAsPrivate: false,
    stackInspectionTruncated: stackInputTruncated,
    stackLength: failure.stack.length,
    timestamp: new Date().toISOString(),
  };
}

async function fingerprintFailure(
  failure: ReturnType<typeof rawFailure>,
): Promise<BrowserErrorFingerprintDiagnostic> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    return {
      fingerprint: null,
      fingerprintCoversCompleteValue: null,
    };
  }
  const digest = await subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      `${failure.name}\0${failure.message.length}\0${utf8ByteLength(failure.message)}\0${failure.message.slice(0, MAX_MESSAGE_INPUT_LENGTH)}\0${failure.stack.length}\0${utf8ByteLength(failure.stack)}\0${failure.stack.slice(0, MAX_STACK_INPUT_LENGTH)}`,
    ),
  );
  return {
    fingerprint: Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
    fingerprintCoversCompleteValue:
      failure.message.length <= MAX_MESSAGE_INPUT_LENGTH &&
      failure.stack.length <= MAX_STACK_INPUT_LENGTH,
  };
}

/** Captures one immutable raw snapshot for matching diagnostic and hash evidence. */
export function captureBrowserErrorEvidence(
  error: unknown,
  location: Pick<Location, 'pathname'> = window.location,
): {
  diagnostic: BrowserErrorDiagnostic;
  fingerprint: Promise<BrowserErrorFingerprintDiagnostic>;
} {
  const failure = rawFailure(error);
  return {
    diagnostic: diagnosticFromFailure(failure, location),
    fingerprint: fingerprintFailure(failure),
  };
}

/** Returns the synchronously available, fully redacted browser diagnostic. */
export function browserErrorDiagnostic(
  error: unknown,
  location: Pick<Location, 'pathname'> = window.location,
): BrowserErrorDiagnostic {
  return diagnosticFromFailure(rawFailure(error), location);
}

/** Adds a bounded SHA-256 fingerprint with explicit complete/prefix coverage. */
export async function fingerprintBrowserError(
  error: unknown,
): Promise<BrowserErrorFingerprintDiagnostic> {
  return fingerprintFailure(rawFailure(error));
}
