/** Proves fatal browser diagnostics retain bounded evidence without private text. */
import { describe, expect, it } from 'vitest';

import {
  browserErrorDiagnostic,
  captureBrowserErrorEvidence,
  fingerprintBrowserError,
} from './browserErrorDiagnostics';

describe('browser error diagnostics', () => {
  it('redacts private values while retaining bounded type, route, stack, and lengths', () => {
    const email = 'private-destination@example.com';
    const token = 'token=' + 'x'.repeat(80);
    const error = new Error(
      `Could not render ${email} at https://example.com/path?${token}`,
    );
    error.stack = `${error.name}: ${error.message}\n    at privateFunction (https://example.com/app.js?${token}:1:2)`;

    const diagnostic = browserErrorDiagnostic(error, {
      pathname: '/boards/private-board-id',
    });
    const output = JSON.stringify(diagnostic);

    expect(diagnostic).toMatchObject({
      fingerprint: null,
      fingerprintCoversCompleteValue: null,
      messageByteLength: new TextEncoder().encode(error.message).byteLength,
      messageLength: error.message.length,
      messageSummary: expect.stringContaining('[email]'),
      messageSummaryOmittedAsPrivate: false,
      messageTruncated: false,
      name: 'Error',
      route: '/boards/:boardId',
      stackByteLength: new TextEncoder().encode(error.stack).byteLength,
      stackFrames: [expect.stringContaining('[url:example.com]')],
      stackFramesComplete: true,
      stackFramesObserved: 1,
      stackFramesOmitted: 0,
      stackFramesOmittedAsPrivate: false,
      stackInspectionTruncated: false,
      stackLength: error.stack.length,
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
    });
    expect(output).not.toContain(email);
    expect(output).not.toContain('private-board-id');
    expect(output).not.toContain(token);
    expect(output).not.toContain('/path?');
  });

  it('never retains arbitrary path segments as recovery evidence', () => {
    const privatePath = '/support/private-destination@example.com';
    const diagnostic = browserErrorDiagnostic(new Error('failed'), {
      pathname: privatePath,
    });

    expect(diagnostic.route).toBe('unmatched');
    expect(JSON.stringify(diagnostic)).not.toContain(privatePath);
    expect(JSON.stringify(diagnostic)).not.toContain(
      'private-destination@example.com',
    );
  });

  it('removes control characters from retained browser diagnostics', () => {
    const diagnostic = browserErrorDiagnostic(
      new Error('before\u0000\u001f\u007f\u009fafter'),
      { pathname: '/' },
    );

    expect(diagnostic.messageSummary).toBe('before after');
    expect(JSON.stringify(diagnostic)).not.toMatch(/\p{Cc}/u);
  });

  it('hashes the original error without returning its original text', async () => {
    const privateValue = 'private-destination@example.com';
    const diagnostic = await fingerprintBrowserError(
      new Error(`failed ${privateValue}`),
    );
    expect(diagnostic).toMatchObject({
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      fingerprintCoversCompleteValue: true,
    });
    expect(diagnostic.fingerprint).not.toContain(privateValue);
  });

  it('captures mutable Error getters once for matching structure and fingerprint', async () => {
    const error = new Error('initial');
    let messageReads = 0;
    let stackReads = 0;
    Object.defineProperties(error, {
      message: {
        get() {
          messageReads += 1;
          return `message-${messageReads}`;
        },
      },
      stack: {
        get() {
          stackReads += 1;
          return `Error: mutable\n    at frame-${stackReads} (/safe:1:1)`;
        },
      },
    });

    const evidence = captureBrowserErrorEvidence(error, { pathname: '/' });
    await expect(evidence.fingerprint).resolves.toMatchObject({
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      fingerprintCoversCompleteValue: true,
    });
    expect(evidence.diagnostic).toMatchObject({
      messageLength: 'message-1'.length,
      messageSummary: 'message-1',
      stackFrames: ['at frame-1 (/safe:1:1)'],
    });
    expect({ messageReads, stackReads }).toEqual({
      messageReads: 1,
      stackReads: 1,
    });
  });

  it('survives hostile Error getters and bounds oversized input', async () => {
    const error = new Error('initial');
    Object.defineProperties(error, {
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
      stack: {
        get() {
          return `Error: private\n${'    at frame (https://example.com/private.js:1:1)\n'.repeat(5_000)}`;
        },
      },
    });

    const diagnostic = browserErrorDiagnostic(error, { pathname: '/' });
    expect(diagnostic).toMatchObject({
      messageSummary: 'Error message was unavailable',
      name: 'Error',
      stackFrames: expect.any(Array),
    });
    expect(diagnostic.stackFrames).toHaveLength(12);
    expect(diagnostic).toMatchObject({
      stackFramesComplete: false,
      stackFramesObserved: expect.any(Number),
      stackInspectionTruncated: true,
    });
    expect(diagnostic.stackFramesOmitted).toBeGreaterThanOrEqual(0);
    await expect(fingerprintBrowserError(error)).resolves.toMatchObject({
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      fingerprintCoversCompleteValue: false,
    });
  });

  it('does not coerce a hostile non-Error throw', () => {
    const value = {
      toString() {
        throw new Error('must not run');
      },
    };
    expect(browserErrorDiagnostic(value, { pathname: '/' })).toMatchObject({
      messageSummary: 'A non-Error object value was thrown',
      name: 'NonErrorThrow',
    });
  });
});
