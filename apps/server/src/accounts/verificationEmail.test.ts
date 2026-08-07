/** Locks the visible content of each bodyless verification email and the SES request built from it. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createVerificationEmailSender,
  verificationEmailMessage,
  verificationEmailSubject,
} from './verificationEmail.js';

const ses = vi.hoisted(() => ({
  clientConfigurations: [] as unknown[],
  destroy: vi.fn(),
  send: vi.fn(),
}));

// The SES request is otherwise never exercised: production credentials are
// absent everywhere the suite runs, so a malformed command would first surface
// in a deployed environment.
vi.mock('@aws-sdk/client-sesv2', () => ({
  GetAccountCommand: class {
    constructor(readonly input: unknown) {}
  },
  SendEmailCommand: class {
    constructor(readonly input: unknown) {}
  },
  SESv2Client: class {
    destroy = ses.destroy;
    send = ses.send;
    constructor(configuration: unknown) {
      ses.clientConfigurations.push(configuration);
    }
  },
}));

const configuration = {
  from: 'Chalkboard <accounts@example.com>',
  region: 'ap-southeast-1',
};

function sentInput(): Record<string, unknown> {
  const [command] = ses.send.mock.calls[0] as [{ input: unknown }];
  return command.input as Record<string, unknown>;
}

beforeEach(() => {
  ses.clientConfigurations.length = 0;
  ses.destroy.mockClear();
  ses.send.mockClear();
  ses.send.mockResolvedValue({});
});

describe('verificationEmailSubject', () => {
  it('places registration, email-change, and reset codes in their subjects', () => {
    expect(verificationEmailSubject('registration', '1234-5678')).toBe(
      'Chalkboard verification code: 1234-5678',
    );
    expect(verificationEmailSubject('email-change', '1234-5678')).toBe(
      'Chalkboard email change code: 1234-5678',
    );
    expect(verificationEmailSubject('password-reset', '1234-5678')).toBe(
      'Chalkboard password reset code: 1234-5678',
    );
    expect(verificationEmailMessage('registration', '1234-5678')).toEqual({
      subject: 'Chalkboard verification code: 1234-5678',
      text: ' ',
    });
  });
});

describe('createVerificationEmailSender with SES configured', () => {
  it('builds the client for the configured region', () => {
    createVerificationEmailSender(configuration, vi.fn());

    expect(ses.clientConfigurations).toEqual([{ region: 'ap-southeast-1' }]);
  });

  it('sends the subject-only message to one recipient from the configured identity', async () => {
    const sender = createVerificationEmailSender(configuration, vi.fn());

    await sender.send({
      code: '1234-5678',
      purpose: 'registration',
      to: 'person@example.com',
    });

    expect(ses.send).toHaveBeenCalledTimes(1);
    expect(sentInput()).toEqual({
      Content: {
        Simple: {
          // A genuinely empty body is rejected, so one space stands in for it.
          Body: { Text: { Data: ' ' } },
          Subject: { Data: 'Chalkboard verification code: 1234-5678' },
        },
      },
      Destination: { ToAddresses: ['person@example.com'] },
      FromEmailAddress: 'Chalkboard <accounts@example.com>',
    });
  });

  it('carries each purpose through to the subject it sends', async () => {
    const sender = createVerificationEmailSender(configuration, vi.fn());

    await sender.send({
      code: '8765-4321',
      purpose: 'password-reset',
      to: 'person@example.com',
    });

    expect(sentInput().Content).toMatchObject({
      Simple: {
        Subject: { Data: 'Chalkboard password reset code: 8765-4321' },
      },
    });
  });

  it('surfaces a delivery failure to the caller', async () => {
    ses.send.mockRejectedValueOnce(new Error('Could not load credentials'));
    const sender = createVerificationEmailSender(configuration, vi.fn());

    await expect(
      sender.send({
        code: '1234-5678',
        purpose: 'registration',
        to: 'person@example.com',
      }),
    ).rejects.toThrow('Could not load credentials');
  });

  it('probes credentials on verify and releases the client on close', async () => {
    const sender = createVerificationEmailSender(configuration, vi.fn());

    await sender.verify();
    expect(ses.send).toHaveBeenCalledTimes(1);
    expect(sentInput()).toEqual({});

    sender.close();
    expect(ses.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('createVerificationEmailSender without SES configured', () => {
  it('logs the subject instead of contacting a provider', async () => {
    const logSubject = vi.fn();
    const sender = createVerificationEmailSender(null, logSubject);

    await sender.send({
      code: '1234-5678',
      purpose: 'registration',
      to: 'person@example.com',
    });
    await sender.verify();
    sender.close();

    expect(logSubject).toHaveBeenCalledWith(
      'Chalkboard verification code: 1234-5678',
      'person@example.com',
    );
    expect(ses.clientConfigurations).toEqual([]);
    expect(ses.send).not.toHaveBeenCalled();
  });
});
