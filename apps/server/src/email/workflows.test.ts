/** Proves workflow ordering, fail-closed gates, stable pending behavior, and classified provider outcomes. */
import { describe, expect, it, vi } from 'vitest';

import type { AccountService } from '../accounts/service.js';
import {
  VerificationEmailDeliveryError,
  type VerificationEmailSender,
} from '../accounts/verificationEmail.js';
import type { EmailAddressValidator } from './addressValidation.js';
import type { EmailSecurityService } from './emailSecurity.js';
import { createAccountEmailWorkflows } from './workflows.js';

function accounts(overrides: Partial<AccountService> = {}): AccountService {
  return {
    attachEmailIntent: vi.fn(async () => true),
    beginEmailChange: vi.fn(async () => ({
      destination: 'person@example.com',
      generationId: 'email-change-generation',
      outcome: 'created' as const,
    })),
    beginPasswordReset: vi.fn(async () => ({
      destination: 'person@example.com',
      generationId: 'reset-generation',
      outcome: 'created' as const,
      userId: crypto.randomUUID(),
    })),
    beginRegistration: vi.fn(async () => ({
      generationId: 'registration-generation',
      outcome: 'created' as const,
    })),
    cancelPendingEmail: vi.fn(async () => undefined),
    completePasswordReset: vi.fn(async () => null),
    deleteAccount: vi.fn(async () => ({
      outcome: 'invalid-password' as const,
    })),
    equalizePasswordReset: vi.fn(async () => undefined),
    getSession: vi.fn(async () => null),
    login: vi.fn(async () => null),
    logout: vi.fn(async () => undefined),
    markPendingEmailSent: vi.fn(async () => undefined),
    pendingRegistrationExists: vi.fn(async () => false),
    passwordWorkSnapshot: vi.fn(() => ({
      active: 0,
      concurrent: 1,
      pending: 0,
      queued: 0,
    })),
    updateDisplayName: vi.fn(async () => {
      throw new Error('not used');
    }),
    updatePassword: vi.fn(async () => false),
    verifyCurrentPassword: vi.fn(async () => false),
    verifyEmailChange: vi.fn(async () => null),
    verifyRegistration: vi.fn(async () => null),
    ...overrides,
  };
}

function security(
  overrides: Partial<EmailSecurityService> = {},
): EmailSecurityService {
  return {
    admit: vi.fn(async () => ({
      allowed: true as const,
      destination: { keyGeneration: 1, value: 'a'.repeat(64) },
    })),
    cleanup: vi.fn(async () => undefined),
    completeIntent: vi.fn(async () => undefined),
    digestDestination: vi.fn(() => ({
      keyGeneration: 1,
      value: 'a'.repeat(64),
    })),
    reserveSend: vi.fn(async () => ({
      intentId: crypto.randomUUID(),
      reserved: true as const,
    })),
    switchStatus: vi.fn(async () => ({
      'email-change': true,
      'password-reset': true,
      registration: true,
    })),
    ...overrides,
  };
}

const validAddress: EmailAddressValidator = {
  validate: vi.fn(async (email) => ({
    normalized: email.trim().toLowerCase(),
    outcome: 'deliverable' as const,
  })),
};
const verifiedHuman = {
  verify: vi.fn(async () => ({ verified: true as const })),
};

function sender(
  send: VerificationEmailSender['send'] = vi.fn(async () => ({
    providerMessageId: 'provider-message',
  })),
): VerificationEmailSender {
  return { close: vi.fn(), send };
}

function registrationInput() {
  return {
    code: '1234-5678',
    displayName: 'Person',
    email: 'Person@Example.com',
    humanToken: 'human-token',
    ip: '192.0.2.1',
    password: 'correct horse battery staple',
  };
}

describe('account email workflows', () => {
  it('does no DNS, database, or provider work when human verification fails', async () => {
    const accountService = accounts();
    const emailSecurity = security();
    const addressValidator = { validate: vi.fn() };
    const emailSender = sender();
    const workflow = createAccountEmailWorkflows({
      accounts: accountService,
      addressValidator,
      emailSecurity,
      humanVerifier: {
        verify: vi.fn(async () => ({
          reason: 'invalid' as const,
          verified: false,
        })),
      },
      sender: emailSender,
    });

    await expect(
      workflow.beginRegistration(registrationInput()),
    ).resolves.toEqual({
      outcome: 'human-verification',
    });
    expect(addressValidator.validate).not.toHaveBeenCalled();
    expect(emailSecurity.admit).not.toHaveBeenCalled();
    expect(accountService.beginRegistration).not.toHaveBeenCalled();
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it('does no admission, account, or provider work for a protected role address', async () => {
    const accountService = accounts();
    const emailSecurity = security();
    const emailSender = sender();
    const workflow = createAccountEmailWorkflows({
      accounts: accountService,
      addressValidator: {
        validate: vi.fn(async () => ({ outcome: 'role-address' as const })),
      },
      emailSecurity,
      humanVerifier: verifiedHuman,
      sender: emailSender,
    });

    await expect(
      workflow.beginRegistration(registrationInput()),
    ).resolves.toEqual({
      outcome: 'role-address',
    });
    expect(emailSecurity.admit).not.toHaveBeenCalled();
    expect(accountService.beginRegistration).not.toHaveBeenCalled();
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it('records one accepted provider message only after attaching its intent', async () => {
    const accountService = accounts();
    const emailSecurity = security();
    const emailSender = sender();
    const workflow = createAccountEmailWorkflows({
      accounts: accountService,
      addressValidator: validAddress,
      emailSecurity,
      humanVerifier: verifiedHuman,
      sender: emailSender,
    });

    await expect(
      workflow.beginRegistration(registrationInput()),
    ).resolves.toEqual({
      destination: 'person@example.com',
      outcome: 'accepted',
    });
    expect(accountService.attachEmailIntent).toHaveBeenCalledOnce();
    expect(emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: '1234-5678',
        purpose: 'registration',
        to: 'person@example.com',
      }),
    );
    expect(emailSecurity.completeIntent).toHaveBeenCalledWith(
      expect.any(String),
      { providerMessageId: 'provider-message', status: 'accepted' },
    );
    expect(accountService.markPendingEmailSent).toHaveBeenCalledWith(
      'registration',
      'registration-generation',
    );
  });

  it.each(['intent', 'pending'] as const)(
    'does not reclassify a provider-accepted send after %s bookkeeping fails',
    async (failurePoint) => {
      const bookkeepingError = new Error('bookkeeping unavailable');
      const accountService = accounts({
        ...(failurePoint === 'pending'
          ? {
              markPendingEmailSent: vi.fn(async () => {
                throw bookkeepingError;
              }),
            }
          : {}),
      });
      const emailSecurity = security({
        ...(failurePoint === 'intent'
          ? {
              completeIntent: vi.fn(async () => {
                throw bookkeepingError;
              }),
            }
          : {}),
      });
      const onBackgroundError = vi.fn();
      const workflow = createAccountEmailWorkflows({
        accounts: accountService,
        addressValidator: validAddress,
        emailSecurity,
        humanVerifier: verifiedHuman,
        onBackgroundError,
        sender: sender(),
      });

      await expect(
        workflow.beginRegistration(registrationInput()),
      ).resolves.toEqual({
        destination: 'person@example.com',
        outcome: 'accepted',
      });
      await vi.waitFor(() =>
        expect(onBackgroundError).toHaveBeenCalledWith({
          operationalError: expect.objectContaining({
            fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
            messageSummary: 'bookkeeping unavailable',
          }),
          providerAcceptance: null,
          purpose: 'registration',
          stage: 'accepted-send-bookkeeping',
        }),
      );
      expect(accountService.cancelPendingEmail).not.toHaveBeenCalled();
      expect(emailSecurity.completeIntent).toHaveBeenCalledTimes(1);
      expect(accountService.markPendingEmailSent).toHaveBeenCalledTimes(
        failurePoint === 'intent' ? 0 : 1,
      );
    },
  );

  it('retains SES acceptance correlation when accepted-send bookkeeping fails', async () => {
    const bookkeepingError = new Error('database unavailable');
    const onBackgroundError = vi.fn();
    const accountService = accounts();
    const emailSecurity = security({
      completeIntent: vi.fn(async () => Promise.reject(bookkeepingError)),
    });
    const privateProviderMessageId = 'private-provider-message-id';
    const workflow = createAccountEmailWorkflows({
      accounts: accountService,
      addressValidator: validAddress,
      emailSecurity,
      humanVerifier: verifiedHuman,
      onBackgroundError,
      sender: sender(
        vi.fn<VerificationEmailSender['send']>(async () => ({
          acceptanceDiagnostic: {
            providerHttp: null,
            providerMessageIdDiagnostic: {
              byteLengthComplete: true,
              declaredByteLength: null,
              declaredByteLengthMatchesObserved: null,
              fingerprint: 'a'.repeat(64),
              fingerprintCoversCompleteValue: true,
              inspectionTruncated: false,
              observedByteLength: privateProviderMessageId.length,
              streamCancellationError: null,
              streamCancellationOutcome: 'not-needed',
              summary: 'Accepted provider message identifier omitted',
              summaryOmittedAsPrivate: true,
              summaryTruncated: false,
              utf8Valid: true,
            },
            providerMetadata: {
              attempts: 1,
              cfId: null,
              clockSkewCorrected: false,
              extendedRequestId: null,
              extraFields: [],
              fieldNames: [
                'attempts',
                'httpStatusCode',
                'requestId',
                'totalRetryDelay',
              ],
              fieldsComplete: true,
              fieldsObserved: 4,
              fieldsOmitted: 0,
              httpStatusCode: 200,
              requestId: 'provider-success-request-id',
              totalRetryDelayMilliseconds: 0,
            },
            providerResponseExtraFields: [],
            providerResponseFieldNames: ['$metadata', 'MessageId'],
            providerResponseFieldsComplete: true,
            providerResponseFieldsObserved: 2,
            providerResponseFieldsOmitted: 0,
            request: {
              action: 'ses:SendEmail',
              configurationSet: 'chalkboard-transactional',
              contentMode: 'simple-html-and-text',
              destinationCount: 1,
              fromMatchesConfiguredValue: true,
              maxAttempts: 1,
              region: 'ap-southeast-1',
              replyToCount: 1,
              timeoutMilliseconds: 10_000,
            },
          },
          providerMessageId: privateProviderMessageId,
        })),
      ),
    });

    await expect(
      workflow.beginRegistration(registrationInput()),
    ).resolves.toEqual({
      destination: 'person@example.com',
      outcome: 'accepted',
    });
    await vi.waitFor(() => expect(onBackgroundError).toHaveBeenCalledOnce());
    expect(onBackgroundError).toHaveBeenCalledWith(
      expect.objectContaining({
        providerAcceptance: expect.objectContaining({
          providerMessageIdDiagnostic: expect.objectContaining({
            fingerprint: 'a'.repeat(64),
          }),
          providerMetadata: expect.objectContaining({
            requestId: 'provider-success-request-id',
          }),
        }),
        purpose: 'registration',
        stage: 'accepted-send-bookkeeping',
      }),
    );
    expect(JSON.stringify(onBackgroundError.mock.calls)).not.toContain(
      privateProviderMessageId,
    );
  });

  it('reuses a still-live pending registration without reserving or sending', async () => {
    const accountService = accounts({
      pendingRegistrationExists: vi.fn(async () => true),
    });
    const emailSecurity = security();
    const emailSender = sender();
    const workflow = createAccountEmailWorkflows({
      accounts: accountService,
      addressValidator: validAddress,
      emailSecurity,
      humanVerifier: verifiedHuman,
      sender: emailSender,
    });

    await expect(
      workflow.beginRegistration(registrationInput()),
    ).resolves.toEqual({
      destination: 'person@example.com',
      outcome: 'accepted',
    });
    expect(accountService.beginRegistration).not.toHaveBeenCalled();
    expect(emailSecurity.admit).not.toHaveBeenCalled();
    expect(emailSecurity.reserveSend).not.toHaveBeenCalled();
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it('performs bounded work but creates no intent or send for an existing account', async () => {
    const accountService = accounts({
      beginRegistration: vi.fn(async () => ({
        outcome: 'account-exists' as const,
      })),
    });
    const emailSecurity = security();
    const emailSender = sender();
    const workflow = createAccountEmailWorkflows({
      accounts: accountService,
      addressValidator: validAddress,
      emailSecurity,
      humanVerifier: verifiedHuman,
      sender: emailSender,
    });

    await expect(
      workflow.beginRegistration(registrationInput()),
    ).resolves.toEqual({ outcome: 'conflict' });
    expect(emailSecurity.admit).toHaveBeenCalledOnce();
    expect(accountService.beginRegistration).toHaveBeenCalledOnce();
    expect(emailSecurity.reserveSend).not.toHaveBeenCalled();
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it('deletes pending state after explicit rejection but retains it after ambiguity', async () => {
    for (const certainty of ['rejected', 'ambiguous'] as const) {
      const accountService = accounts();
      const emailSecurity = security();
      const workflow = createAccountEmailWorkflows({
        accounts: accountService,
        addressValidator: validAddress,
        emailSecurity,
        humanVerifier: verifiedHuman,
        sender: sender(
          vi.fn(async () => {
            throw new VerificationEmailDeliveryError('provider result', {
              certainty,
              failureClass: 'transport',
              httpStatusCode: null,
              providerErrorName: 'TransportError',
            });
          }),
        ),
      });

      await expect(
        workflow.beginRegistration(registrationInput()),
      ).resolves.toEqual(
        certainty === 'rejected'
          ? { outcome: 'unavailable' }
          : { destination: 'person@example.com', outcome: 'accepted' },
      );
      expect(accountService.cancelPendingEmail).toHaveBeenCalledTimes(
        certainty === 'rejected' ? 1 : 0,
      );
      expect(emailSecurity.completeIntent).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: certainty }),
      );
    }
  });

  it('reports one complete sanitized deferred password-reset provider failure', async () => {
    const accountService = accounts();
    const emailSecurity = security();
    const onDeliveryFailure = vi.fn();
    const providerFailure = new VerificationEmailDeliveryError(
      'private provider message containing a destination',
      {
        certainty: 'rejected',
        failureClass: 'provider-rejection',
        httpStatusCode: 400,
        providerErrorName: 'BadRequestException',
      },
    );
    const workflow = createAccountEmailWorkflows({
      accounts: accountService,
      addressValidator: validAddress,
      emailSecurity,
      humanVerifier: verifiedHuman,
      onDeliveryFailure,
      sender: sender(
        vi.fn(async () => {
          throw providerFailure;
        }),
      ),
    });

    await expect(
      workflow.beginPasswordReset({
        code: '1234-5678',
        email: 'private-destination@example.com',
        humanToken: 'private-human-token',
        ip: '192.0.2.1',
      }),
    ).resolves.toEqual({ outcome: 'accepted' });
    await vi.waitFor(() =>
      expect(onDeliveryFailure).toHaveBeenCalledWith({
        ...providerFailure.diagnostic(),
        purpose: 'password-reset',
      }),
    );
    expect(onDeliveryFailure).toHaveBeenCalledOnce();
    expect(accountService.cancelPendingEmail).toHaveBeenCalledWith(
      'password-reset',
      'reset-generation',
    );
  });

  it('keeps password-reset responses identical and never sends for an unknown account', async () => {
    const accountService = accounts({
      beginPasswordReset: vi.fn(async () => ({ outcome: 'unknown' as const })),
    });
    const emailSecurity = security();
    const emailSender = sender();
    const workflow = createAccountEmailWorkflows({
      accounts: accountService,
      addressValidator: validAddress,
      emailSecurity,
      humanVerifier: verifiedHuman,
      sender: emailSender,
    });

    await expect(
      workflow.beginPasswordReset({
        code: '1234-5678',
        email: 'unknown@example.com',
        humanToken: 'human-token',
        ip: '192.0.2.1',
      }),
    ).resolves.toEqual({ outcome: 'accepted' });
    expect(emailSecurity.reserveSend).not.toHaveBeenCalled();
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it.each(['limited', 'suppressed'] as const)(
    'performs side-effect-free timing equalization for a %s reset destination',
    async (reason) => {
      const accountService = accounts();
      const emailSecurity = security({
        admit: vi.fn(async () => ({ allowed: false as const, reason })),
      });
      const addressValidator = {
        validate: vi.fn(async () => ({
          normalized: 'person@example.com',
          outcome: 'deliverable' as const,
        })),
      };
      const emailSender = sender();
      const workflow = createAccountEmailWorkflows({
        accounts: accountService,
        addressValidator,
        emailSecurity,
        humanVerifier: verifiedHuman,
        sender: emailSender,
      });

      await expect(
        workflow.beginPasswordReset({
          code: '1234-5678',
          email: 'person@example.com',
          humanToken: 'human-token',
          ip: '192.0.2.2',
        }),
      ).resolves.toEqual({ outcome: 'accepted' });
      expect(addressValidator.validate).toHaveBeenCalledOnce();
      expect(accountService.equalizePasswordReset).toHaveBeenCalledOnce();
      expect(accountService.beginPasswordReset).not.toHaveBeenCalled();
      expect(emailSecurity.reserveSend).not.toHaveBeenCalled();
      expect(emailSender.send).not.toHaveBeenCalled();
    },
  );
});
