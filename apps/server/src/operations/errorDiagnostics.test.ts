/** Proves operational diagnostics retain causal evidence without private values. */
import { Writable } from 'node:stream';

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  diagnoseOperationalError,
  logOperationalError,
  redactDiagnosticText,
  writeOperationalError,
} from './errorDiagnostics.js';
import { serverLoggerOptions } from './serverLogger.js';

const privateValues = [
  'private-destination@example.com',
  '123456789012',
  'private-password',
  'private-session-token',
  ['AKIA', 'IOSFODNN7EXAMPLE'].join(''),
  'eyJprivate-private-private.eyJmore-private-private.signature-private-private',
  '0123456789abcdef'.repeat(8),
] as const;

function privateFailure(): Error {
  const cause = Object.assign(
    new Error(
      `duplicate key value violates unique constraint: Key (email)=(${privateValues[0]}) ` +
        `databaseUrl=postgresql://user:${privateValues[2]}@database/chalkboard ` +
        `authorization=Bearer ${privateValues[5]} ` +
        `sessionToken=${privateValues[3]} ` +
        `access=${privateValues[4]} opaque=${privateValues[6]}`,
    ),
    {
      code: '23505',
      detail: `Key (email)=(${privateValues[0]}) already exists`,
      statusCode: 503,
    },
  );
  return new Error(
    `SES denied arn:aws:ses:ap-southeast-1:${privateValues[1]}:identity/${privateValues[0]} ` +
      `at https://example.com/path?token=${privateValues[3]}\nsecond line`,
    { cause },
  );
}

function expectNoPrivateValues(output: string): void {
  for (const value of privateValues) expect(output).not.toContain(value);
  expect(output).not.toContain('database/chalkboard');
  expect(output).not.toContain(
    'arn:aws:ses:ap-southeast-1:123456789012:identity/',
  );
  expect(output).not.toContain('/path?token');
  expect(output).not.toContain('\nsecond line');
}

describe('operational error diagnostics', () => {
  it('retains bounded type, fingerprint, stack, code, status, and nested cause', () => {
    const failure = privateFailure();
    const diagnostic = diagnoseOperationalError(failure);
    const output = JSON.stringify(diagnostic);

    expect(diagnostic).toMatchObject({
      aggregateErrors: [],
      aggregateErrorsOmitted: 0,
      errorCode: null,
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      messageLength: failure.message.length,
      messageSummary: expect.stringContaining('SES denied'),
      messageTruncated: false,
      name: 'Error',
      stackFrames: expect.any(Array),
      statusCode: null,
    });
    expect(diagnostic.cause).toMatchObject({
      errorCode: '23505',
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      name: 'Error',
      statusCode: 503,
    });
    expectNoPrivateValues(output);
  });

  it('bounds long messages, stack frames, aggregates, causes, and cycles', () => {
    const root = new Error(`failure ${'x'.repeat(4_000)}`);
    Object.defineProperty(root, 'cause', { value: root });
    const aggregate = new AggregateError(
      [
        root,
        ...Array.from({ length: 7 }, (_, index) => new Error(`error ${index}`)),
      ],
      'aggregate failed',
      { cause: new Error('outer cause') },
    );
    const diagnostic = diagnoseOperationalError(aggregate);

    expect(diagnostic.messageSummary.length).toBeLessThanOrEqual(2_048);
    expect(diagnostic.stackFrames.length).toBeLessThanOrEqual(12);
    expect(diagnostic.aggregateErrors).toHaveLength(5);
    expect(diagnostic.aggregateErrorsOmitted).toBe(3);
    expect(diagnostic.aggregateErrors[0]?.cause).toBeNull();
    expect(diagnostic.cause?.messageSummary).toBe('outer cause');
  });

  it('survives hostile Error getters and bounds oversized custom stacks', () => {
    const error = new Error('initial');
    Object.defineProperties(error, {
      cause: {
        get() {
          throw new Error('cause getter must not escape');
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
      stack: {
        get() {
          return `Error: private\n${'    at frame (/private/path:1:1)\n'.repeat(5_000)}`;
        },
      },
    });

    const diagnostic = diagnoseOperationalError(error);
    expect(diagnostic).toMatchObject({
      cause: null,
      causeUnavailable: true,
      messageSummary: 'Error message was unavailable',
      name: 'Error',
      stackFrames: expect.any(Array),
    });
    expect(diagnostic.stackFrames).toHaveLength(12);
    expect(diagnostic.stackFramesOmitted).toBeGreaterThan(0);
  });

  it('survives a hostile AggregateError errors getter', () => {
    const error = new AggregateError([], 'aggregate');
    Object.defineProperty(error, 'errors', {
      get() {
        throw new Error('errors getter must not escape');
      },
    });
    expect(diagnoseOperationalError(error)).toMatchObject({
      aggregateErrors: [],
      aggregateErrorsComplete: null,
      aggregateErrorsObserved: 0,
      aggregateErrorsOmitted: 0,
      messageSummary: 'aggregate',
    });
  });

  it('captures mutable core Error properties exactly once', () => {
    const reads = { code: 0, message: 0, name: 0, stack: 0, statusCode: 0 };
    const error = new Error('initial');
    for (const key of Object.keys(reads) as Array<keyof typeof reads>) {
      Object.defineProperty(error, key, {
        configurable: true,
        get() {
          reads[key] += 1;
          if (key === 'code') return 'ETIMEDOUT';
          if (key === 'statusCode') return 503;
          if (key === 'name') return 'MutableError';
          if (key === 'message') return 'mutable message';
          return 'MutableError: mutable message\n    at frame (/safe:1:1)';
        },
      });
    }

    expect(diagnoseOperationalError(error)).toMatchObject({
      errorCode: 'ETIMEDOUT',
      messageSummary: 'mutable message',
      name: 'MutableError',
      stackFrames: ['at frame (/safe:1:1)'],
      statusCode: 503,
    });
    expect(reads).toEqual({
      code: 1,
      message: 1,
      name: 1,
      stack: 1,
      statusCode: 1,
    });
  });

  it('marks causes omitted at the bounded depth instead of silently dropping them', () => {
    const deepest = new Error('deepest');
    const levelThree = new Error('level-three', { cause: deepest });
    const levelTwo = new Error('level-two', { cause: levelThree });
    const levelOne = new Error('level-one', { cause: levelTwo });
    const diagnostic = diagnoseOperationalError(
      new Error('root', { cause: levelOne }),
    );

    expect(diagnostic.cause?.cause?.cause).toMatchObject({
      cause: null,
      causeOmitted: true,
      causeUnavailable: false,
    });
  });

  it('does not invoke attacker-controlled coercion for non-Error throws', () => {
    const value = {
      toString() {
        throw new Error('coercion must not run');
      },
    };
    expect(diagnoseOperationalError(value)).toMatchObject({
      messageSummary: 'A non-Error object value was thrown',
      name: 'NonErrorThrow',
    });
  });

  it('survives a revoked thrown Proxy without losing the diagnostic record', () => {
    const revocable = Proxy.revocable(new Error('private message'), {});
    revocable.revoke();

    expect(() => diagnoseOperationalError(revocable.proxy)).not.toThrow();
    expect(diagnoseOperationalError(revocable.proxy)).toMatchObject({
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      messageSummary: 'A non-Error object value was thrown',
      name: 'NonErrorThrow',
    });
  });

  it('redacts independent diagnostic text and control characters', () => {
    const output = redactDiagnosticText(
      `${privateFailure().message}\u0000\u001f\u007f\u009fcontrol tail`,
    );
    expect(output).toContain('identity/[redacted]');
    expect(output).toContain('[account]');
    expect(output).toContain('[url:example.com]');
    expect(output).toContain('control tail');
    expect(output).not.toMatch(/\p{Cc}/u);
    expectNoPrivateValues(output);
  });

  it('emits one structured server record without serializing the raw Error', async () => {
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

    logOperationalError(app.log, 'email-security.cleanup', privateFailure());
    await app.close();

    const record = JSON.parse(output) as Record<string, unknown>;
    expect(record).toHaveProperty('operationalError');
    expect(output).toContain('email-security.cleanup');
    expect(output).toContain('fingerprint');
    expectNoPrivateValues(output);
  });

  it('emits one bounded JSON line before the application logger exists', () => {
    let output = '';
    writeOperationalError('server.startup', privateFailure(), {
      write(value) {
        output += String(value);
        return true;
      },
    });

    expect(() => JSON.parse(output)).not.toThrow();
    expect(output).toContain('server.startup');
    expect(output).toContain('fingerprint');
    expectNoPrivateValues(output);
  });
});
