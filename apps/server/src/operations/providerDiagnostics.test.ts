/** Proves external-provider evidence is bounded, explicit about completeness, and privacy-safe. */
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  diagnoseProviderHeaders,
  diagnoseProviderHttp,
  diagnoseProviderOperationalError,
  diagnoseProviderResponseStructure,
  diagnoseProviderText,
  diagnoseProviderValue,
  ProviderBodyReadError,
  readProviderResponseBody,
} from './providerDiagnostics.js';

const privateText =
  'private-destination@example.com example.internal 192.0.2.4 ' +
  'arn:aws:ses:ap-southeast-1:123456789012:identity/private-destination@example.com ' +
  'https://example.internal/private?token=secret-value token=secret-value\u0000';

describe('provider diagnostics', () => {
  it('hashes the complete text while bounding and redacting inspection', () => {
    const value = `${privateText}${'x'.repeat(10_000)}`;
    const diagnostic = diagnoseProviderText(value, {
      inspectionBytes: 512,
      summaryLength: 128,
    });

    expect(diagnostic).toMatchObject({
      byteLengthComplete: true,
      declaredByteLength: null,
      fingerprint: createHash('sha256').update(value).digest('hex'),
      fingerprintCoversCompleteValue: true,
      inspectionTruncated: true,
      observedByteLength: Buffer.byteLength(value),
    });
    expect(diagnostic.summary.length).toBeLessThanOrEqual(128);
    const retained = JSON.stringify(diagnostic);
    expect(retained).not.toContain('private-destination@example.com');
    expect(retained).not.toContain('example.internal');
    expect(retained).not.toContain('192.0.2.4');
    expect(retained).not.toContain('123456789012');
    expect(retained).not.toContain('secret-value');
  });

  it('accounts for every header while omitting only sensitive values', () => {
    const headers = new Headers({
      authorization: 'Bearer private-token',
      'content-type': 'application/problem+json',
      'set-cookie': 'private-session=value',
      'x-provider-detail': privateText.replace(/\p{Cc}/gu, ''),
      'x-request-id': 'provider-request-123',
    });
    const diagnostic = diagnoseProviderHeaders(headers);

    expect(diagnostic).toMatchObject({
      entriesComplete: true,
      entryCount: 5,
      entriesOmitted: 0,
      unreadable: false,
    });
    expect(diagnostic.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'authorization',
          value: null,
          valueOmittedAsSensitive: true,
        }),
        expect.objectContaining({
          name: 'set-cookie',
          value: null,
          valueOmittedAsSensitive: true,
        }),
        expect.objectContaining({
          name: 'x-provider-detail',
          value: expect.objectContaining({
            fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
            summary: 'Private provider header value omitted',
          }),
          valueOmittedAsSensitive: false,
        }),
        expect.objectContaining({
          name: 'x-request-id',
          value: expect.objectContaining({
            summary: 'provider-request-123',
          }),
          valueOmittedAsSensitive: false,
        }),
      ]),
    );
    expect(JSON.stringify(diagnostic)).not.toContain('private-token');
    expect(JSON.stringify(diagnostic)).not.toContain('private-session');
    expect(JSON.stringify(diagnostic)).not.toContain(
      'private-destination@example.com',
    );
  });

  it('accounts for malformed header names by fingerprint instead of dropping them', () => {
    const diagnostic = diagnoseProviderHeaders({
      'Invalid Header Name': privateText,
      'x-request-id': 'provider-request-123',
    });
    expect(diagnostic).toMatchObject({
      entriesComplete: true,
      entryCount: 2,
      entriesOmitted: 0,
      unreadable: false,
    });
    expect(diagnostic.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '[private-header]',
          nameFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
          value: expect.objectContaining({
            summary: 'Private provider header value omitted',
          }),
        }),
      ]),
    );
    expect(JSON.stringify(diagnostic)).not.toContain('Invalid Header Name');
    expect(JSON.stringify(diagnostic)).not.toContain(privateText);
  });

  it('retains HTTP status, reason, future fields, and URL correlation without private prose', () => {
    const privateMarker = 'private-destination@example.com';
    const response = {
      body: 'failure',
      future: { attempts: 2, detail: privateMarker },
      headers: { 'x-request-id': 'provider-request-123' },
      reason: 'Provider unavailable',
      statusCode: 503,
      url: `https://example.com/private?destination=${privateMarker}`,
    };
    const diagnostic = diagnoseProviderHttp(response);
    expect(diagnostic).toMatchObject({
      extraFields: [
        expect.objectContaining({
          name: 'future',
          value: expect.objectContaining({
            entriesObserved: 2,
            kind: 'object',
          }),
        }),
      ],
      fieldNames: ['body', 'future', 'headers', 'reason', 'statusCode', 'url'],
      fieldsComplete: true,
      fieldsObserved: 6,
      fieldsOmitted: 0,
      headers: { entryCount: 1, entriesComplete: true },
      reason: {
        fingerprint: createHash('sha256')
          .update('Provider unavailable')
          .digest('hex'),
        summary: 'Private provider HTTP reason omitted',
        summaryOmittedAsPrivate: true,
      },
      statusCode: 503,
      urlDiagnostic: {
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        summary: 'Private provider URL omitted',
        summaryOmittedAsPrivate: true,
      },
    });
    expect(JSON.stringify(diagnostic)).not.toContain(privateMarker);
    expect(JSON.stringify(diagnostic)).not.toContain('/private?');
  });

  it('fingerprints malformed safe-name headers and never invokes header getters', () => {
    const getter = vi.fn(() => privateText);
    const headers: Record<string, unknown> = {
      'content-type': 'private prose disguised as content type',
      'x-request-id': 'private request prose with spaces',
      'x-structured': { attempts: 2, detail: privateText },
    };
    Object.defineProperty(headers, 'x-hostile', {
      enumerable: true,
      get: getter,
    });

    const diagnostic = diagnoseProviderHeaders(headers);
    expect(diagnostic).toMatchObject({
      entriesComplete: true,
      entryCount: 4,
      entriesOmitted: 0,
      unreadable: false,
    });
    expect(diagnostic.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'content-type',
          value: expect.objectContaining({
            summary: 'Private provider header value omitted',
            summaryOmittedAsPrivate: true,
          }),
        }),
        expect.objectContaining({
          name: 'x-request-id',
          value: expect.objectContaining({
            summary: 'Private provider header value omitted',
          }),
        }),
        expect.objectContaining({
          name: 'x-structured',
          structuredValue: expect.objectContaining({
            entriesObserved: 2,
            kind: 'object',
          }),
          value: null,
          valueUnavailable: false,
        }),
        expect.objectContaining({
          name: 'x-hostile',
          structuredValue: null,
          value: null,
          valueUnavailable: true,
        }),
      ]),
    );
    expect(getter).not.toHaveBeenCalled();
    expect(JSON.stringify(diagnostic)).not.toContain(privateText);
    expect(JSON.stringify(diagnostic)).not.toContain(
      'private request prose with spaces',
    );
  });

  it('records UTF-8 and declared-length integrity for complete bodies', async () => {
    const matching = await readProviderResponseBody(
      new Response('é', { headers: { 'content-length': '2' } }),
      8,
    );
    expect(matching.diagnostic).toMatchObject({
      byteLengthComplete: true,
      declaredByteLength: 2,
      declaredByteLengthMatchesObserved: true,
      observedByteLength: 2,
      utf8Valid: true,
    });

    const mismatched = await readProviderResponseBody(
      new Response('ok', { headers: { 'content-length': '99' } }),
      8,
    );
    expect(mismatched.diagnostic).toMatchObject({
      byteLengthComplete: true,
      declaredByteLength: 99,
      declaredByteLengthMatchesObserved: false,
      observedByteLength: 2,
      utf8Valid: true,
    });
  });

  it('marks an oversized response prefix as incomplete and cancels the stream', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      cancel,
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('123456789'));
      },
    });
    const response = new Response(body, {
      headers: { 'content-length': '100' },
    });

    const result = await readProviderResponseBody(response, 8);
    expect(result.text).toBe('12345678');
    expect(result.diagnostic).toMatchObject({
      byteLengthComplete: false,
      declaredByteLength: 100,
      fingerprint: createHash('sha256').update('12345678').digest('hex'),
      fingerprintCoversCompleteValue: false,
      inspectionTruncated: true,
      observedByteLength: 9,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('retains unknown provider value content and structure without private prose', () => {
    const getter = vi.fn(() => privateText);
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const value = {
      binary: new Uint8Array([0xff, 0x00, 0x61]),
      boolean: true,
      decimal: 1.5,
      infinity: Number.POSITIVE_INFINITY,
      nested: [{ private: privateText }],
      unsafe: Number.MAX_SAFE_INTEGER + 1,
      cyclic,
    };
    Object.defineProperty(value, 'hostile', {
      enumerable: true,
      get: getter,
    });

    const diagnostic = diagnoseProviderValue(value);
    expect(diagnostic).toMatchObject({
      entriesComplete: true,
      entriesObserved: 8,
      entriesOmitted: 0,
      kind: 'object',
    });
    expect(diagnostic.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'binary',
          value: expect.objectContaining({
            kind: 'binary',
            textDiagnostic: expect.objectContaining({
              fingerprint: createHash('sha256')
                .update(new Uint8Array([0xff, 0x00, 0x61]))
                .digest('hex'),
              observedByteLength: 3,
              summary: 'Private provider binary value omitted',
            }),
          }),
        }),
        expect.objectContaining({
          name: 'boolean',
          value: expect.objectContaining({
            booleanValue: true,
            kind: 'boolean',
          }),
        }),
        expect.objectContaining({
          name: 'decimal',
          value: expect.objectContaining({
            kind: 'number',
            numberClassification: 'finite',
            numberValue: null,
            textDiagnostic: expect.objectContaining({
              fingerprint: createHash('sha256').update('1.5').digest('hex'),
              summary: 'Private provider numeric value omitted',
            }),
          }),
        }),
        expect.objectContaining({
          name: 'infinity',
          value: expect.objectContaining({
            kind: 'number',
            numberClassification: 'positive-infinity',
            numberValue: null,
          }),
        }),
        expect.objectContaining({
          name: 'unsafe',
          value: expect.objectContaining({
            kind: 'number',
            numberClassification: 'unsafe-integer',
            numberValue: null,
            textDiagnostic: expect.objectContaining({
              summary: 'Private provider numeric value omitted',
            }),
          }),
        }),
        expect.objectContaining({
          name: 'hostile',
          value: expect.objectContaining({ kind: 'unavailable' }),
        }),
      ]),
    );
    expect(getter).not.toHaveBeenCalled();
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain(privateText);
    expect(serialized).toContain('Private provider field value omitted');
    expect(serialized).toContain('"entriesComplete":false');
    expect(serialized).toContain('"entriesLimitReason":"cycle"');
    expect(serialized).toContain('"entriesObserved":1');
    expect(serialized).toContain('"entriesOmitted":1');
  });

  it('accounts for every bounded XML code and request identifier', () => {
    const text = `<Error>${Array.from(
      { length: 35 },
      (_, index) => `<Code>Code${index}</Code>`,
    ).join('')}${Array.from(
      { length: 34 },
      (_, index) => `<RequestId>Request${index}</RequestId>`,
    ).join('')}</Error>`;
    const structure = diagnoseProviderResponseStructure(text);

    expect(structure).toMatchObject({
      errorCodesComplete: false,
      errorCodesObserved: 35,
      errorCodesOmitted: 3,
      format: 'xml',
      requestIdsComplete: false,
      requestIdsObserved: 34,
      requestIdsOmitted: 2,
      sourceByteLengthComplete: true,
      sourceInspectionComplete: true,
    });
    expect(structure.errorCodes).toHaveLength(32);
    expect(structure.errorCodeDiagnostics).toHaveLength(32);
    expect(structure.requestIds).toHaveLength(32);
    expect(structure.requestIdDiagnostics).toHaveLength(32);
  });

  it('marks depth-limited future fields and oversized response structure explicitly incomplete', () => {
    const diagnostic = diagnoseProviderValue({
      one: { two: { three: { private: privateText } } },
    });
    const depthBoundary =
      diagnostic.entries[0]?.value.entries[0]?.value.entries[0]?.value;
    expect(depthBoundary).toMatchObject({
      entries: [],
      entriesComplete: false,
      entriesLimitReason: 'depth',
      entriesObserved: 1,
      entriesOmitted: 1,
      kind: 'object',
    });

    const structure = diagnoseProviderResponseStructure(
      JSON.stringify({ private: 'x'.repeat(70_000) }),
    );
    expect(structure).toMatchObject({
      errorCodes: [],
      errorCodesComplete: false,
      format: 'truncated',
      jsonValue: null,
      requestIds: [],
      requestIdsComplete: false,
      sourceByteLengthComplete: true,
      sourceInspectionComplete: false,
      xmlElementsComplete: false,
    });
    expect(structure.sourceByteLength).toBeGreaterThan(64 * 1_024);
  });

  it('classifies revoked provider values as unavailable without throwing', () => {
    const root = Proxy.revocable({ private: privateText }, {});
    const nested = Proxy.revocable({ private: privateText }, {});
    root.revoke();
    nested.revoke();

    expect(() => diagnoseProviderValue(root.proxy)).not.toThrow();
    expect(diagnoseProviderValue(root.proxy)).toMatchObject({
      entries: [],
      entriesComplete: null,
      kind: 'unavailable',
    });
    expect(diagnoseProviderValue({ nested: nested.proxy })).toMatchObject({
      entries: [
        expect.objectContaining({
          name: 'nested',
          value: expect.objectContaining({ kind: 'unavailable' }),
        }),
      ],
      kind: 'object',
    });
  });

  it('never waits for a provider cancellation promise on the user path', async () => {
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        return new Promise<void>(() => undefined);
      },
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('123456789'));
      },
    });
    const startedAt = performance.now();
    const result = await readProviderResponseBody(new Response(body), 8);
    const elapsedMilliseconds = performance.now() - startedAt;

    expect(result.diagnostic).toMatchObject({
      byteLengthComplete: false,
      fingerprintCoversCompleteValue: false,
      streamCancellationError: null,
      streamCancellationOutcome: 'requested-unobserved',
    });
    expect(elapsedMilliseconds).toBeLessThan(100);
  });

  it('retains an unmistakably partial diagnostic when a stream read fails', async () => {
    let pull = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pull += 1;
          if (pull === 1) {
            controller.enqueue(new TextEncoder().encode('prefix'));
            return;
          }
          controller.error(new Error(privateText));
        },
      }),
      { headers: { 'content-length': '100' } },
    );

    let caught: unknown;
    try {
      await readProviderResponseBody(response, 64);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderBodyReadError);
    expect(caught).toMatchObject({
      diagnostic: {
        byteLengthComplete: false,
        declaredByteLength: 100,
        fingerprintCoversCompleteValue: false,
        observedByteLength: 6,
        streamCancellationError: null,
        streamCancellationOutcome: 'requested-unobserved',
      },
    });
    expect(JSON.stringify(caught)).not.toContain(privateText);
  });

  it('removes provider-controlled message and stack prose while preserving exact topology', () => {
    const privateMarker = 'private provider stack marker';
    const error = new Error(privateMarker);
    error.stack = `Error: ${privateMarker}\n    at ${privateMarker} (/private/path:1:1)`;
    const diagnostic = diagnoseProviderOperationalError(error);

    expect(diagnostic).toMatchObject({
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      fingerprintCoversCompleteValue: true,
      messageByteLength: Buffer.byteLength(privateMarker),
      messageLength: privateMarker.length,
      messageSummary: 'External provider operational failure',
      messageSummaryOmittedAsPrivate: true,
      stackByteLength: Buffer.byteLength(error.stack),
      stackFrames: ['at [provider-frame]'],
      stackFramesComplete: true,
      stackFramesObserved: 1,
      stackFramesOmitted: 0,
      stackFramesOmittedAsPrivate: true,
      stackInspectionTruncated: false,
      stackLength: error.stack.length,
    });
    expect(JSON.stringify(diagnostic)).not.toContain(privateMarker);
    expect(JSON.stringify(diagnostic)).not.toContain('/private/path');
  });
});
