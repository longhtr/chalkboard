/** Proves feedback is processed only after envelope verification and subscription confirmation stays gated. */
import { Writable } from 'node:stream';

import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EmailFeedbackService } from '../email/feedback.js';
import {
  SnsFeedbackBoundaryError,
  type SnsEnvelope,
  type SnsEnvelopeVerifier,
} from '../email/snsFeedback.js';
import { serverLoggerOptions } from '../operations/serverLogger.js';
import { installEmailFeedbackRoutes } from './emailFeedbackRoutes.js';

const apps: ReturnType<typeof Fastify>[] = [];

function notification(): SnsEnvelope {
  return {
    Message: JSON.stringify({
      eventType: 'DELIVERY',
      mail: { messageId: 'provider-message' },
    }),
    MessageId: 'sns-event',
    Signature: 'verified-by-test-boundary',
    SignatureVersion: '2',
    SigningCertURL:
      'https://sns.ap-southeast-1.amazonaws.com/SimpleNotificationService-test.pem',
    Timestamp: '2026-08-10T12:00:00.000Z',
    TopicArn: 'arn:aws:sns:ap-southeast-1:000000000000:feedback',
    Type: 'Notification',
  };
}

function feedback(): EmailFeedbackService & {
  process: ReturnType<typeof vi.fn>;
} {
  return {
    process: vi.fn(async () => ({ outcome: 'processed' as const })),
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('email feedback HTTP route', () => {
  it('rejects before parsing or processing when envelope verification fails', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const service = feedback();
    const verifier: SnsEnvelopeVerifier = {
      verify: vi.fn(async () => {
        throw new SnsFeedbackBoundaryError('signature', false);
      }),
    };
    installEmailFeedbackRoutes(app, { feedback: service, verifier });

    const response = await app.inject({
      method: 'POST',
      payload: notification(),
      url: '/api/email-feedback/ses',
    });
    expect(response.statusCode).toBe(400);
    expect(service.process).not.toHaveBeenCalled();
  });

  it('returns retryable failure when certificate verification is temporarily unavailable', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const service = feedback();
    installEmailFeedbackRoutes(app, {
      feedback: service,
      verifier: {
        verify: vi.fn(async () => {
          throw new SnsFeedbackBoundaryError('certificate-fetch', true);
        }),
      },
    });

    const response = await app.inject({
      method: 'POST',
      payload: notification(),
      url: '/api/email-feedback/ses',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: 'Feedback verification is unavailable.',
      requestId: expect.any(String),
    });
    expect(service.process).not.toHaveBeenCalled();
  });

  it('treats an unclassified verifier failure as retryable instead of invalid input', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const service = feedback();
    const revocable = Proxy.revocable(
      new Error('private verifier failure'),
      {},
    );
    revocable.revoke();
    installEmailFeedbackRoutes(app, {
      feedback: service,
      verifier: {
        verify: vi.fn(async () => Promise.reject(revocable.proxy)),
      },
    });

    const response = await app.inject({
      method: 'POST',
      payload: notification(),
      url: '/api/email-feedback/ses',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: 'Feedback verification is unavailable.',
      requestId: expect.any(String),
    });
    expect(service.process).not.toHaveBeenCalled();
  });

  it('processes minimum parsed metadata after successful verification', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const service = feedback();
    const verified = notification();
    installEmailFeedbackRoutes(app, {
      feedback: service,
      verifier: { verify: vi.fn(async () => verified) },
    });

    const response = await app.inject({
      method: 'POST',
      payload: { attackerControlledBody: true },
      url: '/api/email-feedback/ses',
    });
    expect(response.statusCode).toBe(204);
    expect(service.process).toHaveBeenCalledWith({
      eventType: 'delivery',
      providerEventId: 'sns-event',
      providerMessageId: 'provider-message',
    });
  });

  it('returns 503 instead of falsely acknowledging authenticated database failure', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const verified = notification();
    const process = vi.fn(async () =>
      Promise.reject(new Error('database temporarily unavailable')),
    );
    installEmailFeedbackRoutes(app, {
      feedback: { process },
      verifier: { verify: vi.fn(async () => verified) },
    });

    const response = await app.inject({
      method: 'POST',
      payload: verified,
      url: '/api/email-feedback/ses',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: 'Feedback processing is unavailable.',
      requestId: expect.any(String),
    });
    expect(process).toHaveBeenCalledOnce();
  });

  it('logs only feedback type and outcome, never raw bodies or provider identifiers', async () => {
    const lines: string[] = [];
    const app = Fastify({
      logger: {
        level: 'info',
        stream: { write: (line: string) => lines.push(line) },
      },
    });
    apps.push(app);
    const service = feedback();
    const verified = notification();
    installEmailFeedbackRoutes(app, {
      feedback: service,
      verifier: { verify: vi.fn(async () => verified) },
    });
    const privateMarker = 'private-destination@example.com';
    const response = await app.inject({
      method: 'POST',
      payload: { privateMarker },
      url: '/api/email-feedback/ses',
    });
    expect(response.statusCode).toBe(204);
    const output = lines.join('');
    expect(output).toContain('emailFeedbackType');
    expect(output).not.toContain(privateMarker);
    expect(output).not.toContain(verified.Message);
    expect(output).not.toContain('provider-message');
    expect(output).not.toContain('sns-event');
  });

  it('preserves complete typed SNS failure evidence through the production logger', async () => {
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
    apps.push(app);
    const privateMarker = 'private-destination@example.com';
    const boundaryError = new SnsFeedbackBoundaryError(
      'certificate-fetch',
      true,
      {
        evidence: {
          envelopeFieldNames: [
            'Message',
            'MessageId',
            'Signature',
            'SigningCertURL',
          ],
          envelopeFieldsComplete: true,
          envelopeFieldsObserved: 4,
          envelopeFieldsOmitted: 0,
          providerHttp: {
            bodyDiagnostic: null,
            bodyPresent: true,
            bodyStructure: null,
            bodyType: 'stream-or-object',
            extraFields: [],
            fieldNames: ['body', 'headers', 'reason', 'statusCode'],
            fieldsComplete: true,
            fieldsObserved: 4,
            fieldsOmitted: 0,
            headers: {
              entries: [
                {
                  name: 'x-amzn-requestid',
                  nameFingerprint: null,
                  structuredValue: null,
                  value: {
                    byteLengthComplete: true,
                    declaredByteLength: null,
                    declaredByteLengthMatchesObserved: null,
                    fingerprint: 'a'.repeat(64),
                    fingerprintCoversCompleteValue: true,
                    inspectionTruncated: false,
                    observedByteLength: 27,
                    streamCancellationError: null,
                    streamCancellationOutcome: 'not-needed',
                    summary: 'certificate-correlation-id',
                    summaryOmittedAsPrivate: false,
                    summaryTruncated: false,
                    utf8Valid: true,
                  },
                  valueOmittedAsSensitive: false,
                  valueUnavailable: false,
                },
              ],
              entriesComplete: true,
              entryCount: 1,
              entriesOmitted: 0,
              unreadable: false,
            },
            reason: null,
            statusCode: 503,
            urlDiagnostic: null,
          },
          providerResponseDiagnostic: {
            byteLengthComplete: true,
            declaredByteLength: null,
            declaredByteLengthMatchesObserved: null,
            fingerprint: 'b'.repeat(64),
            fingerprintCoversCompleteValue: true,
            inspectionTruncated: false,
            observedByteLength: 100,
            streamCancellationError: null,
            streamCancellationOutcome: 'not-needed',
            summary: 'Private SNS response body omitted',
            summaryOmittedAsPrivate: true,
            summaryTruncated: false,
            utf8Valid: true,
          },
          request: {
            expectedCertificateHost: 'sns.ap-southeast-1.amazonaws.com',
            expectedRegion: 'ap-southeast-1',
            responseUrlMatchesRequest: true,
            stage: 'certificate',
          },
        },
      },
    );
    installEmailFeedbackRoutes(app, {
      feedback: feedback(),
      verifier: {
        verify: vi.fn(async () => Promise.reject(boundaryError)),
      },
    });

    const response = await app.inject({
      method: 'POST',
      payload: { privateMarker },
      url: '/api/email-feedback/ses',
    });
    expect(response.statusCode).toBe(503);
    const record = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry['snsFeedbackFailure'] !== undefined);
    expect(record).toMatchObject({
      snsFeedbackFailure: boundaryError.diagnostic(),
    });
    expect(output).not.toContain(privateMarker);
  });

  it('logs complete authenticated SES payload parse evidence without provider values', async () => {
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
    apps.push(app);
    const malformed = notification();
    malformed.Message = '{private-malformed-payload';
    installEmailFeedbackRoutes(app, {
      feedback: feedback(),
      verifier: { verify: vi.fn(async () => malformed) },
    });

    const response = await app.inject({
      method: 'POST',
      payload: { ignored: true },
      url: '/api/email-feedback/ses',
    });
    expect(response.statusCode).toBe(400);
    const record = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry['emailFeedbackRejection'] !== undefined);
    expect(record).toMatchObject({
      emailFeedbackRejection: {
        category: 'authenticated-provider-payload',
        diagnostic: {
          providerEventIdFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          providerPayloadDiagnostic: {
            fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
            observedByteLength: Buffer.byteLength(malformed.Message),
            summary: 'Private authenticated SES event payload omitted',
          },
          stage: 'json',
        },
        requestId: expect.any(String),
      },
    });
    expect(output).not.toContain(malformed.Message);
    expect(output).not.toContain(malformed.MessageId);
    expect(output).not.toContain('provider-message');
  });

  it('returns 503 for an unclassified confirmation failure', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const service = feedback();
    const confirmation: SnsEnvelope = {
      ...notification(),
      SubscribeURL: 'https://sns.ap-southeast-1.amazonaws.com/',
      Token: 'token',
      Type: 'SubscriptionConfirmation',
    };
    installEmailFeedbackRoutes(app, {
      confirmSubscription: vi.fn(async () => {
        throw new Error('internal confirmation failure');
      }),
      feedback: service,
      verifier: { verify: vi.fn(async () => confirmation) },
    });

    const response = await app.inject({
      method: 'POST',
      payload: confirmation,
      url: '/api/email-feedback/ses',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: 'Feedback subscription confirmation is unavailable.',
      requestId: expect.any(String),
    });
    expect(service.process).not.toHaveBeenCalled();
  });

  it('does not auto-confirm ownership unless an explicit confirmer is installed', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const service = feedback();
    const confirmation: SnsEnvelope = {
      ...notification(),
      SubscribeURL: 'https://sns.ap-southeast-1.amazonaws.com/',
      Token: 'token',
      Type: 'SubscriptionConfirmation',
    };
    const confirmSubscription = vi.fn(async () => undefined);
    installEmailFeedbackRoutes(app, {
      confirmSubscription,
      feedback: service,
      verifier: { verify: vi.fn(async () => confirmation) },
    });

    const response = await app.inject({
      method: 'POST',
      payload: confirmation,
      url: '/api/email-feedback/ses',
    });
    expect(response.statusCode).toBe(204);
    expect(confirmSubscription).toHaveBeenCalledWith(confirmation);
    expect(service.process).not.toHaveBeenCalled();
  });
});
