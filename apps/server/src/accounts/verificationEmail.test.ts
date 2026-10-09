/** Locks branded message content and local development capture behavior. */
import { describe, expect, it } from 'vitest';

import {
  createDevelopmentVerificationEmailSender,
  createUnavailableVerificationEmailSender,
  verificationEmailMessage,
} from './verificationEmail.js';

describe('verificationEmailMessage', () => {
  it('keeps codes out of subjects and includes complete text and HTML bodies', () => {
    for (const purpose of [
      'registration',
      'email-change',
      'password-reset',
    ] as const) {
      const message = verificationEmailMessage(purpose, '1234-5678');
      expect(message.subject).not.toContain('1234-5678');
      expect(message.text).toContain('1234-5678');
      expect(message.text).toContain('expires in 15 minutes');
      expect(message.html).toContain('1234-5678');
    }
  });
});

describe('unavailable delivery', () => {
  it('fails closed with a rejected configuration outcome', async () => {
    const sender = createUnavailableVerificationEmailSender();
    await expect(
      sender.send({
        code: '1234-5678',
        intentId: crypto.randomUUID(),
        purpose: 'registration',
        to: 'person@example.com',
      }),
    ).rejects.toMatchObject({
      certainty: 'rejected',
      failureClass: 'configuration',
      providerErrorName: 'LocalConfigurationError',
    });
  });
});

describe('development email capture', () => {
  it('captures only reserved local test destinations without logging or network delivery', async () => {
    const development = createDevelopmentVerificationEmailSender();
    await development.sender.send({
      code: '1234-5678',
      intentId: crypto.randomUUID(),
      purpose: 'registration',
      to: 'tester@chalkboard.test',
    });

    expect(development.inbox.list()).toMatchObject([
      {
        purpose: 'registration',
        subject: 'Confirm your Chalkboard account',
        to: 'tester@chalkboard.test',
      },
    ]);
    expect(development.inbox.list()[0]?.text).toContain('1234-5678');
    await expect(
      development.sender.send({
        code: '1234-5678',
        intentId: crypto.randomUUID(),
        purpose: 'registration',
        to: 'real@example.com',
      }),
    ).rejects.toMatchObject({ certainty: 'rejected' });
  });
});
