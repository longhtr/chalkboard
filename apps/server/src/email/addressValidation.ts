/** Validates email syntax, protected roles, and bounded DNS deliverability without probing mailboxes. */
import { createHash } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { domainToASCII } from 'node:url';

import {
  isErrorInstance,
  readUnknownProperty,
  type OperationalErrorDiagnostic,
} from '../operations/errorDiagnostics.js';
import {
  diagnosePrivateProviderText,
  diagnoseProviderExtraFields,
  diagnoseProviderOperationalError,
  type ProviderTextDiagnostic,
  type ProviderValueEntryDiagnostic,
} from '../operations/providerDiagnostics.js';

export type EmailAddressValidation =
  | { outcome: 'deliverable'; normalized: string }
  | { outcome: 'invalid' | 'role-address' | 'temporary' };

interface DnsResolver {
  resolve4(hostname: string): Promise<readonly string[]>;
  resolve6(hostname: string): Promise<readonly string[]>;
  resolveMx(
    hostname: string,
  ): Promise<readonly { exchange: string; priority: number }[]>;
}

export interface EmailAddressValidationFailureDiagnostic {
  domainDiagnostic: ProviderTextDiagnostic;
  durationMilliseconds: number;
  errorCode: string | null;
  errorErrno: number | string | null;
  errorFieldNames: string[];
  errorFieldsComplete: boolean;
  errorFieldsObserved: number;
  errorFieldsOmitted: number;
  errorHostnameDiagnostic: ProviderTextDiagnostic | null;
  errorExtraFields: ProviderValueEntryDiagnostic[];
  errorSyscall: string | null;
  failureSource: 'application-timeout' | 'resolver';
  fallbackFromMx: boolean;
  lookup: 'a' | 'aaaa' | 'mx';
  operationalError: OperationalErrorDiagnostic;
  resolverImplementation: 'injected' | 'node-dns-promises';
  resolverTimeoutMilliseconds: number | null;
  resolverTries: number | null;
  siblingLookup: 'a' | 'aaaa' | null;
  siblingOutcome:
    'empty' | 'expected-negative' | 'records' | 'temporary-failure' | null;
  timeoutMilliseconds: number;
}

interface CacheEntry {
  expiresAt: number;
  outcome: 'deliverable' | 'invalid' | 'temporary';
}

const MAX_CACHE_ENTRIES = 512;
const POSITIVE_CACHE_MS = 10 * 60_000;
const NEGATIVE_CACHE_MS = 2 * 60_000;
const TEMPORARY_CACHE_MS = 15_000;
const HIGH_RISK_ROLE_LOCAL_PARTS = new Set(['abuse', 'noc', 'postmaster']);
const MAX_DNS_ERROR_FIELDS = 32;
const KNOWN_DNS_ERROR_FIELDS = new Set([
  'cause',
  'code',
  'errno',
  'hostname',
  'message',
  'name',
  'stack',
  'syscall',
  'timeoutMilliseconds',
]);

class DnsLookupTimeoutError extends Error {
  readonly code = 'ETIMEOUT';

  constructor(readonly timeoutMilliseconds: number) {
    super('DNS lookup timed out');
    this.name = 'DnsLookupTimeoutError';
  }
}

function dnsErrorCode(error: unknown): string | null {
  const code = readUnknownProperty(error, 'code');
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(code)
    ? code
    : null;
}

function dnsErrno(error: unknown): number | string | null {
  const errno = readUnknownProperty(error, 'errno');
  if (typeof errno === 'number' && Number.isSafeInteger(errno)) return errno;
  return typeof errno === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(errno)
    ? errno
    : null;
}

function dnsSyscall(error: unknown): string | null {
  const syscall = readUnknownProperty(error, 'syscall');
  return typeof syscall === 'string' &&
    /^[A-Za-z0-9_.:-]{1,128}$/u.test(syscall)
    ? syscall
    : null;
}

function dnsErrorFields(error: unknown): {
  complete: boolean;
  names: string[];
  observed: number;
  omitted: number;
} {
  if (typeof error !== 'object' || error === null) {
    return { complete: true, names: [], observed: 0, omitted: 0 };
  }
  try {
    const all = Object.keys(error);
    const retained = all.slice(0, MAX_DNS_ERROR_FIELDS);
    return {
      complete: all.length <= MAX_DNS_ERROR_FIELDS,
      names: retained.map((name) =>
        /^[A-Za-z0-9_$.-]{1,128}$/u.test(name)
          ? name
          : `[field:${createHash('sha256').update(name).digest('hex')}]`,
      ),
      observed: all.length,
      omitted: Math.max(0, all.length - retained.length),
    };
  } catch {
    return { complete: false, names: [], observed: 0, omitted: 0 };
  }
}

function emailParts(
  value: string,
): { domain: string; normalized: string; local: string } | null {
  const trimmed = value.trim();
  const separator = trimmed.lastIndexOf('@');
  if (separator <= 0 || separator === trimmed.length - 1) return null;
  const local = trimmed.slice(0, separator).toLocaleLowerCase('en-US');
  const domain = domainToASCII(
    trimmed.slice(separator + 1).toLocaleLowerCase('en-US'),
  );
  if (domain === '' || domain.length > 253 || local.length > 64) return null;
  return { domain, local, normalized: `${local}@${domain}` };
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new DnsLookupTimeoutError(timeoutMs)),
          timeoutMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function hasAddressRecord(
  resolver: DnsResolver,
  domain: string,
  timeoutMs: number,
  now: () => number,
  reportFailure: (
    lookup: EmailAddressValidationFailureDiagnostic['lookup'],
    error: unknown,
    startedAt: number,
    context: {
      domain: string;
      fallbackFromMx: boolean;
      siblingLookup: 'a' | 'aaaa' | null;
      siblingOutcome: EmailAddressValidationFailureDiagnostic['siblingOutcome'];
    },
  ) => void,
): Promise<'deliverable' | 'invalid' | 'temporary'> {
  const startedAt = now();
  const lookups = await Promise.allSettled([
    bounded(resolver.resolve4(domain), timeoutMs),
    bounded(resolver.resolve6(domain), timeoutMs),
  ]);
  const hasDeliverableRecord = lookups.some(
    (result) => result.status === 'fulfilled' && result.value.length > 0,
  );
  const rejected = lookups.flatMap((result, index) =>
    result.status === 'rejected'
      ? [{ lookup: index === 0 ? ('a' as const) : ('aaaa' as const), result }]
      : [],
  );
  rejected.forEach(({ lookup, result }) => {
    const code = dnsErrorCode(result.reason);
    if (code !== 'ENODATA' && code !== 'ENOTFOUND') {
      const siblingIndex = lookup === 'a' ? 1 : 0;
      const sibling = lookups[siblingIndex];
      let siblingOutcome: EmailAddressValidationFailureDiagnostic['siblingOutcome'] =
        null;
      if (sibling?.status === 'fulfilled') {
        siblingOutcome = sibling.value.length > 0 ? 'records' : 'empty';
      } else if (sibling?.status === 'rejected') {
        const siblingCode = dnsErrorCode(sibling.reason);
        siblingOutcome =
          siblingCode === 'ENODATA' || siblingCode === 'ENOTFOUND'
            ? 'expected-negative'
            : 'temporary-failure';
      }
      reportFailure(lookup, result.reason, startedAt, {
        domain,
        fallbackFromMx: true,
        siblingLookup: lookup === 'a' ? 'aaaa' : 'a',
        siblingOutcome,
      });
    }
  });
  if (hasDeliverableRecord) return 'deliverable';
  const errors = rejected.map(({ result }) => dnsErrorCode(result.reason));
  return errors.every((code) => code === 'ENODATA' || code === 'ENOTFOUND')
    ? 'invalid'
    : 'temporary';
}

export interface EmailAddressValidator {
  validate(
    address: string,
    options?: { protectRoleAddress?: boolean },
  ): Promise<EmailAddressValidation>;
}

/** Deterministic no-network validator used by ordinary automated tests. */
export function createTestEmailAddressValidator(): EmailAddressValidator {
  return {
    async validate(address, options = {}) {
      const parts = emailParts(address);
      if (parts === null) return { outcome: 'invalid' };
      const roleBase = parts.local.split('+', 1)[0];
      if (
        options.protectRoleAddress === true &&
        roleBase !== undefined &&
        HIGH_RISK_ROLE_LOCAL_PARTS.has(roleBase)
      ) {
        return { outcome: 'role-address' };
      }
      return { outcome: 'deliverable', normalized: parts.normalized };
    },
  };
}

/** Validates one address's domain without probing or disclosing the mailbox. */
export function createEmailAddressValidator(
  options: {
    developmentTestDomain?: string;
    now?: () => number;
    onFailure?(diagnostic: EmailAddressValidationFailureDiagnostic): void;
    resolver?: DnsResolver;
    timeoutMs?: number;
  } = {},
): EmailAddressValidator {
  const resolver =
    options.resolver ?? new Resolver({ timeout: 2_000, tries: 1 });
  const timeoutMs = options.timeoutMs ?? 2_500;
  const resolverTimeoutMilliseconds =
    options.resolver === undefined ? 2_000 : null;
  const resolverTries = options.resolver === undefined ? 1 : null;
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  const developmentTestDomain =
    options.developmentTestDomain?.toLocaleLowerCase('en-US');
  const reportFailure = (
    lookup: EmailAddressValidationFailureDiagnostic['lookup'],
    error: unknown,
    startedAt: number,
    context: {
      domain: string;
      fallbackFromMx: boolean;
      siblingLookup: 'a' | 'aaaa' | null;
      siblingOutcome: EmailAddressValidationFailureDiagnostic['siblingOutcome'];
    },
  ) => {
    try {
      const fields = dnsErrorFields(error);
      const errorHostname = readUnknownProperty(error, 'hostname');
      options.onFailure?.({
        domainDiagnostic: diagnosePrivateProviderText(
          context.domain,
          'Private DNS query name omitted',
        ),
        durationMilliseconds: Math.max(0, now() - startedAt),
        errorCode: dnsErrorCode(error),
        errorErrno: dnsErrno(error),
        errorFieldNames: fields.names,
        errorFieldsComplete: fields.complete,
        errorFieldsObserved: fields.observed,
        errorFieldsOmitted: fields.omitted,
        errorHostnameDiagnostic:
          typeof errorHostname === 'string'
            ? diagnosePrivateProviderText(
                errorHostname,
                'Private DNS error hostname omitted',
              )
            : null,
        errorExtraFields: diagnoseProviderExtraFields(
          error,
          KNOWN_DNS_ERROR_FIELDS,
        ),
        errorSyscall: dnsSyscall(error),
        failureSource: isErrorInstance(error, DnsLookupTimeoutError)
          ? 'application-timeout'
          : 'resolver',
        fallbackFromMx: context.fallbackFromMx,
        lookup,
        operationalError: diagnoseProviderOperationalError(error),
        resolverImplementation:
          options.resolver === undefined ? 'node-dns-promises' : 'injected',
        resolverTimeoutMilliseconds,
        resolverTries,
        siblingLookup: context.siblingLookup,
        siblingOutcome: context.siblingOutcome,
        timeoutMilliseconds: timeoutMs,
      });
    } catch {
      // Diagnostics must never change address-validation admission.
    }
  };

  const cacheOutcome = (
    domain: string,
    outcome: CacheEntry['outcome'],
  ): CacheEntry['outcome'] => {
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(domain, {
      expiresAt:
        now() +
        (outcome === 'deliverable'
          ? POSITIVE_CACHE_MS
          : outcome === 'invalid'
            ? NEGATIVE_CACHE_MS
            : TEMPORARY_CACHE_MS),
      outcome,
    });
    return outcome;
  };

  return {
    async validate(address, validationOptions = {}) {
      const parts = emailParts(address);
      if (parts === null) return { outcome: 'invalid' };
      const roleBase = parts.local.split('+', 1)[0];
      if (
        validationOptions.protectRoleAddress === true &&
        roleBase !== undefined &&
        HIGH_RISK_ROLE_LOCAL_PARTS.has(roleBase)
      ) {
        return { outcome: 'role-address' };
      }
      if (parts.domain === developmentTestDomain) {
        return { outcome: 'deliverable', normalized: parts.normalized };
      }
      const cached = cache.get(parts.domain);
      if (cached !== undefined && cached.expiresAt > now()) {
        return cached.outcome === 'deliverable'
          ? { outcome: 'deliverable', normalized: parts.normalized }
          : { outcome: cached.outcome };
      }
      if (cached !== undefined) cache.delete(parts.domain);

      let outcome: CacheEntry['outcome'];
      const mxStartedAt = now();
      try {
        const records = await bounded(
          resolver.resolveMx(parts.domain),
          timeoutMs,
        );
        if (
          records.some(({ exchange }) => exchange === '' || exchange === '.')
        ) {
          outcome = 'invalid';
        } else if (records.length > 0) {
          outcome = 'deliverable';
        } else {
          outcome = await hasAddressRecord(
            resolver,
            parts.domain,
            timeoutMs,
            now,
            reportFailure,
          );
        }
      } catch (error) {
        const code = dnsErrorCode(error);
        if (code === 'ENODATA') {
          outcome = await hasAddressRecord(
            resolver,
            parts.domain,
            timeoutMs,
            now,
            reportFailure,
          );
        } else if (code === 'ENOTFOUND') {
          outcome = 'invalid';
        } else {
          reportFailure('mx', error, mxStartedAt, {
            domain: parts.domain,
            fallbackFromMx: false,
            siblingLookup: null,
            siblingOutcome: null,
          });
          outcome = 'temporary';
        }
      }
      cacheOutcome(parts.domain, outcome);
      return outcome === 'deliverable'
        ? { outcome, normalized: parts.normalized }
        : { outcome };
    },
  };
}
