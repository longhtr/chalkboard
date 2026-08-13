/** Email-code password recovery available from the signed-out login form. */
import {
  MAX_ACCOUNT_EMAIL_LENGTH,
  MAX_ACCOUNT_PASSWORD_LENGTH,
  MIN_ACCOUNT_PASSWORD_LENGTH,
} from '@chalkboard/shared';
import { type FormEvent, useState } from 'react';

import {
  decodeVerificationRequiredResponse,
  isApiError,
  isUnavailableError,
  requestApi,
} from './api';
import { HumanVerification } from './HumanVerification';
import { formatCode } from './verificationCodeFormat';

interface PasswordResetFormProps {
  initialEmail: string;
  onBack(): void;
  onCompleted(email: string): void;
}

function message(error: unknown): string {
  if (isUnavailableError(error))
    return 'Chalkboard is unavailable. Try again later.';
  return isApiError(error)
    ? error.message
    : 'Password reset failed. Try again.';
}

/** Requests a non-enumerating reset email, then verifies its code and new password. */
export function PasswordResetForm({
  initialEmail,
  onBack,
  onCompleted,
}: PasswordResetFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [humanVerificationToken, setHumanVerificationToken] = useState<
    string | null
  >(null);
  const [humanVerificationResetKey, setHumanVerificationResetKey] = useState(0);

  async function sendCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (humanVerificationToken === null) {
      setError('Complete the human verification before requesting a code.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await requestApi(
        '/api/auth/password-reset',
        {
          method: 'POST',
          body: JSON.stringify({
            email: email.trim(),
            humanVerificationToken,
          }),
        },
        decodeVerificationRequiredResponse,
      );
      setCodeSent(true);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setHumanVerificationToken(null);
      setHumanVerificationResetKey((current) => current + 1);
      setSubmitting(false);
    }
  }

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    if (newPassword.length < MIN_ACCOUNT_PASSWORD_LENGTH) {
      setError(
        `New password must be at least ${MIN_ACCOUNT_PASSWORD_LENGTH} characters.`,
      );
      return;
    }
    setSubmitting(true);
    try {
      await requestApi('/api/auth/password-reset/complete', {
        method: 'POST',
        body: JSON.stringify({
          code,
          email: email.trim(),
          newPassword,
        }),
      });
      onCompleted(email.trim());
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSubmitting(false);
    }
  }

  if (!codeSent) {
    return (
      <div className="email-verification">
        <form className="account-form" onSubmit={sendCode}>
          <p className="account-form-introduction">
            Enter the email used by your Chalkboard account. If it exists, we
            will send a password-reset code.
          </p>
          <label>
            Email
            <input
              aria-label="Password reset email"
              autoComplete="email"
              data-dialog-autofocus=""
              maxLength={MAX_ACCOUNT_EMAIL_LENGTH}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <HumanVerification
            action="password-reset"
            disabled={submitting}
            onToken={setHumanVerificationToken}
            resetKey={humanVerificationResetKey}
          />
          {error !== '' ? (
            <p className="account-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="account-primary"
            type="submit"
            disabled={submitting || humanVerificationToken === null}
          >
            {submitting ? 'Sending…' : 'Send reset code'}
          </button>
        </form>
        <div className="verification-actions">
          <button type="button" disabled={submitting} onClick={onBack}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="email-verification">
      <div className="account-notice" role="status">
        <strong>Check your email</strong>
        <span>Check {email.trim()} for a reset code.</span>
        <span>
          If an eligible account uses this address and delivery is permitted,
          the message contains an eight-digit code that expires in 15 minutes.
          The response is the same when no message is sent.
        </span>
        {import.meta.env.DEV ? (
          <a href="/development/emails" rel="noreferrer" target="_blank">
            Open local email inbox
          </a>
        ) : null}
      </div>
      <form className="account-form" onSubmit={complete}>
        <label>
          Verification code
          <input
            aria-label="Password reset code"
            autoComplete="one-time-code"
            inputMode="numeric"
            placeholder="0000-0000"
            value={code}
            onChange={(event) => setCode(formatCode(event.target.value))}
            required
          />
        </label>
        <label>
          New password
          <input
            aria-label="Reset new password"
            autoComplete="new-password"
            maxLength={MAX_ACCOUNT_PASSWORD_LENGTH}
            minLength={MIN_ACCOUNT_PASSWORD_LENGTH}
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </label>
        <label>
          Confirm new password
          <input
            aria-label="Confirm reset password"
            autoComplete="new-password"
            maxLength={MAX_ACCOUNT_PASSWORD_LENGTH}
            minLength={MIN_ACCOUNT_PASSWORD_LENGTH}
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </label>
        {error !== '' ? (
          <p className="account-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="account-primary"
          type="submit"
          disabled={submitting || !/^\d{4}-\d{4}$/u.test(code)}
        >
          {submitting ? 'Resetting…' : 'Reset password'}
        </button>
      </form>
      <div className="verification-actions">
        <button type="button" disabled={submitting} onClick={onBack}>
          Back to sign in
        </button>
      </div>
    </div>
  );
}
