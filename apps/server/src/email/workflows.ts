/** Coordinates human/DNS/admission checks, stable pending codes, one provider attempt, and outcome recording. */
import type { AccountService } from '../accounts/service.js';
import {
  VerificationEmailDeliveryError,
  type VerificationEmailAcceptanceDiagnostic,
  type VerificationEmailFailureDiagnostic,
  type VerificationEmailSender,
} from '../accounts/verificationEmail.js';
import type { EmailAddressValidator } from './addressValidation.js';
import type {
  EmailDigest,
  EmailFlow,
  EmailSecurityService,
} from './emailSecurity.js';
import type { HumanVerifier } from '../humanVerification/humanVerifier.js';
import {
  diagnoseOperationalError,
  isErrorInstance,
  type OperationalErrorDiagnostic,
} from '../operations/errorDiagnostics.js';

export interface AccountEmailDeliveryFailureDiagnostic extends VerificationEmailFailureDiagnostic {
  purpose: EmailFlow;
}

export interface AccountEmailBookkeepingFailureDiagnostic {
  operationalError: OperationalErrorDiagnostic;
  providerAcceptance: VerificationEmailAcceptanceDiagnostic | null;
  purpose: EmailFlow;
  stage: 'accepted-send-bookkeeping' | 'deferred-delivery-task';
}

type EmailWorkflowOutcome =
  | { outcome: 'accepted'; destination?: string }
  // A change to a different address is already pending. Nothing is sent, and
  // the caller is told which address is holding the slot and for how long.
  | {
      outcome: 'pending-other-destination';
      destination: string;
      expiresAt: string;
    }
  // The address previously hard-bounced or reported spam. Permanent, so
  // retrying can never succeed and must not be suggested.
  | { outcome: 'suppressed-destination' }
  | {
      outcome:
        | 'conflict'
        | 'human-verification'
        | 'invalid-address'
        | 'invalid-password'
        | 'limited'
        | 'role-address'
        | 'unavailable'
        // Requested address is the one the caller already signed in with.
        | 'unchanged';
      retryAfterSeconds?: number;
    };

interface AccountEmailWorkflows {
  beginEmailChange(input: {
    code: string;
    currentPassword: string;
    email: string;
    userId: string;
  }): Promise<EmailWorkflowOutcome>;
  beginPasswordReset(input: {
    code: string;
    email: string;
    humanToken: string;
    ip: string;
  }): Promise<EmailWorkflowOutcome>;
  beginRegistration(input: {
    code: string;
    displayName: string;
    email: string;
    humanToken: string;
    ip: string;
    password: string;
  }): Promise<EmailWorkflowOutcome>;
}

async function deliver(input: {
  accounts: AccountService;
  code: string;
  destination: string;
  deferProvider?: boolean;
  destinationDigest: EmailDigest;
  emailSecurity: EmailSecurityService;
  generationId: string;
  onBackgroundError?(
    diagnostic: AccountEmailBookkeepingFailureDiagnostic,
  ): void;
  onDeliveryFailure?(diagnostic: AccountEmailDeliveryFailureDiagnostic): void;
  purpose: EmailFlow;
  sender: VerificationEmailSender;
  userId?: string;
}): Promise<'accepted' | 'suppressed' | 'unavailable'> {
  const reservation = await input.emailSecurity.reserveSend({
    ...(input.userId === undefined ? {} : { accountId: input.userId }),
    destination: input.destinationDigest,
    purpose: input.purpose,
  });
  if (!reservation.reserved) {
    await input.accounts.cancelPendingEmail(input.purpose, input.generationId);
    return reservation.reason === 'suppressed' ? 'suppressed' : 'unavailable';
  }
  const attached = await input.accounts.attachEmailIntent(
    input.purpose,
    input.generationId,
    reservation.intentId,
  );
  if (!attached) {
    await input.emailSecurity.completeIntent(reservation.intentId, {
      status: 'not-needed',
    });
    return 'accepted';
  }

  const reportBookkeepingFailure = (
    error: unknown,
    stage: AccountEmailBookkeepingFailureDiagnostic['stage'],
    providerAcceptance: VerificationEmailAcceptanceDiagnostic | null = null,
  ) => {
    try {
      input.onBackgroundError?.({
        operationalError: diagnoseOperationalError(error),
        providerAcceptance,
        purpose: input.purpose,
        stage,
      });
    } catch {
      // Observability must not change the already-known provider outcome.
    }
  };
  const reportDeliveryFailure = (error: VerificationEmailDeliveryError) => {
    try {
      input.onDeliveryFailure?.({
        ...error.diagnostic(),
        purpose: input.purpose,
      });
    } catch {
      // Observability must not change the already-known provider outcome.
    }
  };
  const sendAndRecord = async (): Promise<'accepted' | 'unavailable'> => {
    let delivery: Awaited<ReturnType<VerificationEmailSender['send']>>;
    try {
      delivery = await input.sender.send({
        code: input.code,
        intentId: reservation.intentId,
        purpose: input.purpose,
        to: input.destination,
      });
    } catch (error) {
      const deliveryError = isErrorInstance(
        error,
        VerificationEmailDeliveryError,
      )
        ? error
        : new VerificationEmailDeliveryError(
            'Email delivery failed without a classified outcome',
            {
              cause: error,
              certainty: 'ambiguous',
              failureClass: 'unknown',
              httpStatusCode: null,
              providerErrorName: 'UnclassifiedError',
            },
          );
      reportDeliveryFailure(deliveryError);
      await input.emailSecurity.completeIntent(
        reservation.intentId,
        deliveryError.certainty === 'ambiguous'
          ? {
              failureClass: deliveryError.failureClass,
              status: 'ambiguous',
            }
          : {
              failureClass: deliveryError.failureClass,
              status: 'rejected',
            },
      );
      if (deliveryError.certainty === 'rejected') {
        await input.accounts.cancelPendingEmail(
          input.purpose,
          input.generationId,
        );
        return 'unavailable';
      }
      // An ambiguous SES result may already have accepted the message. Keep the
      // pending code and reservation, and never create another intent for it.
      return 'accepted';
    }

    // Once the provider has returned a message identifier, delivery is known to
    // be accepted. A later database failure must never reclassify that accepted
    // send as ambiguous or permit another provider attempt.
    try {
      await input.emailSecurity.completeIntent(reservation.intentId, {
        providerMessageId: delivery.providerMessageId,
        status: 'accepted',
      });
      await input.accounts.markPendingEmailSent(
        input.purpose,
        input.generationId,
      );
    } catch (error) {
      reportBookkeepingFailure(
        error,
        'accepted-send-bookkeeping',
        delivery.acceptanceDiagnostic ?? null,
      );
    }
    return 'accepted';
  };
  if (input.deferProvider === true) {
    void sendAndRecord().catch((error: unknown) => {
      reportBookkeepingFailure(error, 'deferred-delivery-task');
    });
    return 'accepted';
  }
  return sendAndRecord();
}

/** Coordinates account pending state with durable provider admission and delivery. */
export function createAccountEmailWorkflows(options: {
  accounts: AccountService;
  addressValidator: EmailAddressValidator;
  emailSecurity?: EmailSecurityService;
  humanVerifier: HumanVerifier;
  onBackgroundError?(
    diagnostic: AccountEmailBookkeepingFailureDiagnostic,
  ): void;
  onDeliveryFailure?(diagnostic: AccountEmailDeliveryFailureDiagnostic): void;
  sender: VerificationEmailSender;
}): AccountEmailWorkflows {
  return {
    async beginRegistration(input) {
      const human = await options.humanVerifier.verify({
        action: 'registration',
        token: input.humanToken,
      });
      if (!human.verified) {
        return {
          outcome:
            human.reason === 'unavailable'
              ? 'unavailable'
              : 'human-verification',
        };
      }
      const address = await options.addressValidator.validate(input.email, {
        protectRoleAddress: true,
      });
      if (address.outcome !== 'deliverable') {
        return {
          outcome:
            address.outcome === 'temporary'
              ? 'unavailable'
              : address.outcome === 'role-address'
                ? 'role-address'
                : 'invalid-address',
        };
      }
      // A live generation is already usable. Return its existing state before
      // durable admission so a retry neither rotates its code nor consumes a
      // second destination/provider allowance.
      if (
        await options.accounts.pendingRegistrationExists(address.normalized)
      ) {
        return { destination: address.normalized, outcome: 'accepted' };
      }
      if (options.emailSecurity === undefined) {
        return { outcome: 'unavailable' };
      }
      const admission = await options.emailSecurity.admit({
        destination: address.normalized,
        flow: 'registration',
        ip: input.ip,
      });
      if (!admission.allowed) {
        return {
          outcome:
            admission.reason === 'limited'
              ? 'limited'
              : admission.reason === 'disabled'
                ? 'unavailable'
                : 'conflict',
          ...(admission.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: admission.retryAfterSeconds }),
        };
      }
      const pending = await options.accounts.beginRegistration({
        code: input.code,
        displayName: input.displayName,
        email: address.normalized,
        password: input.password,
      });
      if (pending.outcome === 'account-exists') {
        return { outcome: 'conflict' };
      }
      if (pending.outcome === 'existing') {
        return { destination: address.normalized, outcome: 'accepted' };
      }
      const outcome = await deliver({
        accounts: options.accounts,
        code: input.code,
        destination: address.normalized,
        destinationDigest: admission.destination,
        emailSecurity: options.emailSecurity,
        generationId: pending.generationId,
        ...(options.onBackgroundError === undefined
          ? {}
          : { onBackgroundError: options.onBackgroundError }),
        ...(options.onDeliveryFailure === undefined
          ? {}
          : { onDeliveryFailure: options.onDeliveryFailure }),
        purpose: 'registration',
        sender: options.sender,
      });
      if (outcome === 'accepted')
        return { destination: address.normalized, outcome };
      // Registration is unauthenticated, so a suppressed destination keeps the
      // same generic conflict its admission check already returns rather than
      // confirming anything about the address.
      return outcome === 'suppressed' ? { outcome: 'conflict' } : { outcome };
    },

    async beginPasswordReset(input) {
      const human = await options.humanVerifier.verify({
        action: 'password-reset',
        token: input.humanToken,
      });
      if (!human.verified) {
        return {
          outcome:
            human.reason === 'unavailable'
              ? 'unavailable'
              : 'human-verification',
        };
      }
      if (options.emailSecurity === undefined) {
        return { outcome: 'unavailable' };
      }
      const admission = await options.emailSecurity.admit({
        destination: input.email,
        flow: 'password-reset',
        ip: input.ip,
      });
      if (!admission.allowed) {
        if (admission.reason === 'disabled') return { outcome: 'unavailable' };
        // Suppressed and destination-limited requests still perform the same
        // bounded DNS and Argon2 classes as known and unknown destinations.
        // Equalization is side-effect free so it cannot create or race a live
        // pending generation and never persists an unknown raw destination.
        await Promise.all([
          options.addressValidator.validate(input.email),
          options.accounts.equalizePasswordReset(input.email, input.code),
        ]);
        return { outcome: 'accepted' };
      }

      // DNS and account work run together so known and unknown requests stay in
      // the same practical latency class. Unknown raw destinations are never
      // persisted and never reach the provider.
      const [address, pending] = await Promise.all([
        options.addressValidator.validate(input.email),
        options.accounts.beginPasswordReset(input.email, input.code),
      ]);
      if (address.outcome !== 'deliverable') {
        if (pending.outcome === 'created') {
          await options.accounts.cancelPendingEmail(
            'password-reset',
            pending.generationId,
          );
        }
        return { outcome: 'accepted' };
      }
      if (pending.outcome !== 'created') return { outcome: 'accepted' };

      await deliver({
        accounts: options.accounts,
        code: input.code,
        deferProvider: true,
        destination: pending.destination,
        destinationDigest: admission.destination,
        emailSecurity: options.emailSecurity,
        generationId: pending.generationId,
        ...(options.onBackgroundError === undefined
          ? {}
          : { onBackgroundError: options.onBackgroundError }),
        ...(options.onDeliveryFailure === undefined
          ? {}
          : { onDeliveryFailure: options.onDeliveryFailure }),
        purpose: 'password-reset',
        sender: options.sender,
        userId: pending.userId,
      });
      // Every known/unknown/suppressed/limited provider outcome has this shape.
      return { outcome: 'accepted' };
    },

    async beginEmailChange(input) {
      const address = await options.addressValidator.validate(input.email, {
        protectRoleAddress: true,
      });
      if (address.outcome !== 'deliverable') {
        return {
          outcome:
            address.outcome === 'temporary'
              ? 'unavailable'
              : address.outcome === 'role-address'
                ? 'role-address'
                : 'invalid-address',
        };
      }
      const pending = await options.accounts.beginEmailChange(input.userId, {
        code: input.code,
        currentPassword: input.currentPassword,
        email: address.normalized,
      });
      if (pending.outcome === 'invalid-password') {
        return { outcome: 'invalid-password' };
      }
      if (pending.outcome === 'email-conflict') {
        return { outcome: 'conflict' };
      }
      if (pending.outcome === 'unchanged') {
        return { outcome: 'unchanged' };
      }
      if (pending.outcome === 'existing') {
        return { destination: pending.destination, outcome: 'accepted' };
      }
      if (pending.outcome === 'pending-other') {
        return {
          destination: pending.destination,
          expiresAt: pending.expiresAt.toISOString(),
          outcome: 'pending-other-destination',
        };
      }
      if (options.emailSecurity === undefined) {
        await options.accounts.cancelPendingEmail(
          'email-change',
          pending.generationId,
        );
        return { outcome: 'unavailable' };
      }
      const admission = await options.emailSecurity.admit({
        accountId: input.userId,
        destination: pending.destination,
        flow: 'email-change',
      });
      if (!admission.allowed) {
        await options.accounts.cancelPendingEmail(
          'email-change',
          pending.generationId,
        );
        // The caller proved control of this account and re-entered its
        // password, so naming a permanently refused destination enumerates
        // nothing they could not already determine.
        if (admission.reason === 'suppressed')
          return { outcome: 'suppressed-destination' };
        return {
          outcome: admission.reason === 'limited' ? 'limited' : 'unavailable',
          ...(admission.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: admission.retryAfterSeconds }),
        };
      }
      const outcome = await deliver({
        accounts: options.accounts,
        code: input.code,
        destination: pending.destination,
        destinationDigest: admission.destination,
        emailSecurity: options.emailSecurity,
        generationId: pending.generationId,
        ...(options.onBackgroundError === undefined
          ? {}
          : { onBackgroundError: options.onBackgroundError }),
        ...(options.onDeliveryFailure === undefined
          ? {}
          : { onDeliveryFailure: options.onDeliveryFailure }),
        purpose: 'email-change',
        sender: options.sender,
        userId: input.userId,
      });
      if (outcome === 'accepted')
        return { destination: pending.destination, outcome };
      return outcome === 'suppressed'
        ? { outcome: 'suppressed-destination' }
        : { outcome };
    },
  };
}
