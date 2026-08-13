/** Locks branded message content, SES request safety, and local capture behavior. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDevelopmentVerificationEmailSender,
  createSesVerificationEmailSender,
  verificationEmailMessage,
} from './verificationEmail.js';

const ses = vi.hoisted(() => ({
  clientConfigurations: [] as unknown[],
  destroy: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@aws-sdk/client-sesv2', () => ({
  SendEmailCommand: class {
    constructor(readonly input: unknown) {}
  },
  SESv2Client: class {
    destroy = ses.destroy;
    send = ses.send;
    constructor(configuration: unknown) {
      ses.clientConfigurations.push(configuration);
    }
  },
}));

const configuration = {
  configurationSet: 'chalkboard-transactional',
  feedbackTopicArn: 'arn:aws:sns:ap-southeast-1:000000000000:test',
  from: 'Chalkboard <accounts@example.com>',
  publicOrigin: 'https://chalkboard.example',
  region: 'ap-southeast-1',
  replyTo: 'support@example.com',
};

function sentInput(): Record<string, unknown> {
  const [command] = ses.send.mock.calls[0] as [{ input: unknown }];
  return command.input as Record<string, unknown>;
}

beforeEach(() => {
  ses.clientConfigurations.length = 0;
  ses.destroy.mockClear();
  ses.send.mockReset();
  ses.send.mockResolvedValue({ MessageId: 'provider-message-id' });
});

describe('verificationEmailMessage', () => {
  it('keeps codes out of subjects and includes complete text and HTML bodies', () => {
    for (const purpose of [
      'registration',
      'email-change',
      'password-reset',
    ] as const) {
      const message = verificationEmailMessage(
        purpose,
        '1234-5678',
        'https://chalkboard.example',
      );
      expect(message.subject).not.toContain('1234-5678');
      expect(message.text).toContain('1234-5678');
      expect(message.text).toContain('expires in 15 minutes');
      expect(message.text).toContain('https://chalkboard.example/privacy');
      expect(message.html).toContain('1234-5678');
      expect(message.html).toContain('https://chalkboard.example/contact');
    }
  });
});

describe('SES delivery', () => {
  it('uses one-attempt SES delivery, the configuration set, reply path, and both bodies', async () => {
    const sender = createSesVerificationEmailSender(configuration);

    await expect(
      sender.send({
        code: '1234-5678',
        intentId: crypto.randomUUID(),
        purpose: 'registration',
        to: 'person@example.com',
      }),
    ).resolves.toMatchObject({
      acceptanceDiagnostic: {
        providerHttp: null,
        providerMessageIdDiagnostic: {
          fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          observedByteLength: Buffer.byteLength('provider-message-id'),
          summary: 'Accepted provider message identifier omitted',
        },
        providerMetadata: null,
        providerResponseExtraFields: [],
        providerResponseFieldNames: ['MessageId'],
        providerResponseFieldsComplete: true,
        providerResponseFieldsObserved: 1,
        providerResponseFieldsOmitted: 0,
        request: expect.objectContaining({
          action: 'ses:SendEmail',
          configurationSet: 'chalkboard-transactional',
          region: 'ap-southeast-1',
        }),
      },
      providerMessageId: 'provider-message-id',
    });

    expect(ses.clientConfigurations).toEqual([
      { maxAttempts: 1, region: 'ap-southeast-1' },
    ]);
    expect(sentInput()).toMatchObject({
      ConfigurationSetName: 'chalkboard-transactional',
      Destination: { ToAddresses: ['person@example.com'] },
      FromEmailAddress: 'Chalkboard <accounts@example.com>',
      ReplyToAddresses: ['support@example.com'],
      Content: {
        Simple: {
          Body: {
            Html: { Charset: 'UTF-8' },
            Text: { Charset: 'UTF-8' },
          },
        },
      },
    });
    expect(JSON.stringify(sentInput())).not.toContain(
      'Chalkboard verification code:',
    );
    const requestOptions = ses.send.mock.calls[0]?.[1] as
      { abortSignal?: AbortSignal } | undefined;
    expect(requestOptions?.abortSignal).toBeInstanceOf(AbortSignal);

    sender.close();
    expect(ses.destroy).toHaveBeenCalledOnce();
  });

  it('classifies an explicit SES rejection separately from an ambiguous transport result', async () => {
    const sender = createSesVerificationEmailSender(configuration);
    const rejection = Object.assign(new Error('rejected'), {
      $metadata: { httpStatusCode: 400 },
      name: 'MessageRejected',
    });
    ses.send.mockRejectedValueOnce(rejection);
    await expect(
      sender.send({
        code: '1234-5678',
        intentId: crypto.randomUUID(),
        purpose: 'registration',
        to: 'person@example.com',
      }),
    ).rejects.toMatchObject({
      certainty: 'rejected',
      failureClass: 'destination',
      httpStatusCode: 400,
      providerErrorName: 'MessageRejected',
    });

    ses.send.mockRejectedValueOnce(
      Object.assign(new Error('service unavailable'), {
        $metadata: { httpStatusCode: 503 },
        name: 'ServiceUnavailableException',
      }),
    );
    await expect(
      sender.send({
        code: '1234-5678',
        intentId: crypto.randomUUID(),
        purpose: 'registration',
        to: 'person@example.com',
      }),
    ).rejects.toMatchObject({
      certainty: 'ambiguous',
      failureClass: 'provider-rejection',
      httpStatusCode: 503,
      providerErrorName: 'ServiceUnavailableException',
    });

    ses.send.mockRejectedValueOnce(new Error('connection reset'));
    await expect(
      sender.send({
        code: '1234-5678',
        intentId: crypto.randomUUID(),
        purpose: 'registration',
        to: 'person@example.com',
      }),
    ).rejects.toMatchObject({
      certainty: 'ambiguous',
      failureClass: 'transport',
      httpStatusCode: null,
      providerErrorName: 'TransportError',
    });
  });

  it('preserves actionable evidence for an exact sandbox-recipient denial without exposing the resource', async () => {
    const sender = createSesVerificationEmailSender(configuration);
    const destination = 'private-destination@example.com';
    const accountId = '123456789012';
    const providerMessage =
      `User is not authorized to perform ses:SendEmail on resource ` +
      `arn:aws:ses:ap-southeast-1:${accountId}:identity/${destination}`;
    ses.send.mockRejectedValueOnce(
      Object.assign(new Error(providerMessage), {
        $metadata: {
          httpStatusCode: 403,
          requestId: '01234567-89ab-cdef-0123-456789abcdef',
        },
        name: 'AccessDeniedException',
      }),
    );

    let failure: unknown;
    try {
      await sender.send({
        code: '1234-5678',
        intentId: crypto.randomUUID(),
        purpose: 'password-reset',
        to: destination,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      certainty: 'rejected',
      deniedResourceCategory: 'recipient-identity',
      deniedResourceMatchesRequest: true,
      failureClass: 'provider-rejection',
      httpStatusCode: 403,
      providerErrorName: 'AccessDeniedException',
      providerMessageFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      providerRequestId: '01234567-89ab-cdef-0123-456789abcdef',
    });
    const diagnostic = failure as Record<string, unknown>;
    expect(JSON.stringify(diagnostic)).not.toContain(destination);
    expect(JSON.stringify(diagnostic)).not.toContain(accountId);
    expect(diagnostic).not.toHaveProperty('providerMessage');
  });

  it.each([
    {
      category: 'configuration-set',
      resource: 'configuration-set/chalkboard-transactional',
      matches: true,
    },
    {
      category: 'sender-identity',
      resource: 'identity/example.com',
      matches: true,
    },
    {
      category: 'other-ses-resource',
      resource: 'identity/unrelated@example.net',
      matches: false,
    },
  ] as const)(
    'classifies a denied $category without retaining its ARN',
    async ({ category, matches, resource }) => {
      const sender = createSesVerificationEmailSender(configuration);
      const providerMessage = `Not authorized on arn:aws:ses:ap-southeast-1:123456789012:${resource}`;
      ses.send.mockRejectedValueOnce(
        Object.assign(new Error(providerMessage), {
          $metadata: { httpStatusCode: 403 },
          name: 'AccessDeniedException',
        }),
      );

      let failure: unknown;
      try {
        await sender.send({
          code: '1234-5678',
          intentId: crypto.randomUUID(),
          purpose: 'password-reset',
          to: 'private-destination@example.com',
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        deniedResourceCategory: category,
        deniedResourceMatchesRequest: matches,
        providerMessageFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      });
      expect(JSON.stringify(failure)).not.toContain(providerMessage);
      expect(JSON.stringify(failure)).not.toContain(resource);
    },
  );

  it('retains complete multi-resource SES denial evidence without private values', async () => {
    const sender = createSesVerificationEmailSender(configuration);
    const destination = 'private-destination@example.com';
    const accountId = '123456789012';
    const resources = [
      `arn:aws:ses:ap-southeast-1:${accountId}:identity/${destination}`,
      `arn:aws:ses:ap-southeast-1:${accountId}:configuration-set/chalkboard-transactional`,
      `arn:aws:ses:ap-southeast-1:${accountId}:identity/example.com`,
      `arn:aws:ses:us-east-1:${accountId}:template/private-template`,
    ];
    const providerMessage =
      `User is not authorized to perform ses:SendEmail or ses:SendRawEmail; ` +
      `ses:SendEmail denied on ${resources.join(', ')}`;
    const transportCause = Object.assign(
      new Error(
        'connect ETIMEDOUT private-host.example.com 192.0.2.4 token=private-token',
      ),
      { code: 'ETIMEDOUT' },
    );
    const providerError = Object.assign(new Error(providerMessage), {
      $fault: 'client',
      $metadata: {
        attempts: 1,
        cfId: 'cloudfront-correlation-value',
        clockSkewCorrected: false,
        extendedRequestId: 'extended/request+corr=',
        httpStatusCode: 403,
        requestId: '01234567-89ab-cdef-0123-456789abcdef',
        totalRetryDelay: 0,
        futureBoolean: true,
        futurePrivate: 'private-metadata-value',
      },
      $response: {
        body: `{"message":"${destination}"}`,
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          date: 'Tue, 18 Aug 2026 12:00:00 GMT',
          'x-amzn-errortype': 'AccessDeniedException',
          'x-amzn-requestid': '01234567-89ab-cdef-0123-456789abcdef',
        },
        reason: 'Forbidden',
        statusCode: 403,
      },
      $responseBodyText: `{"message":"${providerMessage}"}`,
      $retryable: { throttling: false },
      $service: 'SESv2',
      cause: transportCause,
      futureNumber: 42,
      futurePrivate: 'private-root-value',
      name: 'FutureAccessDeniedVariant',
    });
    ses.send.mockRejectedValueOnce(providerError);

    let failure: unknown;
    try {
      await sender.send({
        code: '1234-5678',
        intentId: crypto.randomUUID(),
        purpose: 'password-reset',
        to: destination,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      certainty: 'rejected',
      deniedResourceCategory: 'recipient-identity',
      deniedResourceMatchesRequest: true,
      deniedResourcesComplete: true,
      deniedResourcesObserved: 4,
      deniedResourcesOmitted: 0,
      failureClass: 'provider-rejection',
      httpStatusCode: 403,
      providerActions: [
        { action: 'ses:SendEmail', occurrences: 2 },
        { action: 'ses:SendRawEmail', occurrences: 1 },
      ],
      providerActionsComplete: true,
      providerActionsObserved: 3,
      providerActionsOmitted: 0,
      providerErrorExtraFields: expect.arrayContaining([
        expect.objectContaining({
          name: 'futureNumber',
          value: expect.objectContaining({
            kind: 'number',
            numberClassification: 'finite',
            numberValue: null,
            textDiagnostic: expect.objectContaining({
              fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
              summary: 'Private provider numeric value omitted',
              summaryOmittedAsPrivate: true,
            }),
          }),
        }),
        expect.objectContaining({
          name: 'futurePrivate',
          value: expect.objectContaining({
            kind: 'string',
            textDiagnostic: expect.objectContaining({
              fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
              summary: 'Private provider field value omitted',
            }),
          }),
        }),
      ]),
      providerErrorFieldsComplete: true,
      providerErrorName: 'OtherServiceError',
      providerFault: 'client',
      providerHttp: {
        bodyDiagnostic: {
          fingerprintCoversCompleteValue: true,
          summary: expect.not.stringContaining(destination),
        },
        bodyPresent: true,
        bodyType: 'string',
        headers: {
          entriesComplete: true,
          entryCount: 4,
          entriesOmitted: 0,
          unreadable: false,
        },
        reason: {
          fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          summary: 'Private provider HTTP reason omitted',
          summaryOmittedAsPrivate: true,
        },
        statusCode: 403,
      },
      providerMessageDiagnostic: {
        byteLengthComplete: true,
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        fingerprintCoversCompleteValue: true,
        inspectionTruncated: false,
        observedByteLength: Buffer.byteLength(providerMessage),
        summary: 'Private SES provider message omitted',
        summaryOmittedAsPrivate: true,
        summaryTruncated: false,
      },
      providerMetadata: {
        attempts: 1,
        cfId: 'cloudfront-correlation-value',
        clockSkewCorrected: false,
        extendedRequestId: 'extended/request+corr=',
        extraFields: expect.arrayContaining([
          expect.objectContaining({
            name: 'futureBoolean',
            value: expect.objectContaining({
              booleanValue: true,
              kind: 'boolean',
            }),
          }),
          expect.objectContaining({
            name: 'futurePrivate',
            value: expect.objectContaining({
              kind: 'string',
              textDiagnostic: expect.objectContaining({
                fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
                summary: 'Private provider field value omitted',
              }),
            }),
          }),
        ]),
        fieldsComplete: true,
        fieldsObserved: 9,
        fieldsOmitted: 0,
        httpStatusCode: 403,
        requestId: '01234567-89ab-cdef-0123-456789abcdef',
        totalRetryDelayMilliseconds: 0,
      },
      providerOperationalError: {
        cause: {
          errorCode: 'ETIMEDOUT',
          messageSummary: 'External provider operational failure',
          messageSummaryOmittedAsPrivate: true,
          stackFramesOmittedAsPrivate: true,
        },
        messageSummary: 'External provider operational failure',
        messageSummaryOmittedAsPrivate: true,
        name: 'FutureAccessDeniedVariant',
        stackFrames: expect.arrayContaining(['at [provider-frame]']),
        stackFramesOmittedAsPrivate: true,
      },
      providerRequestId: '01234567-89ab-cdef-0123-456789abcdef',
      providerResponseBodyDiagnostic: {
        fingerprintCoversCompleteValue: true,
        summary: 'Private SES response body omitted',
        summaryOmittedAsPrivate: true,
      },
      providerResponseStructure: {
        errorCodes: [],
        format: 'json',
        jsonValue: expect.objectContaining({
          entries: [
            expect.objectContaining({
              name: 'message',
              value: expect.objectContaining({
                kind: 'string',
                textDiagnostic: expect.objectContaining({
                  fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
                  summary: 'Private provider field value omitted',
                }),
              }),
            }),
          ],
          entriesComplete: true,
          entriesObserved: 1,
          kind: 'object',
        }),
        requestIds: [],
        xmlElementNames: [],
        xmlElementsComplete: true,
        xmlElementsObserved: 0,
        xmlElementsOmitted: 0,
      },
      providerRetryable: { present: true, throttling: false },
      providerService: {
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        summary: 'Private SES service value omitted',
        summaryOmittedAsPrivate: true,
      },
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
    const diagnostic = failure as {
      deniedResources: Array<Record<string, unknown>>;
      providerErrorFieldNames: string[];
    };
    expect(diagnostic.deniedResources).toHaveLength(4);
    expect(diagnostic.deniedResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'recipient-identity',
          matchesRequest: true,
          occurrences: 1,
          region: 'ap-southeast-1',
          regionMatchesRequest: true,
          resourceType: 'identity',
        }),
        expect.objectContaining({
          category: 'configuration-set',
          matchesRequest: true,
          resourceType: 'configuration-set',
        }),
        expect.objectContaining({
          category: 'sender-identity',
          matchesRequest: true,
          resourceType: 'identity',
        }),
        expect.objectContaining({
          category: 'other-ses-resource',
          matchesRequest: false,
          region: 'us-east-1',
          regionMatchesRequest: false,
          resourceType: 'template',
        }),
      ]),
    );
    expect(diagnostic.providerErrorFieldNames).toEqual(
      expect.arrayContaining([
        '$fault',
        '$metadata',
        '$response',
        '$responseBodyText',
        '$retryable',
        '$service',
        'cause',
        'name',
      ]),
    );
    const serialized = JSON.stringify(failure);
    expect(serialized).not.toContain(destination);
    expect(serialized).not.toContain(accountId);
    expect(serialized).not.toContain('private-template');
    expect(serialized).not.toContain('private-host.example.com');
    expect(serialized).not.toContain('192.0.2.4');
    expect(serialized).not.toContain('private-token');
    expect(serialized).not.toContain('private-metadata-value');
    expect(serialized).not.toContain('private-root-value');
  });

  it('retains malformed SES success response metadata and private identifier evidence', async () => {
    const sender = createSesVerificationEmailSender(configuration);
    const privateMessageId = 'private-invalid-provider-message-id';
    ses.send.mockResolvedValueOnce({
      $metadata: {
        attempts: 1,
        httpStatusCode: 200,
        requestId: 'success-request-correlation',
        totalRetryDelay: 0,
      },
      MessageId: privateMessageId.repeat(30),
      futureBoolean: true,
      futurePrivate: 'private-success-extra',
    });

    let failure: unknown;
    try {
      await sender.send({
        code: '1234-5678',
        intentId: crypto.randomUUID(),
        purpose: 'password-reset',
        to: 'private-destination@example.com',
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      certainty: 'ambiguous',
      failureClass: 'unknown',
      httpStatusCode: 200,
      providerErrorName: 'InvalidProviderResponse',
      providerMetadata: {
        attempts: 1,
        extraFields: [],
        httpStatusCode: 200,
        requestId: 'success-request-correlation',
        totalRetryDelayMilliseconds: 0,
      },
      providerRequestId: 'success-request-correlation',
      providerResponseBodyDiagnostic: {
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        observedByteLength: Buffer.byteLength(privateMessageId.repeat(30)),
        summary: 'Invalid provider message identifier omitted',
      },
      providerResponseExtraFields: expect.arrayContaining([
        expect.objectContaining({
          name: 'futureBoolean',
          value: expect.objectContaining({
            booleanValue: true,
            kind: 'boolean',
          }),
        }),
        expect.objectContaining({
          name: 'futurePrivate',
          value: expect.objectContaining({
            kind: 'string',
            textDiagnostic: expect.objectContaining({
              fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
              summary: 'Private provider field value omitted',
            }),
          }),
        }),
      ]),
      providerResponseFieldNames: [
        '$metadata',
        'MessageId',
        'futureBoolean',
        'futurePrivate',
      ],
      providerResponseFieldsComplete: true,
      providerResponseFieldsObserved: 4,
      providerResponseFieldsOmitted: 0,
      request: expect.objectContaining({
        action: 'ses:SendEmail',
        configurationSet: 'chalkboard-transactional',
        region: 'ap-southeast-1',
      }),
    });
    const serialized = JSON.stringify(failure);
    expect(serialized).not.toContain(privateMessageId);
    expect(serialized).not.toContain('private-success-extra');
    expect(serialized).not.toContain('private-destination@example.com');
  });

  it('survives a revoked provider error Proxy without losing the failure', async () => {
    const sender = createSesVerificationEmailSender(configuration);
    const revocable = Proxy.revocable(new Error('private provider detail'), {});
    revocable.revoke();
    ses.send.mockRejectedValueOnce(revocable.proxy);

    await expect(
      sender.send({
        code: '1234-5678',
        intentId: crypto.randomUUID(),
        purpose: 'password-reset',
        to: 'private-destination@example.com',
      }),
    ).rejects.toMatchObject({
      certainty: 'ambiguous',
      deniedResourceCategory: 'unknown',
      failureClass: 'transport',
      providerMessageFingerprint: null,
      providerMessageSummary: null,
      providerRequestId: null,
    });
  });

  it('survives hostile provider error getters without losing the failure', async () => {
    const sender = createSesVerificationEmailSender(configuration);
    const failure = new Error('initial');
    Object.defineProperties(failure, {
      $metadata: {
        get() {
          throw new Error('metadata getter must not escape');
        },
      },
      message: {
        get() {
          throw new Error('message getter must not escape');
        },
      },
      name: {
        get() {
          throw new Error('name getter must not escape');
        },
      },
    });
    ses.send.mockRejectedValueOnce(failure);

    await expect(
      sender.send({
        code: '1234-5678',
        intentId: crypto.randomUUID(),
        purpose: 'password-reset',
        to: 'private-destination@example.com',
      }),
    ).rejects.toMatchObject({
      certainty: 'ambiguous',
      deniedResourceCategory: 'unknown',
      failureClass: 'transport',
      httpStatusCode: null,
      providerErrorName: 'TransportError',
      providerMessageFingerprint: null,
      providerMessageLength: null,
      providerMessageSummary: null,
      providerRequestId: null,
    });
  });

  it('bounds inspection of an oversized provider message while retaining full length and fingerprint', async () => {
    const sender = createSesVerificationEmailSender(configuration);
    const providerMessage =
      'private-destination@example.com ' + 'x'.repeat(100_000);
    ses.send.mockRejectedValueOnce(
      Object.assign(new Error(providerMessage), {
        $metadata: { httpStatusCode: 403 },
        name: 'AccessDeniedException',
      }),
    );

    await expect(
      sender.send({
        code: '1234-5678',
        intentId: crypto.randomUUID(),
        purpose: 'password-reset',
        to: 'private-destination@example.com',
      }),
    ).rejects.toMatchObject({
      providerMessageFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      providerMessageLength: Buffer.byteLength(providerMessage, 'utf8'),
      providerMessageSummary: expect.not.stringContaining(
        'private-destination@example.com',
      ),
      providerMessageTruncated: true,
    });
  });

  it('records provider message length in UTF-8 bytes', async () => {
    const sender = createSesVerificationEmailSender(configuration);
    ses.send.mockRejectedValueOnce(
      Object.assign(new Error('rejected é'), {
        $metadata: { httpStatusCode: 400 },
        name: 'MessageRejected',
      }),
    );

    await expect(
      sender.send({
        code: '1234-5678',
        intentId: crypto.randomUUID(),
        purpose: 'registration',
        to: 'person@example.com',
      }),
    ).rejects.toMatchObject({
      providerMessageDiagnostic: {
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        summary: 'Private SES provider message omitted',
        summaryOmittedAsPrivate: true,
      },
      providerMessageLength: Buffer.byteLength('rejected é', 'utf8'),
      providerMessageSummary: 'Private SES provider message omitted',
    });
  });

  it('allowlists provider error names, request IDs, and bounded HTTP status values', async () => {
    const sender = createSesVerificationEmailSender(configuration);
    ses.send.mockRejectedValueOnce(
      Object.assign(new Error('private provider detail'), {
        $metadata: {
          httpStatusCode: 400,
          requestId: 'private data with spaces',
        },
        name: 'AttackerControlledNameWithPrivateData',
      }),
    );
    await expect(
      sender.send({
        code: '1234-5678',
        intentId: crypto.randomUUID(),
        purpose: 'password-reset',
        to: 'private-destination@example.com',
      }),
    ).rejects.toMatchObject({
      certainty: 'rejected',
      httpStatusCode: 400,
      providerErrorName: 'OtherServiceError',
      providerMessageFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      providerRequestId: null,
    });

    ses.send.mockRejectedValueOnce(
      Object.assign(new Error('invalid status'), {
        $metadata: { httpStatusCode: 999 },
        name: 'BadRequestException',
      }),
    );
    await expect(
      sender.send({
        code: '8765-4321',
        intentId: crypto.randomUUID(),
        purpose: 'password-reset',
        to: 'another-private-destination@example.com',
      }),
    ).rejects.toMatchObject({
      certainty: 'ambiguous',
      failureClass: 'transport',
      httpStatusCode: null,
      providerErrorName: 'TransportError',
    });
  });
});

describe('development email capture', () => {
  it('captures only reserved local test destinations without logging or network delivery', async () => {
    const development = createDevelopmentVerificationEmailSender(
      'http://127.0.0.1:5173',
    );
    await development.sender.send({
      code: '1234-5678',
      intentId: crypto.randomUUID(),
      purpose: 'registration',
      to: 'tester@chalkboard.test',
    });

    expect(development.inbox.list()).toMatchObject([
      {
        purpose: 'registration',
        subject: 'Confirm your Chalkboard account',
        to: 'tester@chalkboard.test',
      },
    ]);
    expect(development.inbox.list()[0]?.text).toContain('1234-5678');
    await expect(
      development.sender.send({
        code: '1234-5678',
        intentId: crypto.randomUUID(),
        purpose: 'registration',
        to: 'real@example.com',
      }),
    ).rejects.toMatchObject({ certainty: 'rejected' });
  });
});
