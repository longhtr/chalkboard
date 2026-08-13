/** Covers syntax, role protection, MX/null-MX handling, address fallback, and retryable DNS failures. */
import { describe, expect, it, vi } from 'vitest';

import {
  createEmailAddressValidator,
  createTestEmailAddressValidator,
} from './addressValidation.js';

function validator(
  overrides: {
    resolve4?: () => Promise<string[]>;
    resolve6?: () => Promise<string[]>;
    resolveMx?: () => Promise<{ exchange: string; priority: number }[]>;
  } = {},
) {
  return createEmailAddressValidator({
    resolver: {
      resolve4: overrides.resolve4 ?? (async () => []),
      resolve6: overrides.resolve6 ?? (async () => []),
      resolveMx:
        overrides.resolveMx ??
        (async () => [{ exchange: 'mail.example.com', priority: 10 }]),
    },
    timeoutMs: 50,
  });
}

describe('email address validation', () => {
  it('normalizes deliverable addresses and protects high-risk role aliases', async () => {
    const validate = validator();
    await expect(validate.validate('  Person@Example.COM ')).resolves.toEqual({
      normalized: 'person@example.com',
      outcome: 'deliverable',
    });
    await expect(
      validate.validate('postmaster+signup@example.com', {
        protectRoleAddress: true,
      }),
    ).resolves.toEqual({ outcome: 'role-address' });
  });

  it('rejects malformed addresses and RFC null MX domains', async () => {
    await expect(validator().validate('not-an-address')).resolves.toEqual({
      outcome: 'invalid',
    });
    await expect(
      validator({
        resolveMx: async () => [{ exchange: '.', priority: 0 }],
      }).validate('person@example.com'),
    ).resolves.toEqual({ outcome: 'invalid' });
  });

  it('accepts an address-record fallback when MX is absent', async () => {
    const noData = Object.assign(new Error('no MX'), { code: 'ENODATA' });
    const resolve4 = vi.fn(async () => ['192.0.2.10']);
    await expect(
      validator({
        resolve4,
        resolveMx: async () => Promise.reject(noData),
      }).validate('person@example.com'),
    ).resolves.toEqual({
      normalized: 'person@example.com',
      outcome: 'deliverable',
    });
    expect(resolve4).toHaveBeenCalledWith('example.com');
  });

  it('uses a bounded-time cache and refreshes an expired DNS result', async () => {
    let now = 1_000;
    const resolveMx = vi.fn(async () => [
      { exchange: 'mail.example.com', priority: 10 },
    ]);
    const validate = createEmailAddressValidator({
      now: () => now,
      resolver: {
        resolve4: async () => [],
        resolve6: async () => [],
        resolveMx,
      },
      timeoutMs: 50,
    });
    await validate.validate('first@example.com');
    await validate.validate('second@example.com');
    expect(resolveMx).toHaveBeenCalledOnce();
    now += 11 * 60_000;
    await validate.validate('third@example.com');
    expect(resolveMx).toHaveBeenCalledTimes(2);
  });

  it('survives a hostile DNS error-code getter and reports an unknown code', async () => {
    const onFailure = vi.fn();
    const error = new Error('private domain detail');
    Object.defineProperty(error, 'code', {
      get() {
        throw new Error('code getter must not escape');
      },
    });
    const validate = createEmailAddressValidator({
      onFailure,
      resolver: {
        resolve4: async () => [],
        resolve6: async () => [],
        resolveMx: async () => Promise.reject(error),
      },
      timeoutMs: 50,
    });

    await expect(validate.validate('person@example.com')).resolves.toEqual({
      outcome: 'temporary',
    });
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: null, lookup: 'mx' }),
    );
  });

  it('reports bounded DNS outage evidence without retaining an address or domain', async () => {
    const onFailure = vi.fn();
    const error = Object.assign(
      new Error('lookup private-destination@example.com at private.example'),
      { code: 'ETIMEOUT' },
    );
    const validate = createEmailAddressValidator({
      onFailure,
      resolver: {
        resolve4: async () => [],
        resolve6: async () => [],
        resolveMx: async () => Promise.reject(error),
      },
      timeoutMs: 50,
    });

    await expect(
      validate.validate('private-destination@example.com'),
    ).resolves.toEqual({ outcome: 'temporary' });
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith({
      domainDiagnostic: expect.objectContaining({
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        observedByteLength: Buffer.byteLength('example.com'),
        summary: 'Private DNS query name omitted',
      }),
      durationMilliseconds: expect.any(Number),
      errorCode: 'ETIMEOUT',
      errorErrno: null,
      errorExtraFields: [],
      errorFieldNames: ['code'],
      errorFieldsComplete: true,
      errorFieldsObserved: 1,
      errorFieldsOmitted: 0,
      errorHostnameDiagnostic: null,
      errorSyscall: null,
      failureSource: 'resolver',
      fallbackFromMx: false,
      lookup: 'mx',
      operationalError: expect.objectContaining({
        errorCode: 'ETIMEOUT',
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
        messageLength: expect.any(Number),
        messageSummary: 'External provider operational failure',
      }),
      resolverImplementation: 'injected',
      resolverTimeoutMilliseconds: null,
      resolverTries: null,
      siblingLookup: null,
      siblingOutcome: null,
      timeoutMilliseconds: 50,
    });
    const retained = JSON.stringify(onFailure.mock.calls);
    expect(retained).not.toContain('private-destination@example.com');
    expect(retained).not.toContain('private.example');
  });

  it('retains resolver errno, syscall, fields, and nested structural evidence', async () => {
    const onFailure = vi.fn();
    const error = Object.assign(
      new Error('queryMx private.example ENETUNREACH'),
      {
        code: 'ENETUNREACH',
        errno: -101,
        hostname: 'private.example',
        syscall: 'queryMx',
      },
    );
    const validate = createEmailAddressValidator({
      onFailure,
      resolver: {
        resolve4: async () => [],
        resolve6: async () => [],
        resolveMx: async () => Promise.reject(error),
      },
      timeoutMs: 50,
    });

    await expect(validate.validate('person@example.com')).resolves.toEqual({
      outcome: 'temporary',
    });
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'ENETUNREACH',
        errorErrno: -101,
        errorFieldNames: ['code', 'errno', 'hostname', 'syscall'],
        errorFieldsComplete: true,
        errorFieldsObserved: 4,
        errorFieldsOmitted: 0,
        errorSyscall: 'queryMx',
        failureSource: 'resolver',
        lookup: 'mx',
        operationalError: expect.objectContaining({
          errorCode: 'ENETUNREACH',
          messageSummary: 'External provider operational failure',
        }),
      }),
    );
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain(
      'private.example',
    );
  });

  it('distinguishes the application DNS deadline from a resolver failure', async () => {
    const onFailure = vi.fn();
    const validate = createEmailAddressValidator({
      onFailure,
      resolver: {
        resolve4: async () => [],
        resolve6: async () => [],
        resolveMx: async () => new Promise<never>(() => undefined),
      },
      timeoutMs: 10,
    });

    await expect(validate.validate('person@example.com')).resolves.toEqual({
      outcome: 'temporary',
    });
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMilliseconds: expect.any(Number),
        errorCode: 'ETIMEOUT',
        failureSource: 'application-timeout',
        lookup: 'mx',
        operationalError: expect.objectContaining({
          name: 'DnsLookupTimeoutError',
        }),
        resolverTimeoutMilliseconds: null,
        resolverTries: null,
        timeoutMilliseconds: 10,
      }),
    );
  });

  it('reports partial address-family degradation without rejecting a deliverable domain', async () => {
    const onFailure = vi.fn();
    const timeout = Object.assign(new Error('temporary'), {
      code: 'ETIMEOUT',
      futurePrivate: 'private-resolver-extension',
      syscall: 'queryAaaa',
    });
    const noData = Object.assign(new Error('no MX'), { code: 'ENODATA' });
    const validate = createEmailAddressValidator({
      onFailure,
      resolver: {
        resolve4: async () => ['192.0.2.10'],
        resolve6: async () => Promise.reject(timeout),
        resolveMx: async () => Promise.reject(noData),
      },
      timeoutMs: 50,
    });

    await expect(validate.validate('person@example.com')).resolves.toEqual({
      normalized: 'person@example.com',
      outcome: 'deliverable',
    });
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'ETIMEOUT',
        errorExtraFields: [
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
        ],
        errorSyscall: 'queryAaaa',
        failureSource: 'resolver',
        fallbackFromMx: true,
        lookup: 'aaaa',
        siblingLookup: 'a',
        siblingOutcome: 'records',
      }),
    );
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain(
      'private-resolver-extension',
    );
  });

  it('attributes an isolated AAAA outage to the correct record type', async () => {
    const onFailure = vi.fn();
    const noData = Object.assign(new Error('no address'), { code: 'ENODATA' });
    const timeout = Object.assign(new Error('temporary'), {
      code: 'ETIMEOUT',
    });
    const validate = createEmailAddressValidator({
      onFailure,
      resolver: {
        resolve4: async () => Promise.reject(noData),
        resolve6: async () => Promise.reject(timeout),
        resolveMx: async () => Promise.reject(noData),
      },
      timeoutMs: 50,
    });

    await expect(validate.validate('person@example.com')).resolves.toEqual({
      outcome: 'temporary',
    });
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'ETIMEOUT', lookup: 'aaaa' }),
    );
  });

  it('does not report expected negative DNS answers as outages', async () => {
    const onFailure = vi.fn();
    const noDomain = Object.assign(new Error('not found'), {
      code: 'ENOTFOUND',
    });
    const validate = createEmailAddressValidator({
      onFailure,
      resolver: {
        resolve4: async () => [],
        resolve6: async () => [],
        resolveMx: async () => Promise.reject(noDomain),
      },
      timeoutMs: 50,
    });

    await expect(validate.validate('person@example.com')).resolves.toEqual({
      outcome: 'invalid',
    });
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('treats DNS outages and timeouts as retryable rather than invalid', async () => {
    for (const resolveMx of [
      async () =>
        Promise.reject(
          Object.assign(new Error('temporary'), { code: 'ETIMEOUT' }),
        ),
      async () => new Promise<never>(() => undefined),
    ]) {
      await expect(
        validator({ resolveMx }).validate('person@example.com'),
      ).resolves.toEqual({ outcome: 'temporary' });
    }
  });

  it('provides deterministic role protection without network calls in tests', async () => {
    const testValidator = createTestEmailAddressValidator();
    await expect(
      testValidator.validate('abuse@example.invalid', {
        protectRoleAddress: true,
      }),
    ).resolves.toEqual({ outcome: 'role-address' });
    await expect(
      testValidator.validate('user@example.invalid'),
    ).resolves.toEqual({
      normalized: 'user@example.invalid',
      outcome: 'deliverable',
    });
  });
});
