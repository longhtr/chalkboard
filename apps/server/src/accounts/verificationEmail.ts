/**
 * Verification-email delivery boundary. Messages intentionally contain no body:
 * the short-lived code appears in the subject so recipients need not open mail.
 *
 * Delivery uses the Amazon SES API so credentials never appear in
 * configuration: the client resolves them from the ambient provider chain,
 * letting a deployment attach an instance role instead of storing a secret.
 */
import {
  GetAccountCommand,
  SendEmailCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2';

import type { AppConfig } from '../config.js';

type VerificationEmailPurpose =
  'email-change' | 'password-reset' | 'registration';

export interface VerificationEmailSender {
  close(): void;
  send(input: {
    code: string;
    purpose: VerificationEmailPurpose;
    to: string;
  }): Promise<void>;
  verify(): Promise<void>;
}

/** Returns the complete subject; no verification message has body content. */
export function verificationEmailSubject(
  purpose: VerificationEmailPurpose,
  code: string,
): string {
  switch (purpose) {
    case 'registration':
      return `Chalkboard verification code: ${code}`;
    case 'email-change':
      return `Chalkboard email change code: ${code}`;
    case 'password-reset':
      return `Chalkboard password reset code: ${code}`;
  }
}

/**
 * Composes a message that renders with no body. Providers reject a zero-length
 * content field, so the payload carries one invisible space instead.
 */
export function verificationEmailMessage(
  purpose: VerificationEmailPurpose,
  code: string,
): { subject: string; text: ' ' } {
  return { subject: verificationEmailSubject(purpose, code), text: ' ' };
}

/** Creates SES delivery, or a non-delivering boundary for tests/development. */
export function createVerificationEmailSender(
  configuration: AppConfig['verificationEmail'],
  logSubject: (subject: string, to: string) => void,
): VerificationEmailSender {
  if (configuration === null) {
    return {
      close() {},
      async send({ code, purpose, to }) {
        logSubject(verificationEmailSubject(purpose, code), to);
      },
      async verify() {},
    };
  }

  const client = new SESv2Client({ region: configuration.region });
  return {
    close() {
      client.destroy();
    },
    async send({ code, purpose, to }) {
      const { subject, text } = verificationEmailMessage(purpose, code);
      await client.send(
        new SendEmailCommand({
          Content: {
            Simple: {
              Body: { Text: { Data: text } },
              Subject: { Data: subject },
            },
          },
          Destination: { ToAddresses: [to] },
          FromEmailAddress: configuration.from,
        }),
      );
    },
    async verify() {
      // SES has no transport handshake, so the cheapest authenticated call
      // stands in for one: it proves the region resolves and the ambient
      // credentials are usable before any account route depends on them.
      await client.send(new GetAccountCommand({}));
    },
  };
}
