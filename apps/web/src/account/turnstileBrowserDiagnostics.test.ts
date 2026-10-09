/** Proves local Turnstile evidence is bounded, useful, and excludes private provider values. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearTurnstileBrowserDiagnostics,
  readTurnstileBrowserDiagnostics,
  recordTurnstileBrowserDiagnostic,
  TURNSTILE_BROWSER_DIAGNOSTICS_KEY,
} from './turnstileBrowserDiagnostics';

afterEach(() => {
  clearTurnstileBrowserDiagnostics();
  localStorage.removeItem(TURNSTILE_BROWSER_DIAGNOSTICS_KEY);
  vi.restoreAllMocks();
});

describe('Turnstile browser diagnostics', () => {
  it('retains bounded provider lifecycle evidence without arbitrary exception prose', async () => {
    const privateMarker =
      'private-destination@example.com token=private-turnstile-token';
    recordTurnstileBrowserDiagnostic({
      action: 'registration',
      attempt: 2,
      elapsedMilliseconds: 123.6,
      error: Object.assign(new Error(privateMarker), { code: 'NETWORK' }),
      outcome: 'failure',
      providerErrorCode: '110200',
      stage: 'script-error',
    });

    await vi.waitFor(() =>
      expect(
        readTurnstileBrowserDiagnostics()[0]?.operationalError?.fingerprint,
      ).toMatch(/^[0-9a-f]{64}$/u),
    );
    const records = readTurnstileBrowserDiagnostics();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: 'registration',
      attempt: 2,
      elapsedMilliseconds: 124,
      operationalError: {
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        fingerprintCoversCompleteValue: true,
        messageByteLength: new TextEncoder().encode(privateMarker).byteLength,
        messageLength: privateMarker.length,
        messageSummary: 'External provider operational failure',
        messageSummaryOmittedAsPrivate: true,
        messageTruncated: false,
        name: 'Error',
        stackByteLength: expect.any(Number),
        stackFramesComplete: true,
        stackFramesObserved: expect.any(Number),
        stackFramesOmittedAsPrivate: true,
        stackInspectionTruncated: false,
        stackLength: expect.any(Number),
      },
      outcome: 'failure',
      provider: 'cloudflare-turnstile',
      providerErrorCode: '110200',
      recordId: expect.any(String),
      scriptHost: 'challenges.cloudflare.com',
      scriptPath: '/turnstile/v0/api.js',
      stage: 'script-error',
      timestamp: expect.any(String),
    });
    expect(JSON.stringify(records)).not.toContain(privateMarker);
    expect(JSON.stringify(records)).not.toContain('private-turnstile-token');
  });

  it('reconstructs stored records and drops unknown private fields', () => {
    const privateMarker = 'private-token-and-provider-prose';
    localStorage.setItem(
      TURNSTILE_BROWSER_DIAGNOSTICS_KEY,
      JSON.stringify([
        {
          action: 'registration',
          attempt: 1,
          elapsedMilliseconds: 2,
          online: true,
          operationalError: {
            fingerprint: 'a'.repeat(64),
            fingerprintCoversCompleteValue: false,
            messageByteLength: 42,
            messageLength: 42,
            messageSummary: privateMarker,
            messageTruncated: true,
            name: 'Error',
            privateToken: privateMarker,
            route: '/development/emails',
            stackByteLength: 123,
            stackFrames: [
              `at privateFunction (https://example.com/app.js?token=${privateMarker}:1:2)`,
            ],
            stackFramesComplete: true,
            stackFramesObserved: 1,
            stackFramesOmitted: 0,
            stackInspectionTruncated: false,
            stackLength: 123,
            timestamp: '2026-08-13T00:00:00.000Z',
          },
          outcome: 'failure',
          privateToken: privateMarker,
          provider: 'cloudflare-turnstile',
          providerErrorCode: '110200',
          recordId: 'stored-record',
          scriptHost: 'challenges.cloudflare.com',
          scriptPath: '/turnstile/v0/api.js',
          stage: 'provider-error',
          timestamp: '2026-08-13T00:00:00.000Z',
          visibilityState: 'visible',
        },
      ]),
    );

    const records = readTurnstileBrowserDiagnostics();
    expect(records).toEqual([
      expect.objectContaining({
        operationalError: expect.objectContaining({
          fingerprintCoversCompleteValue: false,
          messageSummary: 'External provider operational failure',
          messageSummaryOmittedAsPrivate: true,
          messageTruncated: true,
          route: '/development/emails',
          stackFrames: ['at [provider-frame]'],
          stackFramesComplete: true,
          stackFramesObserved: 1,
          stackFramesOmittedAsPrivate: true,
          stackInspectionTruncated: false,
        }),
        recordId: 'stored-record',
      }),
    ]);
    expect(JSON.stringify(records)).not.toContain(privateMarker);
    recordTurnstileBrowserDiagnostic({
      action: 'registration',
      attempt: 2,
      elapsedMilliseconds: 3,
      outcome: 'debug',
      stage: 'rendered',
    });
    expect(
      localStorage.getItem(TURNSTILE_BROWSER_DIAGNOSTICS_KEY),
    ).not.toContain(privateMarker);
  });

  it('rejects contradictory stored error evidence instead of normalizing it', () => {
    localStorage.setItem(
      TURNSTILE_BROWSER_DIAGNOSTICS_KEY,
      JSON.stringify([
        {
          action: 'registration',
          attempt: 1,
          elapsedMilliseconds: 2,
          online: true,
          operationalError: {
            fingerprint: null,
            fingerprintCoversCompleteValue: true,
            messageByteLength: 1,
            messageLength: 1,
            messageTruncated: false,
            name: 'Error',
            route: '/',
            stackByteLength: 1,
            stackFrames: ['at [provider-frame]'],
            stackFramesComplete: true,
            stackFramesObserved: 2,
            stackFramesOmitted: 0,
            stackInspectionTruncated: false,
            stackLength: 1,
            timestamp: '2026-08-13T00:00:00.000Z',
          },
          outcome: 'failure',
          provider: 'cloudflare-turnstile',
          providerErrorCode: null,
          recordId: 'contradictory-record',
          scriptHost: 'challenges.cloudflare.com',
          scriptPath: '/turnstile/v0/api.js',
          stage: 'provider-error',
          timestamp: '2026-08-13T00:00:00.000Z',
          visibilityState: 'visible',
        },
      ]),
    );

    expect(readTurnstileBrowserDiagnostics()).toEqual([
      expect.objectContaining({
        operationalError: null,
        recordId: 'contradictory-record',
      }),
    ]);
  });

  it('bounds records and drops malformed callback codes', () => {
    for (let index = 0; index < 25; index += 1) {
      recordTurnstileBrowserDiagnostic({
        action: 'password-reset',
        attempt: index + 1,
        elapsedMilliseconds: index,
        outcome: index % 2 === 0 ? 'debug' : 'failure',
        providerErrorCode: 'private code with spaces',
        stage: index % 2 === 0 ? 'rendered' : 'provider-error',
      });
    }
    const records = readTurnstileBrowserDiagnostics();
    expect(records).toHaveLength(20);
    expect(records[0]?.attempt).toBe(6);
    expect(records.at(-1)?.attempt).toBe(25);
    expect(records.every((record) => record.providerErrorCode === null)).toBe(
      true,
    );
  });

  it('survives unavailable local storage through the bounded best-effort overlay', () => {
    const get = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    const set = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('full');
      });
    expect(() =>
      recordTurnstileBrowserDiagnostic({
        action: 'registration',
        attempt: 1,
        elapsedMilliseconds: 0,
        outcome: 'failure',
        stage: 'script-error',
      }),
    ).not.toThrow();
    expect(get).toHaveBeenCalled();
    expect(set).toHaveBeenCalled();
    expect(readTurnstileBrowserDiagnostics()).toHaveLength(1);
  });
});
