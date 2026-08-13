/** Covers real SNS v1/v2 signatures, canonical envelope variants, exact ownership, and minimum SES parsing. */
import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  confirmSnsSubscription,
  createSnsEnvelopeVerifier,
  parseSesFeedback,
  parseSesFeedbackDetailed,
  SesFeedbackPayloadError,
  SnsFeedbackBoundaryError,
  type SnsEnvelope,
} from './snsFeedback.js';

const region = 'ap-southeast-1';
const topicArn = 'arn:aws:sns:ap-southeast-1:000000000000:feedback';
const certificateUrl = `https://sns.${region}.amazonaws.com/SimpleNotificationService-test.pem`;
let fixtureRoot = '';
let certificate = '';
let privateKey = '';

beforeAll(() => {
  const parent = resolve('tmp/sns-signature-tests');
  mkdirSync(parent, { mode: 0o700, recursive: true });
  fixtureRoot = mkdtempSync(join(parent, 'case-'));
  const certificatePath = join(fixtureRoot, 'certificate.pem');
  const keyPath = join(fixtureRoot, 'key.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certificatePath,
      '-subj',
      '/CN=sns.ap-southeast-1.amazonaws.com',
      '-days',
      '1',
    ],
    { stdio: 'ignore' },
  );
  certificate = readFileSync(certificatePath, 'utf8');
  privateKey = readFileSync(keyPath, 'utf8');
});

afterAll(() => {
  privateKey = '';
  certificate = '';
  rmSync(fixtureRoot, { force: true, recursive: true });
});

function envelope(overrides: Partial<SnsEnvelope> = {}): SnsEnvelope {
  return {
    Message: JSON.stringify({
      eventType: 'BOUNCE',
      bounce: {
        bounceType: 'Permanent',
        bouncedRecipients: [{ emailAddress: 'private@example.com' }],
      },
      mail: {
        destination: ['private@example.com'],
        messageId: 'provider-message',
        timestamp: '2026-08-10T12:00:00.000Z',
      },
    }),
    MessageId: 'sns-event',
    Signature: 'not-a-real-signature',
    SignatureVersion: '2',
    SigningCertURL: certificateUrl,
    Timestamp: '2026-08-10T12:00:00.000Z',
    TopicArn: topicArn,
    Type: 'Notification',
    ...overrides,
  };
}

function canonical(envelopeValue: SnsEnvelope): string {
  const keys =
    envelopeValue.Type === 'Notification'
      ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
      : [
          'Message',
          'MessageId',
          'SubscribeURL',
          'Timestamp',
          'Token',
          'TopicArn',
          'Type',
        ];
  return keys
    .filter((key) => envelopeValue[key as keyof SnsEnvelope] !== undefined)
    .map(
      (key) => `${key}\n${envelopeValue[key as keyof SnsEnvelope] as string}\n`,
    )
    .join('');
}

function signed(
  value: SnsEnvelope,
  signatureVersion: '1' | '2' = '2',
): SnsEnvelope {
  const signer = createSign(
    signatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256',
  );
  signer.update(canonical({ ...value, SignatureVersion: signatureVersion }));
  signer.end();
  return {
    ...value,
    Signature: signer.sign(privateKey, 'base64'),
    SignatureVersion: signatureVersion,
  };
}

function certificateResponse(): Response {
  const response = new Response(certificate, {
    headers: { 'content-length': String(Buffer.byteLength(certificate)) },
  });
  Object.defineProperty(response, 'url', { value: certificateUrl });
  return response;
}

describe('SNS and SES feedback boundaries', () => {
  it('extracts only minimum provider metadata and hard-bounce classification', () => {
    const result = parseSesFeedback(envelope());
    expect(result).toEqual({
      bounceType: 'permanent',
      eventType: 'bounce',
      occurredAt: new Date('2026-08-10T12:00:00.000Z'),
      providerEventId: 'sns-event',
      providerMessageId: 'provider-message',
    });
    expect(JSON.stringify(result)).not.toContain('private@example.com');
  });

  it.each([
    ['Complaint', 'complaint'],
    ['Delivery', 'delivery'],
    ['DeliveryDelay', 'delivery-delay'],
    ['Rendering Failure', 'rendering-failure'],
  ])(
    'normalizes legacy and v2 event name %s',
    (notificationType, eventType) => {
      expect(
        parseSesFeedback(
          envelope({
            Message: JSON.stringify({
              mail: { messageId: 'provider-message' },
              notificationType,
            }),
          }),
        ),
      ).toMatchObject({ eventType });
    },
  );

  it('ignores unsupported authenticated event types and rejects malformed provider JSON', () => {
    expect(
      parseSesFeedback(
        envelope({
          Message: JSON.stringify({
            eventType: 'OPEN',
            mail: { messageId: 'provider-message' },
          }),
        }),
      ),
    ).toBeNull();
    expect(() =>
      parseSesFeedback(envelope({ Message: '{malformed' })),
    ).toThrow();
  });

  it.each(['1', '2'] as const)(
    'verifies a real SNS v%s notification signature and caches the certificate',
    async (signatureVersion) => {
      const fetchImplementation = vi.fn<typeof fetch>(async () =>
        certificateResponse(),
      );
      const verifier = createSnsEnvelopeVerifier({
        fetch: fetchImplementation,
        region,
        topicArn,
      });
      const notification = signed(envelope(), signatureVersion);
      await expect(verifier.verify(notification)).resolves.toEqual(
        notification,
      );
      await expect(verifier.verify(notification)).resolves.toEqual(
        notification,
      );
      expect(fetchImplementation).toHaveBeenCalledOnce();
      await expect(
        verifier.verify({ ...notification, Message: 'tampered' }),
      ).rejects.toMatchObject({ reason: 'signature', retryable: false });
    },
  );

  it.each(['SubscriptionConfirmation', 'UnsubscribeConfirmation'] as const)(
    'uses the token-bearing canonical form for %s',
    async (type) => {
      const token = 'canonical-token';
      const subscribeUrl = `https://sns.${region}.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(topicArn)}&Token=${token}`;
      const control = signed(
        envelope({
          Subject: 'Ignored by the SNS subscription canonical form',
          SubscribeURL: subscribeUrl,
          Token: token,
          Type: type,
        }),
      );
      const verifier = createSnsEnvelopeVerifier({
        fetch: async () => certificateResponse(),
        region,
        topicArn,
      });
      await expect(verifier.verify(control)).resolves.toEqual(control);
    },
  );

  it('rejects an unexpected topic before attempting certificate retrieval', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    await expect(
      createSnsEnvelopeVerifier({
        fetch: fetchImplementation,
        region,
        topicArn,
      }).verify(envelope({ TopicArn: `${topicArn}-attacker` })),
    ).rejects.toMatchObject({ reason: 'topic', retryable: false });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    'http://sns.ap-southeast-1.amazonaws.com/SimpleNotificationService-test.pem',
    'https://sns.ap-southeast-1.amazonaws.com:444/SimpleNotificationService-test.pem',
    'https://sns.ap-southeast-1.amazonaws.com/nested/SimpleNotificationService-test.pem',
    'https://sns.ap-southeast-1.amazonaws.com/SimpleNotificationService-test.pem?redirect=true',
    'https://sns.ap-southeast-1.amazonaws.com.attacker.example/SimpleNotificationService-test.pem',
  ])(
    'rejects certificate URL outside the exact regional SNS certificate form',
    async (SigningCertURL) => {
      const fetchImplementation = vi.fn<typeof fetch>();
      await expect(
        createSnsEnvelopeVerifier({
          fetch: fetchImplementation,
          region,
          topicArn,
        }).verify(envelope({ SigningCertURL })),
      ).rejects.toMatchObject({
        reason: 'certificate-url',
        retryable: false,
      });
      expect(fetchImplementation).not.toHaveBeenCalled();
    },
  );

  it('rejects a redirected or oversized certificate response', async () => {
    const signedEnvelope = signed(envelope());
    const redirected = new Response(certificate);
    Object.defineProperty(redirected, 'url', {
      value: 'https://attacker.example/certificate.pem',
    });
    await expect(
      createSnsEnvelopeVerifier({
        fetch: async () => redirected,
        region,
        topicArn,
      }).verify(signedEnvelope),
    ).rejects.toMatchObject({
      reason: 'certificate-response',
      retryable: false,
    });

    const oversized = new Response('x'.repeat(65_537), {
      headers: { 'content-length': '65537' },
    });
    Object.defineProperty(oversized, 'url', { value: certificateUrl });
    await expect(
      createSnsEnvelopeVerifier({
        fetch: async () => oversized,
        region,
        topicArn,
      }).verify(signedEnvelope),
    ).rejects.toMatchObject({
      reason: 'certificate-response',
      retryable: true,
    });
  });

  it('confirms only the exact verified topic/token URL during the explicit window', async () => {
    const token = 'subscription-token';
    const subscribeUrl = new URL(`https://sns.${region}.amazonaws.com/`);
    subscribeUrl.searchParams.set('Action', 'ConfirmSubscription');
    subscribeUrl.searchParams.set('TopicArn', topicArn);
    subscribeUrl.searchParams.set('Token', token);
    const confirmation = envelope({
      SubscribeURL: subscribeUrl.href,
      Token: token,
      Type: 'SubscriptionConfirmation',
    });
    const fetchImplementation = vi.fn<typeof fetch>(
      async () => new Response('<ConfirmSubscriptionResponse/>'),
    );
    await expect(
      confirmSnsSubscription(confirmation, {
        fetch: fetchImplementation,
        region,
        topicArn,
      }),
    ).resolves.toMatchObject({
      canonicalMessage: {
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        summary: 'Private SNS canonical message omitted',
      },
      envelopeFieldNames: expect.arrayContaining([
        'Message',
        'MessageId',
        'Signature',
        'SignatureVersion',
        'SigningCertURL',
        'SubscribeURL',
        'Timestamp',
        'Token',
        'TopicArn',
        'Type',
      ]),
      envelopeFieldsComplete: true,
      envelopeFieldsObserved: 10,
      envelopeFieldsOmitted: 0,
      providerHttp: {
        headers: expect.objectContaining({
          entriesComplete: true,
          entryCount: 1,
        }),
        statusCode: 200,
      },
      providerResponseDiagnostic: expect.objectContaining({
        byteLengthComplete: true,
        fingerprintCoversCompleteValue: true,
        observedByteLength: 30,
        summary: 'Private SNS response body omitted',
      }),
      providerResponseStructure: {
        errorCodes: [],
        format: 'xml',
        jsonValue: null,
        requestIds: [],
        xmlElementNames: ['ConfirmSubscriptionResponse'],
        xmlElementsComplete: true,
        xmlElementsObserved: 1,
        xmlElementsOmitted: 0,
      },
      request: {
        expectedCertificateHost: 'sns.ap-southeast-1.amazonaws.com',
        expectedRegion: 'ap-southeast-1',
        responseUrlMatchesRequest: true,
        stage: 'confirmation',
      },
      retryable: false,
      signature: expect.objectContaining({
        summary: 'Private SNS signature omitted',
      }),
      signatureVersion: '2',
      signingCertificateUrl: expect.objectContaining({
        summary: 'Private SNS certificate URL omitted',
      }),
      topicMatchesExpected: true,
      type: 'SubscriptionConfirmation',
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();

    const tampered = new URL(subscribeUrl);
    tampered.searchParams.append('Token', 'second-token');
    await expect(
      confirmSnsSubscription(
        { ...confirmation, SubscribeURL: tampered.href },
        { fetch: fetchImplementation, region, topicArn },
      ),
    ).rejects.toMatchObject({
      reason: 'confirmation-input',
      retryable: false,
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('retains certificate HTTP failure and interrupted-body evidence', async () => {
    const signedEnvelope = signed(envelope());
    const privateMarker = 'private-destination@example.com';
    const unavailable = new Response(
      JSON.stringify({ error: 'certificate unavailable', privateMarker }),
      {
        headers: {
          'content-type': 'application/problem+json',
          'retry-after': '30',
          'x-amzn-requestid': 'certificate-request-correlation',
        },
        status: 503,
        statusText: 'Service Unavailable',
      },
    );
    Object.defineProperty(unavailable, 'url', { value: certificateUrl });
    let failure: unknown;
    try {
      await createSnsEnvelopeVerifier({
        fetch: async () => unavailable,
        region,
        topicArn,
      }).verify(signedEnvelope);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      evidence: {
        providerHttp: {
          headers: {
            entries: expect.arrayContaining([
              expect.objectContaining({
                name: 'retry-after',
                value: expect.objectContaining({ summary: '30' }),
              }),
              expect.objectContaining({
                name: 'x-amzn-requestid',
                value: expect.objectContaining({
                  summary: 'certificate-request-correlation',
                }),
              }),
            ]),
            entriesComplete: true,
            entryCount: 3,
          },
          reason: {
            fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
            summary: 'Private provider HTTP reason omitted',
            summaryOmittedAsPrivate: true,
          },
          statusCode: 503,
        },
        providerResponseDiagnostic: {
          byteLengthComplete: true,
          fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          fingerprintCoversCompleteValue: true,
          summary: 'Private SNS response body omitted',
        },
        providerResponseStructure: {
          errorCodes: [],
          format: 'json',
          jsonValue: expect.objectContaining({
            entries: expect.arrayContaining([
              expect.objectContaining({
                name: 'error',
                value: expect.objectContaining({
                  kind: 'string',
                  textDiagnostic: expect.objectContaining({
                    summary: 'Private provider field value omitted',
                  }),
                }),
              }),
              expect.objectContaining({
                name: 'privateMarker',
                value: expect.objectContaining({
                  kind: 'string',
                  textDiagnostic: expect.objectContaining({
                    fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
                    summary: 'Private provider field value omitted',
                  }),
                }),
              }),
            ]),
            entriesComplete: true,
            entriesObserved: 2,
            kind: 'object',
          }),
          requestIds: [],
          xmlElementNames: [],
          xmlElementsComplete: true,
          xmlElementsObserved: 0,
          xmlElementsOmitted: 0,
        },
        request: {
          responseUrlMatchesRequest: true,
          stage: 'certificate',
        },
      },
      reason: 'certificate-fetch',
      retryable: true,
    });
    expect(JSON.stringify(failure)).not.toContain(privateMarker);

    let pulls = 0;
    const interrupted = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            controller.enqueue(new TextEncoder().encode('partial-certificate'));
          } else {
            controller.error(new Error(privateMarker));
          }
        },
      }),
    );
    Object.defineProperty(interrupted, 'url', { value: certificateUrl });
    await expect(
      createSnsEnvelopeVerifier({
        fetch: async () => interrupted,
        region,
        topicArn,
      }).verify(signedEnvelope),
    ).rejects.toMatchObject({
      evidence: {
        operationalError: expect.objectContaining({
          messageSummary: 'External provider operational failure',
        }),
        providerResponseDiagnostic: {
          byteLengthComplete: false,
          fingerprintCoversCompleteValue: false,
          inspectionTruncated: true,
          observedByteLength: 19,
          streamCancellationOutcome: 'requested-unobserved',
          utf8Valid: true,
        },
        providerResponseStructure: {
          format: 'truncated',
          sourceByteLength: 19,
          sourceByteLengthComplete: false,
          sourceInspectionComplete: false,
        },
      },
      reason: 'certificate-response',
      retryable: true,
    });
  });

  it('marks invalid UTF-8 certificate structure without retaining decoded replacement prose', async () => {
    const invalid = new Response(new Uint8Array([0xff, 0xfe, 0xfd]));
    Object.defineProperty(invalid, 'url', { value: certificateUrl });
    let failure: unknown;
    try {
      await createSnsEnvelopeVerifier({
        fetch: async () => invalid,
        region,
        topicArn,
      }).verify(signed(envelope()));
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      evidence: {
        providerResponseDiagnostic: expect.objectContaining({
          byteLengthComplete: true,
          observedByteLength: 3,
          utf8Valid: false,
        }),
        providerResponseStructure: {
          format: 'invalid-utf8',
          sourceByteLength: 3,
          sourceByteLengthComplete: true,
          sourceInspectionComplete: true,
        },
      },
      reason: 'certificate-response',
      retryable: true,
    });
    expect(JSON.stringify(failure)).not.toContain('���');
  });

  it('retains signature and certificate evidence without envelope values', async () => {
    const verifier = createSnsEnvelopeVerifier({
      fetch: async () => certificateResponse(),
      region,
      topicArn,
    });
    const notification = signed(envelope());
    let failure: unknown;
    try {
      await verifier.verify({ ...notification, Message: 'tampered' });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      evidence: {
        canonicalMessage: expect.objectContaining({
          fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          summary: 'Private SNS canonical message omitted',
        }),
        certificate: {
          fingerprint256: expect.any(String),
          issuer: expect.objectContaining({
            fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          }),
          serialNumberDiagnostic: expect.objectContaining({
            fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
            summary: 'Private certificate serial number omitted',
            summaryOmittedAsPrivate: true,
          }),
          subject: expect.objectContaining({
            fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          }),
          validFrom: expect.any(String),
          validTo: expect.any(String),
        },
        providerResponseDiagnostic: expect.objectContaining({
          summary: 'SNS signing certificate body omitted',
        }),
        signature: expect.objectContaining({
          summary: 'Private SNS signature omitted',
        }),
        signatureVersion: '2',
        signingCertificateUrl: expect.objectContaining({
          summary: 'Private SNS certificate URL omitted',
        }),
        topicMatchesExpected: true,
        type: 'Notification',
      },
      reason: 'signature',
      retryable: false,
    });
    const serialized = JSON.stringify(failure);
    expect(serialized).not.toContain(notification.MessageId);
    expect(serialized).not.toContain(notification.Signature);
    expect(serialized).not.toContain(notification.SigningCertURL);
    expect(serialized).not.toContain(notification.TopicArn);
  });

  it('retains authenticated SES payload parse and ignored-event evidence', () => {
    const malformed = envelope({ Message: '{private-malformed' });
    let failure: unknown;
    try {
      parseSesFeedbackDetailed(malformed);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SesFeedbackPayloadError);
    expect(failure).toMatchObject({
      diagnostic: {
        providerEventIdFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        providerPayloadDiagnostic: {
          fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          observedByteLength: Buffer.byteLength(malformed.Message),
          summary: 'Private authenticated SES event payload omitted',
        },
        stage: 'json',
      },
    });
    expect(JSON.stringify(failure)).not.toContain(malformed.Message);
    expect(JSON.stringify(failure)).not.toContain(malformed.MessageId);

    const ignored = parseSesFeedbackDetailed(
      envelope({
        Message: JSON.stringify({
          eventType: 'OPEN',
          mail: {
            destination: ['private@example.com'],
            messageId: 'private-provider-message-id',
          },
          privateExtension: 'private-value',
          privateObject: { attempts: 2, detail: 'private-nested-value' },
        }),
      }),
    );
    expect(ignored).toMatchObject({
      diagnostic: {
        eventTypeDiagnostic: expect.objectContaining({
          fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          summary: 'Private SES event type omitted',
          summaryOmittedAsPrivate: true,
        }),
        mailFieldNames: expect.arrayContaining(['destination', 'messageId']),
        mailFieldsComplete: true,
        providerMessageIdFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        providerPayloadDiagnostic: expect.objectContaining({
          summary: 'Private authenticated SES event payload omitted',
        }),
        rootExtraFields: expect.arrayContaining([
          expect.objectContaining({
            name: 'privateExtension',
            value: expect.objectContaining({
              kind: 'string',
              textDiagnostic: expect.objectContaining({
                fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
                summary: 'Private provider field value omitted',
              }),
            }),
          }),
          expect.objectContaining({
            name: 'privateObject',
            value: expect.objectContaining({
              entries: expect.arrayContaining([
                expect.objectContaining({
                  name: 'attempts',
                  value: expect.objectContaining({
                    numberClassification: 'finite',
                    numberValue: null,
                    textDiagnostic: expect.objectContaining({
                      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
                      summary: 'Private provider numeric value omitted',
                    }),
                  }),
                }),
                expect.objectContaining({
                  name: 'detail',
                  value: expect.objectContaining({
                    textDiagnostic: expect.objectContaining({
                      summary: 'Private provider field value omitted',
                    }),
                  }),
                }),
              ]),
              kind: 'object',
            }),
          }),
        ]),
        rootFieldNames: [
          'eventType',
          'mail',
          'privateExtension',
          'privateObject',
        ],
        rootFieldsComplete: true,
        stage: 'event-type',
      },
      event: null,
    });
    expect(JSON.stringify(ignored.diagnostic)).not.toContain(
      'private-provider-message-id',
    );
    expect(JSON.stringify(ignored.diagnostic)).not.toContain(
      'private@example.com',
    );
    expect(JSON.stringify(ignored.diagnostic)).not.toContain('private-value');
    expect(JSON.stringify(ignored.diagnostic)).not.toContain(
      'private-nested-value',
    );
  });

  it('classifies certificate transport failure as retryable without retaining its URL', async () => {
    const privateDetail = 'private-destination@example.com';
    let caught: unknown;
    try {
      await createSnsEnvelopeVerifier({
        fetch: async () => Promise.reject(new Error(privateDetail)),
        region,
        topicArn,
      }).verify(signed(envelope()));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SnsFeedbackBoundaryError);
    expect(caught).toMatchObject({
      reason: 'certificate-fetch',
      retryable: true,
    });
    expect(JSON.stringify(caught)).not.toContain(privateDetail);
  });
});
