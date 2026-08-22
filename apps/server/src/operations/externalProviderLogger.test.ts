/** Proves complete Turnstile and DNS adapter records survive production logging. */
import { Writable } from 'node:stream';

import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import {
  createEmailAddressValidator,
  type EmailAddressValidationFailureDiagnostic,
} from '../email/addressValidation.js';
import {
  createTurnstileHumanVerifier,
  type HumanVerificationFailureDiagnostic,
} from '../humanVerification/humanVerifier.js';
import {
  logDnsProviderFailure,
  logTurnstileProviderFailure,
} from './externalProviderLogger.js';
import { serverLoggerOptions } from './serverLogger.js';

async function loggerOutput(
  write: (app: ReturnType<typeof Fastify>) => void,
): Promise<Record<string, unknown>> {
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
  write(app);
  await app.close();
  return JSON.parse(output) as Record<string, unknown>;
}

describe('external provider logger', () => {
  it('preserves the complete DNS adapter diagnostic without private provider values', async () => {
    const privateDomain = 'private.example';
    const privateExtension = 'private-resolver-extension';
    let diagnostic: EmailAddressValidationFailureDiagnostic | undefined;
    const error = Object.assign(new Error(`queryMx ${privateDomain}`), {
      code: 'ETIMEOUT',
      futurePrivate: privateExtension,
      hostname: privateDomain,
      syscall: 'queryMx',
    });
    const validator = createEmailAddressValidator({
      onFailure: (value) => {
        diagnostic = value;
      },
      resolver: {
        resolve4: async () => [],
        resolve6: async () => [],
        resolveMx: async () => Promise.reject(error),
      },
      timeoutMs: 50,
    });
    await validator.validate(`person@${privateDomain}`);
    expect(diagnostic).toBeDefined();

    const record = await loggerOutput((app) =>
      logDnsProviderFailure(app.log, diagnostic!),
    );
    expect(record['emailAddressValidationFailure']).toEqual(diagnostic);
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(privateDomain);
    expect(serialized).not.toContain(privateExtension);
  });

  it('preserves the complete Turnstile adapter diagnostic without token, secret, hostname, or body', async () => {
    const privateToken = 'private-turnstile-token';
    const privateSecret = 'private-turnstile-secret';
    const privateHostname = 'private.example';
    const privateExtension = 'private-provider-extension';
    let diagnostic: HumanVerificationFailureDiagnostic | undefined;
    const verifier = createTurnstileHumanVerifier({
      expectedHostname: 'chalkboard.example',
      fetchImplementation: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              action: 'registration',
              challenge_ts: '2026-08-10T12:00:00.000Z',
              hostname: privateHostname,
              privateExtension,
              success: true,
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ),
      now: () => Date.parse('2026-08-10T12:00:01.000Z'),
      onFailure: (value) => {
        diagnostic = value;
      },
      secret: privateSecret,
      timeoutMs: 50,
    });
    await verifier.verify({ action: 'registration', token: privateToken });
    expect(diagnostic).toBeDefined();

    const record = await loggerOutput((app) =>
      logTurnstileProviderFailure(app.log, diagnostic!),
    );
    expect(record['humanVerificationFailure']).toEqual(diagnostic);
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(privateToken);
    expect(serialized).not.toContain(privateSecret);
    expect(serialized).not.toContain(privateHostname);
    expect(serialized).not.toContain(privateExtension);
  });
});
