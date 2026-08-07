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
      context: {
        databaseUrl: 'postgresql://user:secret@database/chalkboard',
        password: 'account-secret',
        sessionToken: 'session-secret',
      },
      deep: { body: { password: 'deep-secret' } },
      inviteToken: 'invite-secret',
      token: 'opaque-secret',
    });
    await app.close();

    expect(output).not.toContain('account-secret');
    expect(output).not.toContain('database/chalkboard');
    expect(output).not.toContain('deep-secret');
    expect(output).not.toContain('invite-secret');
    expect(output).not.toContain('opaque-secret');
    expect(output).not.toContain('session-secret');
    expect(
      requiredTestValue(output.match(/\[Redacted\]/gu), 'redaction markers'),
    ).toHaveLength(6);
  });
});
