/** Provider-neutral account-security email composition and SES delivery. */
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { createHash, randomUUID } from 'node:crypto';

import type { AppConfig } from '../config.js';
import type { EmailFailureClass, EmailFlow } from '../email/emailSecurity.js';
import type { OperationalErrorDiagnostic } from '../operations/errorDiagnostics.js';
import {
  isErrorInstance,
  readUnknownProperty,
} from '../operations/errorDiagnostics.js';
import {
  diagnosePrivateProviderText,
  diagnoseProviderHttp,
  diagnoseProviderOperationalError,
  diagnoseProviderResponseStructure,
  providerInteger,
  diagnoseProviderValue,
  type ProviderHttpDiagnostic,
  type ProviderResponseStructureDiagnostic,
  type ProviderTextDiagnostic,
  type ProviderValueEntryDiagnostic,
} from '../operations/providerDiagnostics.js';

export type VerificationEmailPurpose = EmailFlow;

interface VerificationEmailMessage {
  html: string;
  subject: string;
  text: string;
}

export interface VerificationEmailAcceptanceDiagnostic {
  providerHttp: ProviderHttpDiagnostic | null;
  providerMessageIdDiagnostic: ProviderTextDiagnostic;
  providerMetadata: VerificationEmailProviderMetadataDiagnostic | null;
  providerResponseExtraFields: ProviderValueEntryDiagnostic[];
  providerResponseFieldNames: string[];
  providerResponseFieldsComplete: boolean;
  providerResponseFieldsObserved: number;
  providerResponseFieldsOmitted: number;
  request: VerificationEmailRequestDiagnostic;
}

export interface VerificationEmailDelivery {
  acceptanceDiagnostic?: VerificationEmailAcceptanceDiagnostic;
  providerMessageId: string;
}

export type VerificationEmailProviderErrorName =
  | 'AccessDenied'
  | 'AccessDeniedException'
  | 'AccountSuspendedException'
  | 'BadRequestException'
  | 'InvalidProviderResponse'
  | 'LimitExceededException'
  | 'LocalConfigurationError'
  | 'LocalDestinationRestriction'
  | 'MailFromDomainNotVerifiedException'
  | 'MessageRejected'
  | 'NotFoundException'
  | 'OtherServiceError'
  | 'SendingPausedException'
  | 'ServiceUnavailableException'
  | 'TooManyRequestsException'
  | 'TransportError'
  | 'UnclassifiedError';

export type VerificationEmailDeniedResourceCategory =
  | 'configuration-set'
  | 'other-ses-resource'
  | 'recipient-identity'
  | 'sender-identity'
  | 'unknown';

export interface VerificationEmailDeniedResourceDiagnostic {
  category: VerificationEmailDeniedResourceCategory;
  fingerprint: string;
  matchesRequest: boolean | null;
  occurrences: number;
  partition: string;
  region: string;
  regionMatchesRequest: boolean;
  resourceType: string;
  service: string;
}

export interface VerificationEmailProviderActionDiagnostic {
  action: string;
  occurrences: number;
}

export interface VerificationEmailProviderMetadataDiagnostic {
  attempts: number | null;
  cfId: string | null;
  clockSkewCorrected: boolean | null;
  extendedRequestId: string | null;
  extraFields: ProviderValueEntryDiagnostic[];
  fieldNames: string[];
  fieldsComplete: boolean;
  fieldsObserved: number;
  fieldsOmitted: number;
  httpStatusCode: number | null;
  requestId: string | null;
  totalRetryDelayMilliseconds: number | null;
}

export interface VerificationEmailRequestDiagnostic {
  action: 'ses:SendEmail';
  configurationSet: string;
  contentMode: 'simple-html-and-text';
  destinationCount: 1;
  fromMatchesConfiguredValue: true;
  maxAttempts: 1;
  region: string;
  replyToCount: 1;
  timeoutMilliseconds: number;
}

export interface VerificationEmailFailureDiagnostic {
  certainty: 'ambiguous' | 'rejected';
  deniedResourceCategory: VerificationEmailDeniedResourceCategory;
  deniedResourceMatchesRequest: boolean | null;
  deniedResources: VerificationEmailDeniedResourceDiagnostic[];
  deniedResourcesComplete: boolean | null;
  deniedResourcesObserved: number;
  deniedResourcesOmitted: number;
  failureClass: EmailFailureClass;
  httpStatusCode: number | null;
  providerActions: VerificationEmailProviderActionDiagnostic[];
  providerActionsComplete: boolean | null;
  providerActionsObserved: number;
  providerActionsOmitted: number;
  providerErrorExtraFields: ProviderValueEntryDiagnostic[];
  providerErrorFieldNames: string[];
  providerErrorFieldsComplete: boolean;
  providerErrorFieldsObserved: number;
  providerErrorFieldsOmitted: number;
  providerErrorName: VerificationEmailProviderErrorName;
  providerFault: 'client' | 'server' | null;
  providerHttp: ProviderHttpDiagnostic | null;
  providerMessageDiagnostic: ProviderTextDiagnostic | null;
  providerMessageFingerprint: string | null;
  providerMessageLength: number | null;
  providerMessageSummary: string | null;
  providerMessageTruncated: boolean | null;
  providerMetadata: VerificationEmailProviderMetadataDiagnostic | null;
  providerOperationalError: OperationalErrorDiagnostic | null;
  providerRequestId: string | null;
  providerResponseBodyDiagnostic: ProviderTextDiagnostic | null;
  providerResponseExtraFields: ProviderValueEntryDiagnostic[];
  providerResponseFieldNames: string[];
  providerResponseFieldsComplete: boolean | null;
  providerResponseFieldsObserved: number;
  providerResponseFieldsOmitted: number;
  providerResponseStructure: ProviderResponseStructureDiagnostic | null;
  providerRetryable: { present: boolean; throttling: boolean | null };
  providerService: ProviderTextDiagnostic | null;
  request: VerificationEmailRequestDiagnostic | null;
}

type RequiredProviderFailure = Pick<
  VerificationEmailFailureDiagnostic,
  'certainty' | 'failureClass' | 'httpStatusCode' | 'providerErrorName'
>;

type OptionalProviderEvidence = Omit<
  VerificationEmailFailureDiagnostic,
  keyof RequiredProviderFailure
>;

export class VerificationEmailDeliveryError extends Error {
  readonly certainty: VerificationEmailFailureDiagnostic['certainty'];
  readonly deniedResourceCategory: VerificationEmailDeniedResourceCategory;
  readonly deniedResourceMatchesRequest: boolean | null;
  readonly deniedResources: VerificationEmailDeniedResourceDiagnostic[];
  readonly deniedResourcesComplete: boolean | null;
  readonly deniedResourcesObserved: number;
  readonly deniedResourcesOmitted: number;
  readonly failureClass: EmailFailureClass;
  readonly httpStatusCode: number | null;
  readonly providerActions: VerificationEmailProviderActionDiagnostic[];
  readonly providerActionsComplete: boolean | null;
  readonly providerActionsObserved: number;
  readonly providerActionsOmitted: number;
  readonly providerErrorExtraFields: ProviderValueEntryDiagnostic[];
  readonly providerErrorFieldNames: string[];
  readonly providerErrorFieldsComplete: boolean;
  readonly providerErrorFieldsObserved: number;
  readonly providerErrorFieldsOmitted: number;
  readonly providerErrorName: VerificationEmailProviderErrorName;
  readonly providerFault: 'client' | 'server' | null;
  readonly providerHttp: ProviderHttpDiagnostic | null;
  readonly providerMessageDiagnostic: ProviderTextDiagnostic | null;
  readonly providerMessageFingerprint: string | null;
  readonly providerMessageLength: number | null;
  readonly providerMessageSummary: string | null;
  readonly providerMessageTruncated: boolean | null;
  readonly providerMetadata: VerificationEmailProviderMetadataDiagnostic | null;
  readonly providerOperationalError: OperationalErrorDiagnostic | null;
  readonly providerRequestId: string | null;
  readonly providerResponseBodyDiagnostic: ProviderTextDiagnostic | null;
  readonly providerResponseExtraFields: ProviderValueEntryDiagnostic[];
  readonly providerResponseFieldNames: string[];
  readonly providerResponseFieldsComplete: boolean | null;
  readonly providerResponseFieldsObserved: number;
  readonly providerResponseFieldsOmitted: number;
  readonly providerResponseStructure: ProviderResponseStructureDiagnostic | null;
  readonly providerRetryable: { present: boolean; throttling: boolean | null };
  readonly providerService: ProviderTextDiagnostic | null;
  readonly request: VerificationEmailRequestDiagnostic | null;

  constructor(
    message: string,
    options: RequiredProviderFailure &
      Partial<OptionalProviderEvidence> & { cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'VerificationEmailDeliveryError';
    this.certainty = options.certainty;
    this.deniedResourceCategory = options.deniedResourceCategory ?? 'unknown';
    this.deniedResourceMatchesRequest =
      options.deniedResourceMatchesRequest ?? null;
    this.deniedResources = options.deniedResources ?? [];
    this.deniedResourcesComplete = options.deniedResourcesComplete ?? null;
    this.deniedResourcesObserved = options.deniedResourcesObserved ?? 0;
    this.deniedResourcesOmitted = options.deniedResourcesOmitted ?? 0;
    this.failureClass = options.failureClass;
    this.httpStatusCode = options.httpStatusCode;
    this.providerActions = options.providerActions ?? [];
    this.providerActionsComplete = options.providerActionsComplete ?? null;
    this.providerActionsObserved = options.providerActionsObserved ?? 0;
    this.providerActionsOmitted = options.providerActionsOmitted ?? 0;
    this.providerErrorExtraFields = options.providerErrorExtraFields ?? [];
    this.providerErrorFieldNames = options.providerErrorFieldNames ?? [];
    this.providerErrorFieldsComplete =
      options.providerErrorFieldsComplete ?? true;
    this.providerErrorFieldsObserved = options.providerErrorFieldsObserved ?? 0;
    this.providerErrorFieldsOmitted = options.providerErrorFieldsOmitted ?? 0;
    this.providerErrorName = options.providerErrorName;
    this.providerFault = options.providerFault ?? null;
    this.providerHttp = options.providerHttp ?? null;
    this.providerMessageDiagnostic = options.providerMessageDiagnostic ?? null;
    this.providerMessageFingerprint =
      options.providerMessageFingerprint ?? null;
    this.providerMessageLength = options.providerMessageLength ?? null;
    this.providerMessageSummary = options.providerMessageSummary ?? null;
    this.providerMessageTruncated = options.providerMessageTruncated ?? null;
    this.providerMetadata = options.providerMetadata ?? null;
    this.providerOperationalError = options.providerOperationalError ?? null;
    this.providerRequestId = options.providerRequestId ?? null;
    this.providerResponseBodyDiagnostic =
      options.providerResponseBodyDiagnostic ?? null;
    this.providerResponseExtraFields =
      options.providerResponseExtraFields ?? [];
    this.providerResponseFieldNames = options.providerResponseFieldNames ?? [];
    this.providerResponseFieldsComplete =
      options.providerResponseFieldsComplete ?? null;
    this.providerResponseFieldsObserved =
      options.providerResponseFieldsObserved ?? 0;
    this.providerResponseFieldsOmitted =
      options.providerResponseFieldsOmitted ?? 0;
    this.providerResponseStructure = options.providerResponseStructure ?? null;
    this.providerRetryable = options.providerRetryable ?? {
      present: false,
      throttling: null,
    };
    this.providerService = options.providerService ?? null;
    this.request = options.request ?? null;
  }

  /** Returns the complete sanitized provider record for workflow propagation. */
  diagnostic(): VerificationEmailFailureDiagnostic {
    return {
      certainty: this.certainty,
      deniedResourceCategory: this.deniedResourceCategory,
      deniedResourceMatchesRequest: this.deniedResourceMatchesRequest,
      deniedResources: this.deniedResources,
      deniedResourcesComplete: this.deniedResourcesComplete,
      deniedResourcesObserved: this.deniedResourcesObserved,
      deniedResourcesOmitted: this.deniedResourcesOmitted,
      failureClass: this.failureClass,
      httpStatusCode: this.httpStatusCode,
      providerActions: this.providerActions,
      providerActionsComplete: this.providerActionsComplete,
      providerActionsObserved: this.providerActionsObserved,
      providerActionsOmitted: this.providerActionsOmitted,
      providerErrorExtraFields: this.providerErrorExtraFields,
      providerErrorFieldNames: this.providerErrorFieldNames,
      providerErrorFieldsComplete: this.providerErrorFieldsComplete,
      providerErrorFieldsObserved: this.providerErrorFieldsObserved,
      providerErrorFieldsOmitted: this.providerErrorFieldsOmitted,
      providerErrorName: this.providerErrorName,
      providerFault: this.providerFault,
      providerHttp: this.providerHttp,
      providerMessageDiagnostic: this.providerMessageDiagnostic,
      providerMessageFingerprint: this.providerMessageFingerprint,
      providerMessageLength: this.providerMessageLength,
      providerMessageSummary: this.providerMessageSummary,
      providerMessageTruncated: this.providerMessageTruncated,
      providerMetadata: this.providerMetadata,
      providerOperationalError: this.providerOperationalError,
      providerRequestId: this.providerRequestId,
      providerResponseBodyDiagnostic: this.providerResponseBodyDiagnostic,
      providerResponseExtraFields: this.providerResponseExtraFields,
      providerResponseFieldNames: this.providerResponseFieldNames,
      providerResponseFieldsComplete: this.providerResponseFieldsComplete,
      providerResponseFieldsObserved: this.providerResponseFieldsObserved,
      providerResponseFieldsOmitted: this.providerResponseFieldsOmitted,
      providerResponseStructure: this.providerResponseStructure,
      providerRetryable: this.providerRetryable,
      providerService: this.providerService,
      request: this.request,
    };
  }
}

export interface VerificationEmailSender {
  close(): void;
  send(input: {
    code: string;
    intentId: string;
    purpose: VerificationEmailPurpose;
    to: string;
  }): Promise<VerificationEmailDelivery>;
}

export interface DevelopmentEmail {
  createdAt: string;
  html: string;
  id: string;
  purpose: VerificationEmailPurpose;
  subject: string;
  text: string;
  to: string;
}

export interface DevelopmentEmailInbox {
  list(): readonly DevelopmentEmail[];
}

const GENERIC_SUBJECTS: Record<VerificationEmailPurpose, string> = {
  registration: 'Confirm your Chalkboard account',
  'password-reset': 'Reset your Chalkboard password',
  'email-change': 'Confirm your Chalkboard email change',
};

const SES_SEND_TIMEOUT_MS = 10_000;

const ACTION_DESCRIPTIONS: Record<VerificationEmailPurpose, string> = {
  registration: 'finish creating your Chalkboard account',
  'password-reset': 'reset your Chalkboard password',
  'email-change': 'confirm the new email address for your Chalkboard account',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Builds one branded message with a generic subject and code only in its body. */
export function verificationEmailMessage(
  purpose: VerificationEmailPurpose,
  code: string,
  publicOrigin: string,
): VerificationEmailMessage {
  const subject = GENERIC_SUBJECTS[purpose];
  const action = ACTION_DESCRIPTIONS[purpose];
  const privacyUrl = `${publicOrigin}/privacy`;
  const termsUrl = `${publicOrigin}/terms`;
  const contactUrl = `${publicOrigin}/contact`;
  const text = [
    'Chalkboard',
    '',
    `Use this code to ${action}:`,
    '',
    code,
    '',
    'This code expires in 15 minutes.',
    'If you did not request this action, ignore this message. Do not share the code.',
    '',
    `Privacy: ${privacyUrl}`,
    `Terms: ${termsUrl}`,
    `Contact: ${contactUrl}`,
  ].join('\n');
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f1e8;color:#1f2937;font-family:Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px">
      <div style="background:#fff;border:1px solid #d6d3c8;border-radius:12px;padding:28px">
        <h1 style="font-size:22px;margin:0 0 20px">Chalkboard</h1>
        <p style="line-height:1.5">Use this code to ${escapeHtml(action)}:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:0.12em;margin:24px 0">${escapeHtml(code)}</p>
        <p style="line-height:1.5">This code expires in 15 minutes.</p>
        <p style="line-height:1.5">If you did not request this action, ignore this message. Do not share the code.</p>
        <p style="font-size:13px;margin-top:28px">
          <a href="${escapeHtml(privacyUrl)}">Privacy</a> ·
          <a href="${escapeHtml(termsUrl)}">Terms</a> ·
          <a href="${escapeHtml(contactUrl)}">Contact</a>
        </p>
      </div>
    </div>
  </body>
</html>`;
  return { html, subject, text };
}

const ALLOWED_SES_ERROR_NAMES = new Set<VerificationEmailProviderErrorName>([
  'AccessDenied',
  'AccessDeniedException',
  'AccountSuspendedException',
  'BadRequestException',
  'LimitExceededException',
  'MailFromDomainNotVerifiedException',
  'MessageRejected',
  'NotFoundException',
  'SendingPausedException',
  'ServiceUnavailableException',
  'TooManyRequestsException',
]);

const serviceProperty = readUnknownProperty;

function serviceErrorName(error: unknown): VerificationEmailProviderErrorName {
  const candidate = serviceProperty(error, 'name');
  const name = typeof candidate === 'string' ? candidate : '';
  return ALLOWED_SES_ERROR_NAMES.has(name as VerificationEmailProviderErrorName)
    ? (name as VerificationEmailProviderErrorName)
    : 'OtherServiceError';
}

const MAX_PROVIDER_OBJECT_FIELDS = 64;
const MAX_PROVIDER_ACTIONS = 32;
const MAX_PROVIDER_RESOURCES = 32;
const PROVIDER_MESSAGE_INSPECTION_BYTES = 64 * 1_024;
const PROVIDER_CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:+/=-]{1,512}$/u;

function providerObjectFields(value: unknown): {
  complete: boolean;
  names: string[];
  observed: number;
  omitted: number;
} {
  if (typeof value !== 'object' || value === null) {
    return { complete: true, names: [], observed: 0, omitted: 0 };
  }
  try {
    const all = Object.keys(value);
    const retained = all.slice(0, MAX_PROVIDER_OBJECT_FIELDS);
    return {
      complete: all.length <= MAX_PROVIDER_OBJECT_FIELDS,
      names: retained.map((name) =>
        /^[A-Za-z0-9_$.-]{1,128}$/u.test(name)
          ? name
          : `[field:${createHash('sha256').update(name).digest('hex')}]`,
      ),
      observed: all.length,
      omitted: Math.max(0, all.length - retained.length),
    };
  } catch {
    return { complete: false, names: [], observed: 0, omitted: 0 };
  }
}

function providerExtraFields(
  value: unknown,
  known: ReadonlySet<string>,
): ProviderValueEntryDiagnostic[] {
  if (typeof value !== 'object' || value === null) return [];
  let names: string[];
  try {
    names = Object.keys(value).slice(0, MAX_PROVIDER_OBJECT_FIELDS);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    if (known.has(name)) return [];
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, name);
    } catch {
      descriptor = undefined;
    }
    const safeName = /^[A-Za-z0-9_$.-]{1,128}$/u.test(name)
      ? { name, nameFingerprint: null }
      : {
          name: '[private-field]',
          nameFingerprint: createHash('sha256').update(name).digest('hex'),
        };
    return [
      {
        ...safeName,
        value:
          descriptor === undefined || !('value' in descriptor)
            ? diagnoseProviderValue(undefined)
            : diagnoseProviderValue(descriptor.value),
      },
    ];
  });
}

const KNOWN_PROVIDER_ERROR_FIELDS = new Set([
  '$fault',
  '$metadata',
  '$response',
  '$responseBodyText',
  '$retryable',
  '$service',
  'cause',
  'message',
  'name',
  'stack',
]);
const KNOWN_PROVIDER_METADATA_FIELDS = new Set([
  'attempts',
  'cfId',
  'clockSkewCorrected',
  'extendedRequestId',
  'httpStatusCode',
  'requestId',
  'totalRetryDelay',
]);
const KNOWN_PROVIDER_RESPONSE_FIELDS = new Set(['$metadata', 'MessageId']);

function serviceMetadata(error: unknown): object | null {
  const metadata = serviceProperty(error, '$metadata');
  return typeof metadata === 'object' && metadata !== null ? metadata : null;
}

function providerCorrelationId(value: unknown): string | null {
  return typeof value === 'string' &&
    PROVIDER_CORRELATION_ID_PATTERN.test(value)
    ? value
    : null;
}

function serviceMetadataDiagnostic(
  error: unknown,
): VerificationEmailProviderMetadataDiagnostic | null {
  const metadata = serviceMetadata(error);
  if (metadata === null) return null;
  const fields = providerObjectFields(metadata);
  const clockSkewCorrected = serviceProperty(metadata, 'clockSkewCorrected');
  const httpStatusCode = serviceProperty(metadata, 'httpStatusCode');
  return {
    attempts: providerInteger(serviceProperty(metadata, 'attempts')),
    cfId: providerCorrelationId(serviceProperty(metadata, 'cfId')),
    clockSkewCorrected:
      typeof clockSkewCorrected === 'boolean' ? clockSkewCorrected : null,
    extendedRequestId: providerCorrelationId(
      serviceProperty(metadata, 'extendedRequestId'),
    ),
    extraFields: providerExtraFields(metadata, KNOWN_PROVIDER_METADATA_FIELDS),
    fieldNames: fields.names,
    fieldsComplete: fields.complete,
    fieldsObserved: fields.observed,
    fieldsOmitted: fields.omitted,
    httpStatusCode:
      typeof httpStatusCode === 'number' &&
      Number.isInteger(httpStatusCode) &&
      httpStatusCode >= 100 &&
      httpStatusCode <= 599
        ? httpStatusCode
        : null,
    requestId: providerCorrelationId(serviceProperty(metadata, 'requestId')),
    totalRetryDelayMilliseconds: providerInteger(
      serviceProperty(metadata, 'totalRetryDelay'),
    ),
  };
}

function serviceHttpStatus(error: unknown): number | null {
  const metadataStatus =
    serviceMetadataDiagnostic(error)?.httpStatusCode ?? null;
  if (metadataStatus !== null) return metadataStatus;
  return diagnoseProviderHttp(serviceProperty(error, '$response')).statusCode;
}

function serviceErrorMessage(error: unknown): string | null {
  if (!isErrorInstance(error, Error)) return null;
  const message = serviceProperty(error, 'message');
  return typeof message === 'string' && message.length > 0 ? message : null;
}

function mailboxFromHeader(value: string): string {
  const bracketed = value.match(/<([^<>]+)>/u)?.[1];
  return (bracketed ?? value).trim().toLocaleLowerCase('en-US');
}

function classifyDeniedResource(
  resourceType: string,
  resourceValue: string,
  request: { configurationSet: string; from: string; to: string },
): Pick<
  VerificationEmailDeniedResourceDiagnostic,
  'category' | 'matchesRequest'
> {
  const normalizedType = resourceType.toLocaleLowerCase('en-US');
  const normalizedValue = resourceValue.toLocaleLowerCase('en-US');
  const configurationSet = request.configurationSet.toLocaleLowerCase('en-US');
  const destination = request.to.trim().toLocaleLowerCase('en-US');
  const sender = mailboxFromHeader(request.from);
  const senderDomain = sender.split('@')[1] ?? '';
  if (normalizedType === 'identity' && normalizedValue === destination) {
    return { category: 'recipient-identity', matchesRequest: true };
  }
  if (
    normalizedType === 'configuration-set' &&
    normalizedValue === configurationSet
  ) {
    return { category: 'configuration-set', matchesRequest: true };
  }
  if (
    normalizedType === 'identity' &&
    (normalizedValue === sender || normalizedValue === senderDomain)
  ) {
    return { category: 'sender-identity', matchesRequest: true };
  }
  return { category: 'other-ses-resource', matchesRequest: false };
}

function deniedResourceEvidence(
  message: string,
  messageDiagnostic: ProviderTextDiagnostic,
  request: {
    configurationSet: string;
    from: string;
    region: string;
    to: string;
  },
): Pick<
  VerificationEmailFailureDiagnostic,
  | 'deniedResourceCategory'
  | 'deniedResourceMatchesRequest'
  | 'deniedResources'
  | 'deniedResourcesComplete'
  | 'deniedResourcesObserved'
  | 'deniedResourcesOmitted'
> {
  const resources = new Map<
    string,
    VerificationEmailDeniedResourceDiagnostic
  >();
  let observed = 0;
  const inspected = Buffer.from(message, 'utf8')
    .subarray(0, PROVIDER_MESSAGE_INSPECTION_BYTES)
    .toString('utf8');
  const pattern =
    /arn:([a-z0-9-]{1,32}):ses:([a-z0-9-]{0,32}):(\d{12}):([A-Za-z0-9_.-]{1,64})\/([^\s,'"`;()]{1,512})/giu;
  for (const match of inspected.matchAll(pattern)) {
    const [arn, partition, region, , resourceType, resourceValue] = match;
    if (
      arn === undefined ||
      partition === undefined ||
      region === undefined ||
      resourceType === undefined ||
      resourceValue === undefined
    ) {
      continue;
    }
    observed += 1;
    const fingerprint = createHash('sha256').update(arn).digest('hex');
    const existing = resources.get(fingerprint);
    if (existing !== undefined) {
      existing.occurrences += 1;
      continue;
    }
    if (resources.size >= MAX_PROVIDER_RESOURCES) continue;
    const classification = classifyDeniedResource(
      resourceType,
      resourceValue,
      request,
    );
    resources.set(fingerprint, {
      ...classification,
      fingerprint,
      occurrences: 1,
      partition: partition.toLocaleLowerCase('en-US'),
      region: region.toLocaleLowerCase('en-US'),
      regionMatchesRequest:
        region.toLocaleLowerCase('en-US') ===
        request.region.toLocaleLowerCase('en-US'),
      resourceType: resourceType.toLocaleLowerCase('en-US'),
      service: 'ses',
    });
  }
  const retained = [...resources.values()];
  const representedOccurrences = retained.reduce(
    (total, resource) => total + resource.occurrences,
    0,
  );
  const priority: VerificationEmailDeniedResourceCategory[] = [
    'recipient-identity',
    'configuration-set',
    'sender-identity',
    'other-ses-resource',
  ];
  const primary = priority
    .map((category) => retained.find((entry) => entry.category === category))
    .find((entry) => entry !== undefined);
  return {
    deniedResourceCategory: primary?.category ?? 'unknown',
    deniedResourceMatchesRequest: primary?.matchesRequest ?? null,
    deniedResources: retained,
    deniedResourcesComplete:
      !messageDiagnostic.inspectionTruncated &&
      observed === representedOccurrences,
    deniedResourcesObserved: observed,
    deniedResourcesOmitted: Math.max(0, observed - representedOccurrences),
  };
}

function providerActionEvidence(
  message: string,
  messageDiagnostic: ProviderTextDiagnostic,
): Pick<
  VerificationEmailFailureDiagnostic,
  | 'providerActions'
  | 'providerActionsComplete'
  | 'providerActionsObserved'
  | 'providerActionsOmitted'
> {
  const actions = new Map<string, VerificationEmailProviderActionDiagnostic>();
  let observed = 0;
  const inspected = Buffer.from(message, 'utf8')
    .subarray(0, PROVIDER_MESSAGE_INSPECTION_BYTES)
    .toString('utf8');
  for (const match of inspected.matchAll(
    /(?<![A-Za-z0-9_:])(ses:[A-Za-z][A-Za-z0-9]{0,63})\b/giu,
  )) {
    const action = match[1];
    if (action === undefined) continue;
    observed += 1;
    const normalized = action.toLocaleLowerCase('en-US');
    const existing = actions.get(normalized);
    if (existing !== undefined) {
      existing.occurrences += 1;
      continue;
    }
    if (actions.size < MAX_PROVIDER_ACTIONS) {
      actions.set(normalized, { action, occurrences: 1 });
    }
  }
  const retained = [...actions.values()];
  const representedOccurrences = retained.reduce(
    (total, action) => total + action.occurrences,
    0,
  );
  return {
    providerActions: retained,
    providerActionsComplete:
      !messageDiagnostic.inspectionTruncated &&
      observed === representedOccurrences,
    providerActionsObserved: observed,
    providerActionsOmitted: Math.max(0, observed - representedOccurrences),
  };
}

function retryableEvidence(error: unknown): {
  present: boolean;
  throttling: boolean | null;
} {
  const retryable = serviceProperty(error, '$retryable');
  if (typeof retryable !== 'object' || retryable === null) {
    return { present: false, throttling: null };
  }
  const throttling = serviceProperty(retryable, 'throttling');
  return {
    present: true,
    throttling: typeof throttling === 'boolean' ? throttling : null,
  };
}

function providerEvidence(
  error: unknown,
  request: {
    configurationSet: string;
    from: string;
    region: string;
    to: string;
  },
): OptionalProviderEvidence {
  const message = serviceErrorMessage(error);
  const providerMessage =
    message === null
      ? null
      : diagnosePrivateProviderText(
          message,
          'Private SES provider message omitted',
        );
  const responseBody = serviceProperty(error, '$responseBodyText');
  const providerResponseBodyDiagnostic =
    typeof responseBody === 'string'
      ? diagnosePrivateProviderText(
          responseBody,
          'Private SES response body omitted',
        )
      : null;
  const metadata = serviceMetadataDiagnostic(error);
  const fields = providerObjectFields(error);
  const rawResponse = serviceProperty(error, '$response');
  const providerHttp =
    rawResponse === undefined ? null : diagnoseProviderHttp(rawResponse);
  const fault = serviceProperty(error, '$fault');
  const service = serviceProperty(error, '$service');
  return {
    ...(message === null || providerMessage === null
      ? {
          deniedResourceCategory: 'unknown' as const,
          deniedResourceMatchesRequest: null,
          deniedResources: [],
          deniedResourcesComplete: message === null ? null : true,
          deniedResourcesObserved: 0,
          deniedResourcesOmitted: 0,
          providerActions: [],
          providerActionsComplete: message === null ? null : true,
          providerActionsObserved: 0,
          providerActionsOmitted: 0,
        }
      : {
          ...deniedResourceEvidence(message, providerMessage, request),
          ...providerActionEvidence(message, providerMessage),
        }),
    providerErrorExtraFields: providerExtraFields(
      error,
      KNOWN_PROVIDER_ERROR_FIELDS,
    ),
    providerErrorFieldNames: fields.names,
    providerErrorFieldsComplete: fields.complete,
    providerErrorFieldsObserved: fields.observed,
    providerErrorFieldsOmitted: fields.omitted,
    providerFault: fault === 'client' || fault === 'server' ? fault : null,
    providerHttp,
    providerMessageDiagnostic: providerMessage,
    providerMessageFingerprint: providerMessage?.fingerprint ?? null,
    providerMessageLength: providerMessage?.observedByteLength ?? null,
    providerMessageSummary: providerMessage?.summary ?? null,
    providerMessageTruncated:
      providerMessage === null
        ? null
        : providerMessage.inspectionTruncated ||
          providerMessage.summaryTruncated,
    providerMetadata: metadata,
    providerOperationalError: diagnoseProviderOperationalError(error),
    providerRequestId: metadata?.requestId ?? null,
    providerResponseBodyDiagnostic,
    providerResponseExtraFields: [],
    providerResponseFieldNames: [],
    providerResponseFieldsComplete: null,
    providerResponseFieldsObserved: 0,
    providerResponseFieldsOmitted: 0,
    providerResponseStructure:
      typeof responseBody === 'string'
        ? diagnoseProviderResponseStructure(responseBody)
        : (providerHttp?.bodyStructure ?? null),
    providerRetryable: retryableEvidence(error),
    providerService:
      typeof service === 'string' && service.length > 0
        ? diagnosePrivateProviderText(
            service,
            'Private SES service value omitted',
          )
        : null,
    request: {
      action: 'ses:SendEmail',
      configurationSet: request.configurationSet,
      contentMode: 'simple-html-and-text',
      destinationCount: 1,
      fromMatchesConfiguredValue: true,
      maxAttempts: 1,
      region: request.region,
      replyToCount: 1,
      timeoutMilliseconds: SES_SEND_TIMEOUT_MS,
    },
  };
}

function classifySesFailure(
  error: unknown,
  request: {
    configurationSet: string;
    from: string;
    region: string;
    to: string;
  },
): VerificationEmailDeliveryError {
  const status = serviceHttpStatus(error);
  const name = serviceErrorName(error);
  const evidence = providerEvidence(error, request);
  if (status !== null) {
    if (status >= 500) {
      return new VerificationEmailDeliveryError(
        'Email provider outcome is unknown after a service failure',
        {
          ...evidence,
          cause: error,
          certainty: 'ambiguous',
          failureClass: 'provider-rejection',
          httpStatusCode: status,
          providerErrorName: name,
        },
      );
    }
    const configurationNames = new Set<VerificationEmailProviderErrorName>([
      'AccountSuspendedException',
      'MailFromDomainNotVerifiedException',
      'SendingPausedException',
    ]);
    return new VerificationEmailDeliveryError(
      'Email provider rejected the message',
      {
        ...evidence,
        cause: error,
        certainty: 'rejected',
        failureClass: configurationNames.has(name)
          ? 'configuration'
          : name === 'MessageRejected'
            ? 'destination'
            : 'provider-rejection',
        httpStatusCode: status,
        providerErrorName: name,
      },
    );
  }
  return new VerificationEmailDeliveryError(
    'Email delivery outcome is unknown',
    {
      ...evidence,
      cause: error,
      certainty: 'ambiguous',
      failureClass: 'transport',
      httpStatusCode: null,
      providerErrorName: 'TransportError',
    },
  );
}

function invalidProviderResponseFailure(
  response: unknown,
  request: {
    configurationSet: string;
    region: string;
  },
): VerificationEmailDeliveryError {
  const fields = providerObjectFields(response);
  const messageId = serviceProperty(response, 'MessageId');
  const metadata = serviceMetadataDiagnostic(response);
  return new VerificationEmailDeliveryError(
    'Email provider accepted the request without a bounded message identifier',
    {
      certainty: 'ambiguous',
      failureClass: 'unknown',
      httpStatusCode: metadata?.httpStatusCode ?? null,
      providerErrorName: 'InvalidProviderResponse',
      providerMetadata: metadata,
      providerRequestId: metadata?.requestId ?? null,
      providerResponseExtraFields: providerExtraFields(
        response,
        KNOWN_PROVIDER_RESPONSE_FIELDS,
      ),
      providerResponseFieldNames: fields.names,
      providerResponseFieldsComplete: fields.complete,
      providerResponseFieldsObserved: fields.observed,
      providerResponseFieldsOmitted: fields.omitted,
      providerResponseBodyDiagnostic:
        typeof messageId === 'string'
          ? diagnosePrivateProviderText(
              messageId,
              'Invalid provider message identifier omitted',
            )
          : null,
      request: {
        action: 'ses:SendEmail',
        configurationSet: request.configurationSet,
        contentMode: 'simple-html-and-text',
        destinationCount: 1,
        fromMatchesConfiguredValue: true,
        maxAttempts: 1,
        region: request.region,
        replyToCount: 1,
        timeoutMilliseconds: SES_SEND_TIMEOUT_MS,
      },
    },
  );
}

/** Fail-closed sender used when production delivery configuration is unavailable. */
export function createUnavailableVerificationEmailSender(): VerificationEmailSender {
  return {
    close() {},
    async send() {
      throw new VerificationEmailDeliveryError(
        'Email delivery is temporarily unavailable',
        {
          certainty: 'rejected',
          failureClass: 'configuration',
          httpStatusCode: null,
          providerErrorName: 'LocalConfigurationError',
        },
      );
    },
  };
}

/** Creates SES delivery with one attempt and no startup readiness coupling. */
export function createSesVerificationEmailSender(
  configuration: NonNullable<AppConfig['verificationEmail']>,
): VerificationEmailSender {
  const client = new SESv2Client({
    maxAttempts: 1,
    region: configuration.region,
  });
  return {
    close() {
      client.destroy();
    },
    async send({ code, purpose, to }) {
      const { html, subject, text } = verificationEmailMessage(
        purpose,
        code,
        configuration.publicOrigin,
      );
      try {
        const response = await client.send(
          new SendEmailCommand({
            ConfigurationSetName: configuration.configurationSet,
            Content: {
              Simple: {
                Body: {
                  Html: { Charset: 'UTF-8', Data: html },
                  Text: { Charset: 'UTF-8', Data: text },
                },
                Subject: { Charset: 'UTF-8', Data: subject },
              },
            },
            Destination: { ToAddresses: [to] },
            FromEmailAddress: configuration.from,
            ReplyToAddresses: [configuration.replyTo],
          }),
          { abortSignal: AbortSignal.timeout(SES_SEND_TIMEOUT_MS) },
        );
        if (
          response.MessageId === undefined ||
          response.MessageId.length === 0 ||
          response.MessageId.length > 512
        ) {
          throw invalidProviderResponseFailure(response, {
            configurationSet: configuration.configurationSet,
            region: configuration.region,
          });
        }
        const fields = providerObjectFields(response);
        return {
          acceptanceDiagnostic: {
            providerHttp:
              serviceProperty(response, '$response') === undefined
                ? null
                : diagnoseProviderHttp(serviceProperty(response, '$response')),
            providerMessageIdDiagnostic: diagnosePrivateProviderText(
              response.MessageId,
              'Accepted provider message identifier omitted',
            ),
            providerMetadata: serviceMetadataDiagnostic(response),
            providerResponseExtraFields: providerExtraFields(
              response,
              KNOWN_PROVIDER_RESPONSE_FIELDS,
            ),
            providerResponseFieldNames: fields.names,
            providerResponseFieldsComplete: fields.complete,
            providerResponseFieldsObserved: fields.observed,
            providerResponseFieldsOmitted: fields.omitted,
            request: {
              action: 'ses:SendEmail',
              configurationSet: configuration.configurationSet,
              contentMode: 'simple-html-and-text',
              destinationCount: 1,
              fromMatchesConfiguredValue: true,
              maxAttempts: 1,
              region: configuration.region,
              replyToCount: 1,
              timeoutMilliseconds: SES_SEND_TIMEOUT_MS,
            },
          },
          providerMessageId: response.MessageId,
        };
      } catch (error) {
        if (isErrorInstance(error, VerificationEmailDeliveryError)) throw error;
        throw classifySesFailure(error, {
          configurationSet: configuration.configurationSet,
          from: configuration.from,
          region: configuration.region,
          to,
        });
      }
    },
  };
}

/** In-memory development sender exposed only through localhost development routes. */
export function createDevelopmentVerificationEmailSender(
  publicOrigin: string,
): {
  inbox: DevelopmentEmailInbox;
  sender: VerificationEmailSender;
} {
  const messages: DevelopmentEmail[] = [];
  return {
    inbox: { list: () => messages.map((message) => ({ ...message })) },
    sender: {
      close() {
        messages.length = 0;
      },
      async send({ code, purpose, to }) {
        if (!to.toLocaleLowerCase('en-US').endsWith('@chalkboard.test')) {
          throw new VerificationEmailDeliveryError(
            'Development email must use the chalkboard.test domain',
            {
              certainty: 'rejected',
              failureClass: 'destination',
              httpStatusCode: null,
              providerErrorName: 'LocalDestinationRestriction',
            },
          );
        }
        const message = verificationEmailMessage(purpose, code, publicOrigin);
        const id = randomUUID();
        messages.unshift({
          ...message,
          createdAt: new Date().toISOString(),
          id,
          purpose,
          to,
        });
        if (messages.length > 20) messages.length = 20;
        return { providerMessageId: `development:${id}` };
      },
    },
  };
}
