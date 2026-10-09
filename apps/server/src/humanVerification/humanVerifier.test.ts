/** Covers development mode and every production Turnstile success, replay, mismatch, stale, and outage path. */
import { describe, expect, it, vi } from 'vitest';

import {
  createDevelopmentHumanVerifier,
  createTurnstileHumanVerifier,
  createUnavailableHumanVerifier,
} from './humanVerifier.js';

const NOW = Date.parse('2026-08-10T12:00:00.000Z');

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

function validResponse(overrides: Record<string, unknown> = {}) {
  return {
    action: 'registration',
    challenge_ts: new Date(NOW - 1_000).toISOString(),
    hostname: 'chalkboard.example',
    success: true,
    ...overrides,
  };
}

function verifier(
  fetchImplementation: typeof fetch,
  onFailure?: Parameters<typeof createTurnstileHumanVerifier>[0]['onFailure'],
) {
  return createTurnstileHumanVerifier({
    expectedHostname: 'chalkboard.example',
    fetchImplementation,
    now: () => NOW,
    ...(onFailure === undefined ? {} : { onFailure }),
    secret: 'runtime-test-secret',
    timeoutMs: 50,
  });
}

describe('human verification', () => {
  it('keeps development deterministic and production-unavailable fail closed', async () => {
    await expect(
      createDevelopmentHumanVerifier().verify({
        action: 'registration',
        token: 'development-human-verification',
      }),
    ).resolves.toEqual({ verified: true });
    await expect(
      createDevelopmentHumanVerifier().verify({
        action: 'registration',
        token: '',
      }),
    ).resolves.toEqual({ reason: 'missing', verified: false });
    await expect(
      createUnavailableHumanVerifier().verify({
        action: 'registration',
        token: 'anything',
      }),
    ).resolves.toEqual({ reason: 'unavailable', verified: false });
  });

  it('rejects missing and oversized tokens before any provider work', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const human = verifier(fetchImplementation);
    await expect(
      human.verify({ action: 'registration', token: '' }),
    ).resolves.toEqual({ reason: 'missing', verified: false });
    await expect(
      human.verify({
        action: 'registration',
        token: 'x'.repeat(2_049),
      }),
    ).resolves.toEqual({ reason: 'malformed', verified: false });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('accepts one fresh matching token and never sends its value in a URL', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (_url, init) => {
      const body = init?.body;
      expect(body).toBeInstanceOf(URLSearchParams);
      expect((body as URLSearchParams).get('response')).toBe('one-time-token');
      return response(validResponse());
    });
    const human = verifier(fetchImplementation);

    await expect(
      human.verify({ action: 'registration', token: 'one-time-token' }),
    ).resolves.toEqual({ verified: true });
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST' }),
    );
    await expect(
      human.verify({ action: 'registration', token: 'one-time-token' }),
    ).resolves.toEqual({ reason: 'duplicate', verified: false });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it.each([
    [validResponse({ hostname: 'attacker.example' }), 'mismatch'],
    [validResponse({ action: 'password-reset' }), 'mismatch'],
    [
      validResponse({
        challenge_ts: new Date(NOW - 10 * 60_000).toISOString(),
      }),
      'stale',
    ],
    [
      validResponse({
        challenge_ts: new Date(NOW + 31_000).toISOString(),
      }),
      'stale',
    ],
    [{ success: 'yes' }, 'malformed'],
    [{ success: false }, 'invalid'],
  ])(
    'rejects mismatched, stale, malformed, and failed responses',
    async (body, reason) => {
      await expect(
        verifier(async () => response(body)).verify({
          action: 'registration',
          token: `token-${reason}`,
        }),
      ).resolves.toEqual({ reason, verified: false });
    },
  );

  it('stops reading and cancels an oversized provider response stream', async () => {
    const cancel = vi.fn();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      cancel,
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(16 * 1_024 + 1));
        if (pulls > 1) controller.enqueue(new Uint8Array(16 * 1_024));
      },
    });
    const onFailure = vi.fn();

    await expect(
      verifier(async () => new Response(body), onFailure).verify({
        action: 'registration',
        token: 'oversized-stream-token',
      }),
    ).resolves.toEqual({ reason: 'malformed', verified: false });
    expect(cancel).toHaveBeenCalledOnce();
    expect(pulls).toBeLessThanOrEqual(2);
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        category: 'response-too-large',
        providerResponseLength: 16 * 1_024 + 1,
        providerResponseTruncated: true,
      }),
    );
  });

  it('retries one interrupted provider response stream as a transport failure', async () => {
    const onFailure = vi.fn();
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.error(new Error('private stream failure'));
            },
          }),
        ),
      )
      .mockResolvedValueOnce(response(validResponse()));

    await expect(
      verifier(fetchImplementation, onFailure).verify({
        action: 'registration',
        token: 'stream-retry-token',
      }),
    ).resolves.toEqual({ verified: true });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        category: 'transport',
        httpStatusCode: 200,
        providerHttp: expect.objectContaining({ statusCode: 200 }),
        providerResponseDiagnostic: expect.objectContaining({
          byteLengthComplete: false,
          fingerprintCoversCompleteValue: false,
          inspectionTruncated: true,
          observedByteLength: 0,
        }),
        providerResponseTruncated: true,
      }),
    );
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain(
      'private stream failure',
    );
  });

  it('rejects invalid UTF-8 without retrying or parsing replacement characters', async () => {
    const onFailure = vi.fn();
    const fetchImplementation = vi.fn<typeof fetch>(
      async () => new Response(new Uint8Array([0xff, 0xfe, 0xfd])),
    );

    await expect(
      verifier(fetchImplementation, onFailure).verify({
        action: 'registration',
        token: 'invalid-utf8-token',
      }),
    ).resolves.toEqual({ reason: 'malformed', verified: false });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'malformed-json',
        providerResponseDiagnostic: expect.objectContaining({
          byteLengthComplete: true,
          observedByteLength: 3,
          utf8Valid: false,
        }),
      }),
    );
  });

  it.each([
    [new Response('{not-json'), 'malformed'],
    [new Response('x'.repeat(16 * 1_024 + 1)), 'malformed'],
    [new Response('{}', { status: 503 }), 'unavailable'],
  ])(
    'does not retry a non-network provider response',
    async (providerResponse, reason) => {
      const fetchImplementation = vi.fn<typeof fetch>(async () =>
        providerResponse.clone(),
      );
      await expect(
        verifier(fetchImplementation).verify({
          action: 'registration',
          token: `non-network-${reason}-${providerResponse.status}`,
        }),
      ).resolves.toEqual({ reason, verified: false });
      expect(fetchImplementation).toHaveBeenCalledOnce();
    },
  );

  it('retains non-2xx status, headers, and transformed body evidence', async () => {
    const onFailure = vi.fn();
    const privateMarker = 'private-destination@example.com';
    const providerResponse = new Response(
      JSON.stringify({ error: 'upstream unavailable', privateMarker }),
      {
        headers: {
          'cf-ray': 'cloudflare-ray-correlation',
          'content-type': 'application/problem+json',
          'retry-after': '30',
        },
        status: 503,
        statusText: 'Service Unavailable',
      },
    );

    await expect(
      verifier(async () => providerResponse, onFailure).verify({
        action: 'registration',
        token: 'non-2xx-evidence-token',
      }),
    ).resolves.toEqual({ reason: 'unavailable', verified: false });
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        category: 'http',
        httpStatusCode: 503,
        providerHttp: expect.objectContaining({
          headers: expect.objectContaining({
            entries: expect.arrayContaining([
              expect.objectContaining({
                name: 'cf-ray',
                value: expect.objectContaining({
                  summary: 'cloudflare-ray-correlation',
                }),
              }),
              expect.objectContaining({
                name: 'retry-after',
                value: expect.objectContaining({ summary: '30' }),
              }),
            ]),
            entriesComplete: true,
            entryCount: 3,
          }),
          reason: expect.objectContaining({
            fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
            summary: 'Private provider HTTP reason omitted',
            summaryOmittedAsPrivate: true,
          }),
          statusCode: 503,
        }),
        providerResponseDiagnostic: expect.objectContaining({
          byteLengthComplete: true,
          fingerprintCoversCompleteValue: true,
          summary: 'Private Turnstile response body omitted',
        }),
      }),
    );
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain(privateMarker);
  });

  it('retains structured mismatch, stale-time, and schema evidence', async () => {
    const hostnameFailure = vi.fn();
    await verifier(
      async () => response(validResponse({ hostname: 'private.example' })),
      hostnameFailure,
    ).verify({ action: 'registration', token: 'hostname-evidence-token' });
    expect(hostnameFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'hostname-mismatch',
        providerActionDiagnostic: expect.objectContaining({
          fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          summary: 'Private Turnstile action omitted',
          summaryOmittedAsPrivate: true,
        }),
        providerFieldNames: ['action', 'challenge_ts', 'hostname', 'success'],
        providerFieldsComplete: true,
        providerFieldsObserved: 4,
        providerHostnameDiagnostic: expect.objectContaining({
          fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          summary: 'Private Turnstile hostname omitted',
          summaryOmittedAsPrivate: true,
        }),
        providerActionMatchesExpected: true,
        providerHostnameMatchesExpected: false,
        providerSuccess: true,
        request: {
          endpointHost: 'challenges.cloudflare.com',
          expectedAction: 'registration',
          expectedHostnameDiagnostic: expect.objectContaining({
            fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
            summary: 'Expected Turnstile hostname omitted',
          }),
          httpMethod: 'POST',
          idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/u),
          maximumAttempts: 2,
          remoteIpIncluded: false,
          timeoutMilliseconds: 50,
          tokenDiagnostic: expect.objectContaining({
            fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
            summary: 'Private Turnstile token omitted',
          }),
        },
      }),
    );

    const staleFailure = vi.fn();
    const staleTimestamp = new Date(NOW - 10 * 60_000).toISOString();
    await verifier(
      async () => response(validResponse({ challenge_ts: staleTimestamp })),
      staleFailure,
    ).verify({ action: 'registration', token: 'stale-evidence-token' });
    expect(staleFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'invalid-challenge-time',
        providerChallengeAgeMilliseconds: 10 * 60_000,
        providerChallengeTimestamp: staleTimestamp,
        providerSuccess: true,
      }),
    );

    const schemaFailure = vi.fn();
    await verifier(
      async () => response({ action: 1, success: 'yes' }),
      schemaFailure,
    ).verify({ action: 'registration', token: 'schema-evidence-token' });
    expect(schemaFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'response-schema',
        providerFieldNames: ['action', 'success'],
        providerSchemaIssues: expect.arrayContaining([
          { issueCode: 'invalid_type', path: 'action' },
          { issueCode: 'invalid_type', path: 'success' },
        ]),
        providerSchemaIssuesComplete: true,
        providerSchemaIssuesObserved: 2,
        providerSchemaIssuesOmitted: 0,
      }),
    );
  });

  it('retries one provider outage with the same idempotency key', async () => {
    const bodies: URLSearchParams[] = [];
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (_url, init) => {
        bodies.push(init?.body as URLSearchParams);
        throw new Error('temporary outage');
      })
      .mockImplementationOnce(async (_url, init) => {
        bodies.push(init?.body as URLSearchParams);
        return response(validResponse());
      });

    await expect(
      verifier(fetchImplementation).verify({
        action: 'registration',
        token: 'retry-token',
      }),
    ).resolves.toEqual({ verified: true });
    expect(bodies[0]?.get('idempotency_key')).toBe(
      bodies[1]?.get('idempotency_key'),
    );
    const idempotencyKey = bodies[0]?.get('idempotency_key');
    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('reports complete transformed provider evidence without retaining token, secret, or raw response body', async () => {
    const onFailure = vi.fn();
    const privateBody = {
      'error-codes': ['invalid-input-response'],
      private: 'private-destination@example.com',
      privateObject: { attempts: 2, detail: 'private-extension-value' },
      success: false,
    };
    const human = verifier(async () => response(privateBody), onFailure);

    await expect(
      human.verify({
        action: 'registration',
        token: 'private-human-token',
      }),
    ).resolves.toEqual({ reason: 'invalid', verified: false });
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'registration',
        attempt: null,
        category: 'provider-declined',
        httpStatusCode: 200,
        operationalError: null,
        providerErrorCodeDiagnostics: [
          expect.objectContaining({
            fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
            summary: 'Private Turnstile error code omitted',
            summaryOmittedAsPrivate: true,
          }),
        ],
        providerErrorCodes: ['invalid-input-response'],
        providerExtraFields: expect.arrayContaining([
          expect.objectContaining({
            name: 'private',
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
              kind: 'object',
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
            }),
          }),
        ]),
        providerFieldNames: [
          'error-codes',
          'private',
          'privateObject',
          'success',
        ],
        providerFieldsComplete: true,
        providerFieldsObserved: 4,
        providerFieldsOmitted: 0,
        providerHttp: expect.objectContaining({
          headers: expect.objectContaining({
            entriesComplete: true,
            entryCount: 1,
          }),
          statusCode: 200,
        }),
        providerResponseDiagnostic: expect.objectContaining({
          byteLengthComplete: true,
          fingerprintCoversCompleteValue: true,
          inspectionTruncated: false,
          summary: 'Private Turnstile response body omitted',
        }),
        providerResponseFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        providerResponseLength: expect.any(Number),
        providerResponseTruncated: false,
        providerSuccess: false,
        request: expect.objectContaining({
          endpointHost: 'challenges.cloudflare.com',
          idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/u),
          tokenDiagnostic: expect.objectContaining({
            summary: 'Private Turnstile token omitted',
          }),
        }),
      }),
    );
    const retained = JSON.stringify(onFailure.mock.calls);
    expect(retained).not.toContain('private-destination@example.com');
    expect(retained).not.toContain('private-human-token');
    expect(retained).not.toContain('runtime-test-secret');
    expect(retained).not.toContain('private-extension-value');
  });

  it('reports both bounded transport failures across the one allowed retry', async () => {
    const onFailure = vi.fn();
    const human = verifier(
      async () => Promise.reject(new Error('network private detail')),
      onFailure,
    );

    await expect(
      human.verify({ action: 'password-reset', token: 'outage-token' }),
    ).resolves.toEqual({ reason: 'unavailable', verified: false });
    expect(onFailure).toHaveBeenCalledTimes(2);
    expect(onFailure.mock.calls.map(([diagnostic]) => diagnostic)).toEqual([
      expect.objectContaining({
        action: 'password-reset',
        attempt: 1,
        category: 'transport',
        operationalError: expect.objectContaining({
          fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          messageSummary: 'External provider operational failure',
        }),
      }),
      expect.objectContaining({
        action: 'password-reset',
        attempt: 2,
        category: 'transport',
        operationalError: expect.objectContaining({
          fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          messageSummary: 'External provider operational failure',
        }),
      }),
    ]);
    expect(onFailure.mock.calls.map(([diagnostic]) => diagnostic)).toEqual([
      expect.objectContaining({ providerResponseTruncated: null }),
      expect.objectContaining({ providerResponseTruncated: null }),
    ]);
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain(
      'network private detail',
    );
  });

  it('fails closed without throwing when a revoked provider failure is caught', async () => {
    const revocable = Proxy.revocable(new Error('private failure'), {});
    revocable.revoke();
    const onFailure = vi.fn();

    await expect(
      verifier(async () => Promise.reject(revocable.proxy), onFailure).verify({
        action: 'registration',
        token: 'revoked-proxy-token',
      }),
    ).resolves.toEqual({ reason: 'unavailable', verified: false });
    expect(onFailure).toHaveBeenCalledTimes(2);
  });

  it.each(['failure', 'timeout'] as const)(
    'fails closed after two transport %ss',
    async (mode) => {
      const fetchImplementation = vi.fn<typeof fetch>(async (_url, init) => {
        if (mode === 'failure') throw new Error('outage');
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('timed out')),
            { once: true },
          );
        });
      });
      await expect(
        verifier(fetchImplementation).verify({
          action: 'registration',
          token: `outage-${mode}-token`,
        }),
      ).resolves.toEqual({ reason: 'unavailable', verified: false });
      expect(fetchImplementation).toHaveBeenCalledTimes(2);
    },
  );
});
