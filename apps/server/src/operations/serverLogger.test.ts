/** Locks logger level selection and every credential/content redaction path. */
import { Writable } from 'node:stream';

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { requiredTestValue } from '../test/assertions.js';
import { serverLoggerOptions } from './serverLogger.js';

describe('server logger redaction', () => {
  it('removes credentials and tokens from emitted structured logs', async () => {
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

    app.log.info({
      body: { destination: 'private-destination@example.com' },
      context: {
        databaseUrl: 'postgresql://user:secret@database/chalkboard',
        password: 'account-secret',
        sessionToken: 'session-secret',
      },
      deep: {
        body: { password: 'deep-secret' },
        levelTwo: {
          levelThree: {
            levelFour: { token: 'deepest-token-secret' },
          },
        },
      },
      err: new Error('raw-error-secret'),
      inviteToken: 'invite-secret',
      message: 'raw-message-secret',
      providerMessage: 'provider-message-secret',
      token: 'opaque-secret',
      url: '/private/path?token=url-secret',
    });
    await app.close();

    expect(output).not.toContain('account-secret');
    expect(output).not.toContain('database/chalkboard');
    expect(output).not.toContain('deep-secret');
    expect(output).not.toContain('deepest-token-secret');
    expect(output).not.toContain('invite-secret');
    expect(output).not.toContain('opaque-secret');
    expect(output).not.toContain('private-destination');
    expect(output).not.toContain('provider-message-secret');
    expect(output).not.toContain('raw-error-secret');
    expect(output).not.toContain('raw-message-secret');
    expect(output).not.toContain('session-secret');
    expect(output).not.toContain('url-secret');
    expect(
      requiredTestValue(output.match(/\[Redacted\]/gu), 'redaction markers'),
    ).toHaveLength(12);
  }, 10_000);

  it('bounds cycles and survives hostile objects without invoking getters', async () => {
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
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('prototype getter secret');
        },
      },
    );

    expect(() => app.log.info({ cyclic, hostile })).not.toThrow();
    await app.close();
    expect(output).toContain('[Truncated]');
    expect(output).toContain('[Unavailable]');
    expect(output).not.toContain('prototype getter secret');
  });

  it('preserves fields emitted by the approved bounded diagnostic shape', async () => {
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

    app.log.error({
      operationalError: {
        diagnostic: {
          errorCode: '23505',
          messageSummary: 'safe bounded summary',
          providerSchemaIssues: [
            { issueCode: 'invalid_type', path: 'success' },
          ],
        },
        event: 'database.query',
      },
    });
    await app.close();

    expect(output).toContain('"errorCode":"23505"');
    expect(output).toContain('"issueCode":"invalid_type"');
    expect(output).toContain('"messageSummary":"safe bounded summary"');
    expect(output).not.toContain('"issueCode":"[Redacted]"');
  });
});
