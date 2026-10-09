/** Proves complete provider diagnostics survive logging while accidental private fields do not. */
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
        providerResponseFieldNames: ['id'],
        providerResponseFieldsComplete: true,
        providerResponseFieldsObserved: 1,
        providerResponseFieldsOmitted: 0,
        request: {
          action: 'resend:SendEmail' as const,
          attemptsMade: 1,
          contentMode: 'simple-html-and-text' as const,
          destinationCount: 1 as const,
          fromMatchesConfiguredValue: true as const,
          idempotencyWindowHours: 24,
          idempotent: true as const,
          maxAttempts: 2 as const,
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
      failureClass: 'provider-rejection',
      httpStatusCode: 403,
      providerErrorName: 'InvalidApiKey',
      providerErrorType: 'invalid_api_key',
      providerFault: 'client',
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
        summary: 'Provider refusal message omitted',
        summaryOmittedAsPrivate: true,
        summaryTruncated: false,
        utf8Valid: true,
      },
      providerOperationalError: null,
      providerResponseFieldNames: ['message', 'name'],
      request: {
        action: 'resend:SendEmail',
        attemptsMade: 1,
        contentMode: 'simple-html-and-text',
        destinationCount: 1,
        fromMatchesConfiguredValue: true,
        idempotencyWindowHours: 24,
        idempotent: true,
        maxAttempts: 2,
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
