/**
 * Bounded, privacy-preserving evidence for external provider text and HTTP
 * responses. Fingerprints preserve equality while explicit completeness fields
 * prevent a retained prefix from being mistaken for a complete provider value.
 */
import { createHash } from 'node:crypto';

import {
  diagnoseOperationalError,
  type OperationalErrorDiagnostic,
  readUnknownProperty,
  redactDiagnosticText,
} from './errorDiagnostics.js';

const DEFAULT_TEXT_INSPECTION_BYTES = 64 * 1_024;
const DEFAULT_TEXT_SUMMARY_LENGTH = 4_096;
const MAX_PROVIDER_HEADERS = 64;
const MAX_PROVIDER_VALUE_DEPTH = 3;
const MAX_PROVIDER_VALUE_ENTRIES = 64;
const MAX_PROVIDER_RESPONSE_ELEMENTS = 64;
const MAX_PROVIDER_RESPONSE_ERROR_CODES = 32;
const MAX_PROVIDER_RESPONSE_REQUEST_IDS = 32;
const MAX_HEADER_NAME_LENGTH = 128;
const MAX_HEADER_VALUE_INSPECTION_BYTES = 4 * 1_024;
const MAX_HEADER_VALUE_SUMMARY_LENGTH = 512;
const SENSITIVE_PROVIDER_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'www-authenticate',
]);

export interface ProviderTextDiagnostic {
  byteLengthComplete: boolean;
  declaredByteLength: number | null;
  declaredByteLengthMatchesObserved: boolean | null;
  fingerprint: string;
  fingerprintCoversCompleteValue: boolean;
  inspectionTruncated: boolean;
  observedByteLength: number;
  streamCancellationError: OperationalErrorDiagnostic | null;
  streamCancellationOutcome: 'failed' | 'not-needed' | 'requested-unobserved';
  summary: string;
  summaryOmittedAsPrivate: boolean;
  summaryTruncated: boolean;
  utf8Valid: boolean;
}

export interface ProviderValueDiagnostic {
  booleanValue: boolean | null;
  entries: ProviderValueEntryDiagnostic[];
  entriesComplete: boolean | null;
  entriesLimitReason: 'cycle' | 'depth' | 'entry-count' | 'unreadable' | null;
  entriesObserved: number;
  entriesOmitted: number;
  kind:
    | 'array'
    | 'bigint'
    | 'binary'
    | 'boolean'
    | 'function'
    | 'null'
    | 'number'
    | 'object'
    | 'string'
    | 'symbol'
    | 'undefined'
    | 'unavailable';
  numberClassification:
    | 'finite'
    | 'nan'
    | 'negative-infinity'
    | 'positive-infinity'
    | 'unsafe-integer'
    | null;
  numberValue: number | null;
  textDiagnostic: ProviderTextDiagnostic | null;
}

export interface ProviderValueEntryDiagnostic {
  name: string;
  nameFingerprint: string | null;
  value: ProviderValueDiagnostic;
}

export interface ProviderHeaderDiagnostic {
  name: string;
  nameFingerprint: string | null;
  structuredValue: ProviderValueDiagnostic | null;
  value: ProviderTextDiagnostic | null;
  valueOmittedAsSensitive: boolean;
  valueUnavailable: boolean;
}

export interface ProviderHeadersDiagnostic {
  entries: ProviderHeaderDiagnostic[];
  entriesComplete: boolean;
  entryCount: number;
  entriesOmitted: number;
  unreadable: boolean;
}

export interface ProviderResponseStructureDiagnostic {
  errorCodeDiagnostics: ProviderTextDiagnostic[];
  errorCodes: string[];
  errorCodesComplete: boolean;
  errorCodesObserved: number;
  errorCodesOmitted: number;
  format:
    'empty' | 'invalid-utf8' | 'json' | 'pem' | 'text' | 'truncated' | 'xml';
  jsonValue: ProviderValueDiagnostic | null;
  requestIdDiagnostics: ProviderTextDiagnostic[];
  requestIds: string[];
  requestIdsComplete: boolean;
  requestIdsObserved: number;
  requestIdsOmitted: number;
  sourceByteLength: number;
  sourceByteLengthComplete: boolean;
  sourceInspectionComplete: boolean;
  xmlElementNames: string[];
  xmlElementsComplete: boolean | null;
  xmlElementsObserved: number;
  xmlElementsOmitted: number;
}

export interface ProviderHttpDiagnostic {
  bodyDiagnostic: ProviderTextDiagnostic | null;
  bodyPresent: boolean | null;
  bodyStructure: ProviderResponseStructureDiagnostic | null;
  bodyType: 'binary' | 'none' | 'stream-or-object' | 'string' | 'unavailable';
  extraFields: ProviderValueEntryDiagnostic[];
  fieldNames: string[];
  fieldsComplete: boolean | null;
  fieldsObserved: number;
  fieldsOmitted: number;
  headers: ProviderHeadersDiagnostic;
  reason: ProviderTextDiagnostic | null;
  statusCode: number | null;
  urlDiagnostic: ProviderTextDiagnostic | null;
}

export interface ReadProviderBodyResult {
  diagnostic: ProviderTextDiagnostic;
  text: string;
}

export class ProviderBodyReadError extends Error {
  constructor(
    readonly diagnostic: ProviderTextDiagnostic,
    readonly retainedText: string,
    options: ErrorOptions,
  ) {
    super(
      'External provider response body could not be read completely',
      options,
    );
    this.name = 'ProviderBodyReadError';
  }
}

function boundedNonnegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function declaredLengthFromHeaders(headers: unknown): number | null {
  let candidate: unknown;
  try {
    if (headers instanceof Headers) candidate = headers.get('content-length');
    else if (typeof headers === 'object' && headers !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(
        headers,
        'content-length',
      );
      candidate =
        descriptor !== undefined && 'value' in descriptor
          ? descriptor.value
          : undefined;
    }
  } catch {
    return null;
  }
  if (typeof candidate !== 'string' || !/^\d{1,16}$/u.test(candidate)) {
    return null;
  }
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Redacts provider-controlled text more strongly than local stack diagnostics. */
export function redactProviderDiagnosticText(value: string): string {
  return redactDiagnosticText(value)
    .replace(
      /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/giu,
      '[domain]',
    )
    .replace(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/gu, '[ip]')
    .replace(/\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/giu, '[ip]');
}

function textDiagnosticFromBytes(input: {
  bytes: Uint8Array;
  byteLengthComplete: boolean;
  declaredByteLength: number | null;
  fingerprintCoversCompleteValue: boolean;
  inspectionTruncated: boolean;
  observedByteLength: number;
  summaryMaximumLength: number;
}): ProviderTextDiagnostic {
  let utf8Valid = true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
  } catch {
    utf8Valid = false;
  }
  const decoded = new TextDecoder().decode(input.bytes);
  const redacted = redactProviderDiagnosticText(decoded);
  return {
    byteLengthComplete: input.byteLengthComplete,
    declaredByteLength: input.declaredByteLength,
    declaredByteLengthMatchesObserved:
      input.byteLengthComplete && input.declaredByteLength !== null
        ? input.declaredByteLength === input.observedByteLength
        : null,
    fingerprint: createHash('sha256').update(input.bytes).digest('hex'),
    fingerprintCoversCompleteValue: input.fingerprintCoversCompleteValue,
    inspectionTruncated: input.inspectionTruncated,
    observedByteLength: input.observedByteLength,
    streamCancellationError: null,
    streamCancellationOutcome: 'not-needed',
    summary: redacted.slice(0, input.summaryMaximumLength),
    summaryOmittedAsPrivate: false,
    summaryTruncated: redacted.length > input.summaryMaximumLength,
    utf8Valid,
  };
}

/** Diagnoses a complete provider string while bounding redaction and summary work. */
export function diagnoseProviderText(
  value: string,
  options: {
    inspectionBytes?: number;
    summaryLength?: number;
  } = {},
): ProviderTextDiagnostic {
  const inspectionBytes =
    options.inspectionBytes ?? DEFAULT_TEXT_INSPECTION_BYTES;
  const summaryLength = options.summaryLength ?? DEFAULT_TEXT_SUMMARY_LENGTH;
  const bytes = Buffer.from(value, 'utf8');
  const inspected = bytes.subarray(0, inspectionBytes);
  const redacted = redactProviderDiagnosticText(
    new TextDecoder().decode(inspected),
  );
  return {
    byteLengthComplete: true,
    declaredByteLength: null,
    declaredByteLengthMatchesObserved: null,
    fingerprint: createHash('sha256').update(bytes).digest('hex'),
    fingerprintCoversCompleteValue: true,
    inspectionTruncated: bytes.byteLength > inspectionBytes,
    observedByteLength: bytes.byteLength,
    streamCancellationError: null,
    streamCancellationOutcome: 'not-needed',
    summary: redacted.slice(0, summaryLength),
    summaryOmittedAsPrivate: false,
    summaryTruncated: redacted.length > summaryLength,
    utf8Valid: true,
  };
}

/** Replaces only retained prose while preserving correlation/completeness facts. */
export function privatizeProviderTextDiagnostic(
  diagnostic: ProviderTextDiagnostic,
  summary = 'Private provider payload omitted',
): ProviderTextDiagnostic {
  return {
    ...diagnostic,
    summary: redactDiagnosticText(summary).slice(
      0,
      DEFAULT_TEXT_SUMMARY_LENGTH,
    ),
    summaryOmittedAsPrivate: true,
    summaryTruncated: false,
  };
}

/** Retains equality/size/completeness for private bytes without decoded prose. */
export function diagnosePrivateProviderBytes(
  value: Uint8Array,
  summary = 'Private provider binary value omitted',
): ProviderTextDiagnostic {
  return privatizeProviderTextDiagnostic(
    textDiagnosticFromBytes({
      bytes: value,
      byteLengthComplete: true,
      declaredByteLength: null,
      fingerprintCoversCompleteValue: true,
      inspectionTruncated: false,
      observedByteLength: value.byteLength,
      summaryMaximumLength: DEFAULT_TEXT_SUMMARY_LENGTH,
    }),
    summary,
  );
}

/** Retains equality/size/completeness for private provider text without its prose. */
export function diagnosePrivateProviderText(
  value: string,
  summary = 'Private provider payload omitted',
): ProviderTextDiagnostic {
  return privatizeProviderTextDiagnostic(diagnoseProviderText(value), summary);
}

function emptyProviderValue(
  kind: ProviderValueDiagnostic['kind'],
): ProviderValueDiagnostic {
  return {
    booleanValue: null,
    entries: [],
    entriesComplete: null,
    entriesLimitReason: kind === 'unavailable' ? 'unreadable' : null,
    entriesObserved: 0,
    entriesOmitted: 0,
    kind,
    numberClassification: null,
    numberValue: null,
    textDiagnostic: null,
  };
}

function safeProviderFieldIdentity(name: string): {
  name: string;
  nameFingerprint: string | null;
} {
  return /^[A-Za-z0-9_$.-]{1,128}$/u.test(name)
    ? { name, nameFingerprint: null }
    : {
        name: '[private-field]',
        nameFingerprint: createHash('sha256').update(name).digest('hex'),
      };
}

function providerContainerKind(
  value: object,
): 'array' | 'object' | 'unavailable' {
  try {
    return Array.isArray(value) ? 'array' : 'object';
  } catch {
    return 'unavailable';
  }
}

function diagnoseProviderValueInternal(
  value: unknown,
  depth: number,
  visited: Set<object>,
): ProviderValueDiagnostic {
  if (value === null) return emptyProviderValue('null');
  if (typeof value === 'string') {
    return {
      ...emptyProviderValue('string'),
      textDiagnostic: diagnosePrivateProviderText(
        value,
        'Private provider field value omitted',
      ),
    };
  }
  if (typeof value === 'boolean') {
    return { ...emptyProviderValue('boolean'), booleanValue: value };
  }
  if (typeof value === 'number') {
    const classification = Number.isNaN(value)
      ? 'nan'
      : value === Number.POSITIVE_INFINITY
        ? 'positive-infinity'
        : value === Number.NEGATIVE_INFINITY
          ? 'negative-infinity'
          : Number.isInteger(value) && !Number.isSafeInteger(value)
            ? 'unsafe-integer'
            : 'finite';
    return {
      ...emptyProviderValue('number'),
      numberClassification: classification,
      numberValue: null,
      textDiagnostic:
        classification === 'finite' || classification === 'unsafe-integer'
          ? diagnosePrivateProviderText(
              Object.is(value, -0) ? '-0' : String(value),
              'Private provider numeric value omitted',
            )
          : null,
    };
  }
  if (typeof value === 'bigint') {
    return {
      ...emptyProviderValue('bigint'),
      textDiagnostic: diagnosePrivateProviderText(
        value.toString(),
        'Private provider bigint value omitted',
      ),
    };
  }
  if (typeof value === 'undefined') return emptyProviderValue('undefined');
  if (typeof value === 'symbol') return emptyProviderValue('symbol');
  if (typeof value === 'function') return emptyProviderValue('function');

  try {
    if (ArrayBuffer.isView(value)) {
      const bytes = new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      );
      return {
        ...emptyProviderValue('binary'),
        textDiagnostic: diagnosePrivateProviderBytes(bytes),
      };
    }
    if (value instanceof ArrayBuffer) {
      return {
        ...emptyProviderValue('binary'),
        textDiagnostic: diagnosePrivateProviderBytes(new Uint8Array(value)),
      };
    }
  } catch {
    return emptyProviderValue('unavailable');
  }
  const containerKind = providerContainerKind(value);
  if (containerKind === 'unavailable') {
    return emptyProviderValue('unavailable');
  }
  const cycle = visited.has(value);
  if (depth >= MAX_PROVIDER_VALUE_DEPTH || cycle) {
    try {
      const names = Object.keys(value);
      return {
        ...emptyProviderValue(containerKind),
        entriesComplete: false,
        entriesLimitReason: cycle ? 'cycle' : 'depth',
        entriesObserved: names.length,
        entriesOmitted: names.length,
      };
    } catch {
      return emptyProviderValue('unavailable');
    }
  }
  visited.add(value);
  try {
    let names: string[];
    try {
      names = Object.keys(value);
    } catch {
      return emptyProviderValue('unavailable');
    }
    const retainedNames = names.slice(0, MAX_PROVIDER_VALUE_ENTRIES);
    const entries: ProviderValueEntryDiagnostic[] = [];
    for (const rawName of retainedNames) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, rawName);
      } catch {
        descriptor = undefined;
      }
      const identity = safeProviderFieldIdentity(rawName);
      entries.push({
        ...identity,
        value:
          descriptor === undefined || !('value' in descriptor)
            ? emptyProviderValue('unavailable')
            : diagnoseProviderValueInternal(
                descriptor.value,
                depth + 1,
                visited,
              ),
      });
    }
    return {
      ...emptyProviderValue(containerKind),
      entries,
      entriesComplete: names.length <= MAX_PROVIDER_VALUE_ENTRIES,
      entriesLimitReason:
        names.length <= MAX_PROVIDER_VALUE_ENTRIES ? null : 'entry-count',
      entriesObserved: names.length,
      entriesOmitted: Math.max(0, names.length - retainedNames.length),
    };
  } finally {
    visited.delete(value);
  }
}

/** Diagnoses arbitrary future provider fields without retaining unknown private values. */
export function diagnoseProviderValue(value: unknown): ProviderValueDiagnostic {
  return diagnoseProviderValueInternal(value, 0, new Set());
}

/** Returns bounded diagnostics for provider fields outside a known contract. */
export function diagnoseProviderExtraFields(
  value: unknown,
  knownFields: ReadonlySet<string>,
): ProviderValueEntryDiagnostic[] {
  return diagnoseProviderValue(value).entries.filter(
    (entry) => !knownFields.has(entry.name),
  );
}

function safeProviderHeaderValue(name: string, value: string): boolean {
  if (value.length === 0 || value.length > MAX_HEADER_VALUE_SUMMARY_LENGTH) {
    return false;
  }
  switch (name) {
    case 'age':
    case 'content-length':
      return /^\d{1,16}$/u.test(value);
    case 'cf-cache-status':
      return /^[A-Za-z0-9_-]{1,64}$/u.test(value);
    case 'cf-ray':
      return /^[A-Za-z0-9_-]{1,128}$/u.test(value);
    case 'content-type':
      return /^[A-Za-z0-9!#$&^_.+-]{1,127}\/[A-Za-z0-9!#$&^_.+-]{1,127}(?:;\s*charset=[A-Za-z0-9._-]{1,64})?$/iu.test(
        value,
      );
    case 'date':
      return (
        /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(
          value,
        ) && Number.isFinite(Date.parse(value))
      );
    case 'retry-after':
      return (
        /^\d{1,10}$/u.test(value) ||
        (/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(
          value,
        ) &&
          Number.isFinite(Date.parse(value)))
      );
    case 'x-amz-cf-id':
    case 'x-amzn-requestid':
    case 'x-request-id':
      return /^[A-Za-z0-9._:+/=-]{1,512}$/u.test(value);
    case 'x-amzn-errortype':
      return /^[A-Za-z][A-Za-z0-9_.-]{0,127}(?::[A-Za-z0-9_.-]{1,128})?$/u.test(
        value,
      );
    default:
      return false;
  }
}

function headerEntries(headers: unknown): {
  entries: Array<{ name: string; unavailable: boolean; value: unknown }>;
  unreadable: boolean;
} {
  try {
    if (headers instanceof Headers) {
      return {
        entries: [...headers].map(([name, value]) => ({
          name,
          unavailable: false,
          value,
        })),
        unreadable: false,
      };
    }
    if (typeof headers !== 'object' || headers === null) {
      return { entries: [], unreadable: headers !== undefined };
    }
    return {
      entries: Object.keys(headers).map((name) => {
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = Object.getOwnPropertyDescriptor(headers, name);
        } catch {
          descriptor = undefined;
        }
        return {
          name,
          unavailable: descriptor === undefined || !('value' in descriptor),
          value:
            descriptor !== undefined && 'value' in descriptor
              ? descriptor.value
              : undefined,
        };
      }),
      unreadable: false,
    };
  } catch {
    return { entries: [], unreadable: true };
  }
}

/** Captures all bounded header names and transformed values. */
export function diagnoseProviderHeaders(
  headers: unknown,
): ProviderHeadersDiagnostic {
  const collected = headerEntries(headers);
  const observed = collected.entries.map(
    ({ name: rawName, unavailable, value }) => {
      const normalized = rawName.toLocaleLowerCase('en-US');
      const valid = /^[a-z0-9!#$%&'*+.^_`|~-]{1,128}$/u.test(normalized);
      return {
        lookupName: valid ? normalized : '',
        name: valid
          ? normalized.slice(0, MAX_HEADER_NAME_LENGTH)
          : '[private-header]',
        nameFingerprint: valid
          ? null
          : createHash('sha256').update(rawName).digest('hex'),
        unavailable,
        value,
      };
    },
  );
  const retained = observed.slice(0, MAX_PROVIDER_HEADERS);
  return {
    entries: retained.map(
      ({ lookupName, name, nameFingerprint, unavailable, value }) => {
        const sensitive = SENSITIVE_PROVIDER_HEADERS.has(lookupName);
        const textValue = typeof value === 'string' ? value : null;
        return {
          name,
          nameFingerprint,
          structuredValue:
            sensitive || unavailable || textValue !== null
              ? null
              : diagnoseProviderValue(value),
          value:
            sensitive || unavailable || textValue === null
              ? null
              : safeProviderHeaderValue(lookupName, textValue)
                ? diagnoseProviderText(textValue, {
                    inspectionBytes: MAX_HEADER_VALUE_INSPECTION_BYTES,
                    summaryLength: MAX_HEADER_VALUE_SUMMARY_LENGTH,
                  })
                : diagnosePrivateProviderText(
                    textValue,
                    'Private provider header value omitted',
                  ),
          valueOmittedAsSensitive: sensitive,
          valueUnavailable: unavailable,
        };
      },
    ),
    entriesComplete:
      !collected.unreadable && observed.length <= MAX_PROVIDER_HEADERS,
    entryCount: observed.length,
    entriesOmitted: Math.max(0, observed.length - MAX_PROVIDER_HEADERS),
    unreadable: collected.unreadable,
  };
}

/** Parses bounded safe structure with explicit body-read completeness. */
export function diagnoseProviderResponseStructure(
  text: string,
  options: {
    sourceByteLength?: number;
    sourceByteLengthComplete?: boolean;
    utf8Valid?: boolean;
  } = {},
): ProviderResponseStructureDiagnostic {
  const sourceByteLength =
    options.sourceByteLength ?? Buffer.byteLength(text, 'utf8');
  const sourceByteLengthComplete = options.sourceByteLengthComplete ?? true;
  const utf8Valid = options.utf8Valid ?? true;
  const sourceInspectionComplete =
    sourceByteLengthComplete &&
    sourceByteLength <= DEFAULT_TEXT_INSPECTION_BYTES;
  const base = {
    errorCodeDiagnostics: [] as ProviderTextDiagnostic[],
    errorCodes: [] as string[],
    errorCodesComplete: sourceInspectionComplete,
    errorCodesObserved: 0,
    errorCodesOmitted: 0,
    requestIdDiagnostics: [] as ProviderTextDiagnostic[],
    requestIds: [] as string[],
    requestIdsComplete: sourceInspectionComplete,
    requestIdsObserved: 0,
    requestIdsOmitted: 0,
    sourceByteLength,
    sourceByteLengthComplete,
    sourceInspectionComplete,
  };
  if (!utf8Valid) {
    return {
      ...base,
      errorCodesComplete: false,
      format: 'invalid-utf8',
      jsonValue: null,
      requestIdsComplete: false,
      xmlElementNames: [],
      xmlElementsComplete: false,
      xmlElementsObserved: 0,
      xmlElementsOmitted: 0,
    };
  }
  if (!sourceInspectionComplete) {
    return {
      ...base,
      format: 'truncated',
      jsonValue: null,
      xmlElementNames: [],
      xmlElementsComplete: false,
      xmlElementsObserved: 0,
      xmlElementsOmitted: 0,
    };
  }
  const trimmed = text.trim();
  const emptyStructure = (
    format: 'empty' | 'json' | 'pem' | 'text',
    jsonValue: ProviderValueDiagnostic | null = null,
  ): ProviderResponseStructureDiagnostic => ({
    ...base,
    format,
    jsonValue,
    xmlElementNames: [],
    xmlElementsComplete: format === 'text' ? null : true,
    xmlElementsObserved: 0,
    xmlElementsOmitted: 0,
  });
  if (trimmed === '') return emptyStructure('empty');
  if (/^-----BEGIN CERTIFICATE-----/u.test(trimmed)) {
    return emptyStructure('pem');
  }
  try {
    return emptyStructure(
      'json',
      diagnoseProviderValue(JSON.parse(trimmed) as unknown),
    );
  } catch {
    // Continue with bounded XML structure extraction.
  }
  if (trimmed.startsWith('<')) {
    const names = [
      ...trimmed.matchAll(/<\/?([A-Za-z_][A-Za-z0-9_.:-]{0,127})(?:\s|>|\/)/gu),
    ]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined);
    const uniqueNames = [...new Set(names)].slice(
      0,
      MAX_PROVIDER_RESPONSE_ELEMENTS,
    );
    const tagValues = (tag: string): string[] =>
      [...trimmed.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'gu'))]
        .map((match) => match[1])
        .filter((value): value is string => value !== undefined);
    const errorCodeValues = tagValues('Code');
    const requestIdValues = [
      ...tagValues('RequestId'),
      ...tagValues('RequestID'),
    ];
    const retainedErrorCodes = errorCodeValues.slice(
      0,
      MAX_PROVIDER_RESPONSE_ERROR_CODES,
    );
    const retainedRequestIds = requestIdValues.slice(
      0,
      MAX_PROVIDER_RESPONSE_REQUEST_IDS,
    );
    const safeValue = (value: string): boolean =>
      /^[A-Za-z0-9._:+/=-]{1,512}$/u.test(value);
    return {
      ...base,
      errorCodeDiagnostics: retainedErrorCodes.map((value) =>
        diagnosePrivateProviderText(
          value,
          'Private provider error code omitted',
        ),
      ),
      errorCodes: retainedErrorCodes.filter(safeValue),
      errorCodesComplete:
        errorCodeValues.length <= MAX_PROVIDER_RESPONSE_ERROR_CODES,
      errorCodesObserved: errorCodeValues.length,
      errorCodesOmitted: Math.max(
        0,
        errorCodeValues.length - retainedErrorCodes.length,
      ),
      format: 'xml',
      jsonValue: null,
      requestIdDiagnostics: retainedRequestIds.map((value) =>
        diagnosePrivateProviderText(
          value,
          'Private provider request identifier omitted',
        ),
      ),
      requestIds: retainedRequestIds.filter(safeValue),
      requestIdsComplete:
        requestIdValues.length <= MAX_PROVIDER_RESPONSE_REQUEST_IDS,
      requestIdsObserved: requestIdValues.length,
      requestIdsOmitted: Math.max(
        0,
        requestIdValues.length - retainedRequestIds.length,
      ),
      xmlElementNames: uniqueNames,
      xmlElementsComplete: names.length <= MAX_PROVIDER_RESPONSE_ELEMENTS,
      xmlElementsObserved: names.length,
      xmlElementsOmitted: Math.max(
        0,
        names.length - MAX_PROVIDER_RESPONSE_ELEMENTS,
      ),
    };
  }
  return emptyStructure('text');
}

const KNOWN_PROVIDER_HTTP_FIELDS = new Set([
  'body',
  'headers',
  'ok',
  'reason',
  'redirected',
  'status',
  'statusCode',
  'statusText',
  'type',
  'url',
]);

function diagnoseStaticHttpBody(
  body: unknown,
): Pick<
  ProviderHttpDiagnostic,
  'bodyDiagnostic' | 'bodyPresent' | 'bodyStructure' | 'bodyType'
> {
  if (body === undefined || body === null) {
    return {
      bodyDiagnostic: null,
      bodyPresent: body === null ? false : null,
      bodyStructure: null,
      bodyType: 'none',
    };
  }
  if (typeof body === 'string') {
    return {
      bodyDiagnostic: diagnosePrivateProviderText(
        body,
        'Private static provider body omitted',
      ),
      bodyPresent: true,
      bodyStructure: diagnoseProviderResponseStructure(body),
      bodyType: 'string',
    };
  }
  try {
    if (body instanceof Uint8Array) {
      let bodyStructure: ProviderResponseStructureDiagnostic | null = null;
      try {
        bodyStructure = diagnoseProviderResponseStructure(
          new TextDecoder('utf-8', { fatal: true }).decode(body),
          { sourceByteLength: body.byteLength },
        );
      } catch {
        bodyStructure = null;
      }
      return {
        bodyDiagnostic: diagnosePrivateProviderBytes(
          body,
          'Private static provider body omitted',
        ),
        bodyPresent: true,
        bodyStructure,
        bodyType: 'binary',
      };
    }
    if (typeof body === 'object' || typeof body === 'function') {
      return {
        bodyDiagnostic: null,
        bodyPresent: true,
        bodyStructure: null,
        bodyType: 'stream-or-object',
      };
    }
  } catch {
    return {
      bodyDiagnostic: null,
      bodyPresent: null,
      bodyStructure: null,
      bodyType: 'unavailable',
    };
  }
  return {
    bodyDiagnostic: null,
    bodyPresent: true,
    bodyStructure: null,
    bodyType: 'unavailable',
  };
}

/** Captures status, reason, every bounded response header, and static body evidence. */
export function diagnoseProviderHttp(
  response: unknown,
): ProviderHttpDiagnostic {
  const status = readUnknownProperty(response, 'status');
  const statusCode = readUnknownProperty(response, 'statusCode');
  const reason =
    readUnknownProperty(response, 'statusText') ??
    readUnknownProperty(response, 'reason');
  const url = readUnknownProperty(response, 'url');
  const value = diagnoseProviderValue(response);
  return {
    ...diagnoseStaticHttpBody(readUnknownProperty(response, 'body')),
    extraFields: diagnoseProviderExtraFields(
      response,
      KNOWN_PROVIDER_HTTP_FIELDS,
    ),
    fieldNames: value.entries.map((entry) => entry.name),
    fieldsComplete: value.entriesComplete,
    fieldsObserved: value.entriesObserved,
    fieldsOmitted: value.entriesOmitted,
    headers: diagnoseProviderHeaders(readUnknownProperty(response, 'headers')),
    reason:
      typeof reason === 'string' && reason.length > 0
        ? diagnosePrivateProviderText(
            reason,
            'Private provider HTTP reason omitted',
          )
        : null,
    statusCode:
      typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
        ? status
        : typeof statusCode === 'number' &&
            Number.isInteger(statusCode) &&
            statusCode >= 100 &&
            statusCode <= 599
          ? statusCode
          : null,
    urlDiagnostic:
      typeof url === 'string' && url.length > 0
        ? diagnosePrivateProviderText(url, 'Private provider URL omitted')
        : null,
  };
}

function requestProviderStreamCancellation(reader: {
  cancel(reason?: unknown): Promise<void>;
}): Pick<
  ProviderTextDiagnostic,
  'streamCancellationError' | 'streamCancellationOutcome'
> {
  try {
    // Cancellation is cleanup, never part of the user-visible provider result.
    // Do not await the provider-controlled promise. Its eventual rejection is
    // consumed to avoid an unhandled rejection; the diagnostic says plainly
    // that the asynchronous outcome was not observed.
    void reader.cancel().catch(() => undefined);
    return {
      streamCancellationError: null,
      streamCancellationOutcome: 'requested-unobserved',
    };
  } catch (error) {
    return {
      streamCancellationError: diagnoseProviderOperationalError(error),
      streamCancellationOutcome: 'failed',
    };
  }
}

/**
 * Reads at most `maximumBytes` from a Fetch response and cancels immediately on
 * overflow. A partial fingerprint is never labeled as a complete fingerprint.
 */
export async function readProviderResponseBody(
  response: Response,
  maximumBytes: number,
  summaryLength = DEFAULT_TEXT_SUMMARY_LENGTH,
): Promise<ReadProviderBodyResult> {
  const declaredByteLength = declaredLengthFromHeaders(response.headers);
  if (response.body === null) {
    const empty = new Uint8Array();
    return {
      diagnostic: textDiagnosticFromBytes({
        bytes: empty,
        byteLengthComplete: true,
        declaredByteLength,
        fingerprintCoversCompleteValue: true,
        inspectionTruncated: false,
        observedByteLength: 0,
        summaryMaximumLength: summaryLength,
      }),
      text: '',
    };
  }

  const reader = response.body.getReader();
  const retained: Uint8Array[] = [];
  let retainedBytes = 0;
  let observedByteLength = 0;
  for (;;) {
    let result: Awaited<ReturnType<typeof reader.read>>;
    try {
      result = await reader.read();
    } catch (error) {
      const cancellation = requestProviderStreamCancellation(reader);
      const bytes = Buffer.concat(retained.map((chunk) => Buffer.from(chunk)));
      throw new ProviderBodyReadError(
        {
          ...textDiagnosticFromBytes({
            bytes,
            byteLengthComplete: false,
            declaredByteLength,
            fingerprintCoversCompleteValue: false,
            inspectionTruncated: true,
            observedByteLength,
            summaryMaximumLength: summaryLength,
          }),
          ...cancellation,
        },
        new TextDecoder().decode(bytes),
        { cause: error },
      );
    }
    if (result.done) break;
    observedByteLength += result.value.byteLength;
    const remaining = maximumBytes - retainedBytes;
    if (remaining > 0) {
      const part = result.value.subarray(0, remaining);
      retained.push(new Uint8Array(part));
      retainedBytes += part.byteLength;
    }
    if (
      result.value.byteLength > remaining ||
      observedByteLength > maximumBytes
    ) {
      const cancellation = requestProviderStreamCancellation(reader);
      const bytes = Buffer.concat(retained.map((chunk) => Buffer.from(chunk)));
      return {
        diagnostic: {
          ...textDiagnosticFromBytes({
            bytes,
            byteLengthComplete: false,
            declaredByteLength,
            fingerprintCoversCompleteValue: false,
            inspectionTruncated: true,
            observedByteLength,
            summaryMaximumLength: summaryLength,
          }),
          ...cancellation,
        },
        text: new TextDecoder().decode(bytes),
      };
    }
  }

  const bytes = Buffer.concat(retained.map((chunk) => Buffer.from(chunk)));
  return {
    diagnostic: textDiagnosticFromBytes({
      bytes,
      byteLengthComplete: true,
      declaredByteLength,
      fingerprintCoversCompleteValue: true,
      inspectionTruncated: false,
      observedByteLength,
      summaryMaximumLength: summaryLength,
    }),
    text: new TextDecoder().decode(bytes),
  };
}

function transformOperationalDiagnostic(
  diagnostic: OperationalErrorDiagnostic,
): OperationalErrorDiagnostic {
  return {
    ...diagnostic,
    aggregateErrors: diagnostic.aggregateErrors.map((entry) =>
      transformOperationalDiagnostic(entry),
    ),
    cause:
      diagnostic.cause === null
        ? null
        : transformOperationalDiagnostic(diagnostic.cause),
    // Arbitrary network/library messages and stack frames can contain request
    // data not covered by lexical redaction. Complete fingerprints, exact
    // character/byte lengths, codes/statuses, cause/aggregate topology, and
    // stack counts retain correlation without copying uncontrolled prose.
    messageSummary: 'External provider operational failure',
    messageSummaryOmittedAsPrivate: true,
    messageTruncated: false,
    stackFrames: diagnostic.stackFrames.map(() => 'at [provider-frame]'),
    stackFramesOmittedAsPrivate: true,
  };
}

/** Retains provider error topology and correlation without arbitrary message prose. */
export function diagnoseProviderOperationalError(
  error: unknown,
): OperationalErrorDiagnostic {
  return transformOperationalDiagnostic(diagnoseOperationalError(error));
}

/** Reads a safe integer field from provider metadata. */
export function providerInteger(value: unknown): number | null {
  return boundedNonnegativeInteger(value);
}
