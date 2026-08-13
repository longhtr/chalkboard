/** Proves complete SES diagnostics survive logging while accidental private fields do not. */
import { Writable } from 'node:stream';

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { VerificationEmailDeliveryError } from '../accounts/verificationEmail.js';
import { serverLoggerOptions } from '../operations/serverLogger.js';
import {
  logAccountEmailBookkeepingFailure,
  logAccountEmailDeliveryFailure,
} from './deliveryDiagnostics.js';

describe('account-email delivery diagnostics', () => {
  it('logs complete accepted-send reconciliation evidence without provider identifiers', async () => {
    let output = '';
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const app = Fastify({
      logger: { ...serverLoggerOptions('info'), stream },
    });
    const privateProviderMessageId = 'private-provider-message-id';
    const diagnostic = {
      operationalError: {
        aggregateErrors: [],
        aggregateErrorsComplete: true,
        aggregateErrorsObserved: 0,
        aggregateErrorsOmitted: 0,
        cause: null,
        causeOmitted: false,
        causeUnavailable: false,
        errorCode: '40001',
        fingerprint: 'c'.repeat(64),
        fingerprintCoversCompleteValue: true as const,
        messageByteLength: 20,
        messageInspectionTruncated: false,
        messageLength: 20,
        messageSummary: 'database unavailable',
        messageSummaryOmittedAsPrivate: false,
        messageTruncated: false,
        name: 'Error',
        stackByteLength: 0,
        stackFrames: [],
        stackFramesComplete: true,
        stackFramesObserved: 0,
        stackFramesOmitted: 0,
        stackFramesOmittedAsPrivate: false,
        stackInspectionTruncated: false,
        stackLength: 0,
        statusCode: null,
      },
      providerAcceptance: {
        providerHttp: null,
        providerMessageIdDiagnostic: {
          byteLengthComplete: true,
          declaredByteLength: null,
          declaredByteLengthMatchesObserved: null,
          fingerprint: 'd'.repeat(64),
          fingerprintCoversCompleteValue: true,
          inspectionTruncated: false,
          observedByteLength: privateProviderMessageId.length,
          streamCancellationError: null,
          streamCancellationOutcome: 'not-needed' as const,
          summary: 'Accepted provider message identifier omitted',
          summaryOmittedAsPrivate: true,
          summaryTruncated: false,
          utf8Valid: true,
        },
        providerMetadata: {
          attempts: 1,
          cfId: null,
          clockSkewCorrected: false,
          extendedRequestId: null,
          extraFields: [],
          fieldNames: ['attempts', 'httpStatusCode', 'requestId'],
          fieldsComplete: true,
          fieldsObserved: 3,
          fieldsOmitted: 0,
          httpStatusCode: 200,
          requestId: 'provider-success-request-id',
          totalRetryDelayMilliseconds: 0,
        },
        providerResponseExtraFields: [],
        providerResponseFieldNames: ['$metadata', 'MessageId'],
        providerResponseFieldsComplete: true,
        providerResponseFieldsObserved: 2,
        providerResponseFieldsOmitted: 0,
        request: {
          action: 'ses:SendEmail' as const,
          configurationSet: 'chalkboard-transactional',
          contentMode: 'simple-html-and-text' as const,
          destinationCount: 1 as const,
          fromMatchesConfiguredValue: true as const,
          maxAttempts: 1 as const,
          region: 'ap-southeast-1',
          replyToCount: 1 as const,
          timeoutMilliseconds: 10_000,
        },
      },
      purpose: 'password-reset' as const,
      stage: 'accepted-send-bookkeeping' as const,
      ...({ providerMessageId: privateProviderMessageId } as object),
    };

    logAccountEmailBookkeepingFailure(app.log, diagnostic);
    await app.close();
    const record = JSON.parse(output) as {
      accountEmailBookkeepingFailure: Record<string, unknown>;
    };
    expect(record.accountEmailBookkeepingFailure).toEqual({
      ...diagnostic,
      providerMessageId: '[Redacted]',
    });
    expect(output).not.toContain(privateProviderMessageId);
    expect(output).toContain('provider-success-request-id');
  });

  it('logs the complete adapter-sanitized provider record without private values', async () => {
    let output = '';
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const app = Fastify({
      logger: {
        ...serverLoggerOptions('info'),
        stream,
      },
    });
    const failure = new VerificationEmailDeliveryError('delivery failed', {
      certainty: 'rejected',
      deniedResourceCategory: 'recipient-identity',
      deniedResourceMatchesRequest: true,
      deniedResources: [
        {
          category: 'recipient-identity',
          fingerprint: 'a'.repeat(64),
          matchesRequest: true,
          occurrences: 1,
          partition: 'aws',
          region: 'ap-southeast-1',
          regionMatchesRequest: true,
          resourceType: 'identity',
          service: 'ses',
        },
      ],
      deniedResourcesComplete: true,
      deniedResourcesObserved: 1,
      deniedResourcesOmitted: 0,
      failureClass: 'provider-rejection',
      httpStatusCode: 403,
      providerActions: [{ action: 'ses:SendEmail', occurrences: 1 }],
      providerActionsComplete: true,
      providerActionsObserved: 1,
      providerActionsOmitted: 0,
      providerErrorFieldNames: [
        '$fault',
        '$metadata',
        '$response',
        'message',
        'name',
      ],
      providerErrorFieldsComplete: true,
      providerErrorFieldsObserved: 5,
      providerErrorFieldsOmitted: 0,
      providerErrorName: 'AccessDeniedException',
      providerFault: 'client',
      providerHttp: {
        bodyDiagnostic: null,
        bodyPresent: false,
        bodyStructure: null,
        bodyType: 'none',
        extraFields: [],
        fieldNames: ['body', 'headers', 'reason', 'statusCode'],
        fieldsComplete: true,
        fieldsObserved: 4,
        fieldsOmitted: 0,
        headers: {
          entries: [],
          entriesComplete: true,
          entryCount: 0,
          entriesOmitted: 0,
          unreadable: false,
        },
        reason: null,
        statusCode: 403,
        urlDiagnostic: null,
      },
      providerMessageDiagnostic: {
        byteLengthComplete: true,
        declaredByteLength: null,
        declaredByteLengthMatchesObserved: null,
        fingerprint: 'b'.repeat(64),
        fingerprintCoversCompleteValue: true,
        inspectionTruncated: false,
        observedByteLength: 114,
        streamCancellationError: null,
        streamCancellationOutcome: 'not-needed',
        summary: 'Private SES provider message omitted',
        summaryOmittedAsPrivate: true,
        summaryTruncated: false,
        utf8Valid: true,
      },
      providerMessageFingerprint: 'b'.repeat(64),
      providerMessageLength: 114,
      providerMessageSummary: 'Private SES provider message omitted',
      providerMessageTruncated: false,
      providerMetadata: {
        attempts: 1,
        cfId: null,
        clockSkewCorrected: false,
        extendedRequestId: null,
        extraFields: [],
        fieldNames: ['attempts', 'httpStatusCode', 'requestId'],
        fieldsComplete: true,
        fieldsObserved: 3,
        fieldsOmitted: 0,
        httpStatusCode: 403,
        requestId: '01234567-89ab-cdef-0123-456789abcdef',
        totalRetryDelayMilliseconds: 0,
      },
      providerOperationalError: null,
      providerRequestId: '01234567-89ab-cdef-0123-456789abcdef',
      providerResponseBodyDiagnostic: null,
      providerRetryable: { present: false, throttling: null },
      providerService: null,
      request: {
        action: 'ses:SendEmail',
        configurationSet: 'chalkboard-transactional',
        contentMode: 'simple-html-and-text',
        destinationCount: 1,
        fromMatchesConfiguredValue: true,
        maxAttempts: 1,
        region: 'ap-southeast-1',
        replyToCount: 1,
        timeoutMilliseconds: 10_000,
      },
    });
    const diagnostic = {
      ...failure.diagnostic(),
      purpose: 'password-reset' as const,
      ...({
        accountId: '123456789012',
        destination: 'private-destination@example.com',
        exceptionMessage: 'private exception',
        providerMessageId: 'private-message-id',
        providerResponseBody: 'private provider body',
        token: 'private-token',
      } as object),
    };

    logAccountEmailDeliveryFailure(app.log, diagnostic);
    await app.close();

    const record = JSON.parse(output) as {
      accountEmailDeliveryFailure: Record<string, unknown>;
      msg: string;
    };
    expect(record.msg).toBe('Account email delivery failed');
    expect(record.accountEmailDeliveryFailure).toEqual({
      ...failure.diagnostic(),
      purpose: 'password-reset',
      accountId: '[Redacted]',
      destination: '[Redacted]',
      exceptionMessage: '[Redacted]',
      providerMessageId: '[Redacted]',
      providerResponseBody: '[Redacted]',
      token: '[Redacted]',
    });
    expect(output).not.toContain('private-');
    expect(output).not.toContain('123456789012');
  });
});
