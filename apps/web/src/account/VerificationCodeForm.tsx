/** Shared email-code instructions and input used by registration and email changes. */
import { type FormEvent, useState } from 'react';

import { formatCode } from './verificationCodeFormat';

interface VerificationCodeFormProps {
  destination: string;
  error: string;
  onCancel(): void;
  onVerify(code: string): Promise<void>;
  submitting: boolean;
  title: string;
}

/** Explains the verification email and submits its one-time body code. */
export function VerificationCodeForm({
  destination,
  error,
  onCancel,
  onVerify,
  submitting,
  title,
}: VerificationCodeFormProps) {
  const [code, setCode] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (/^\d{4}-\d{4}$/u.test(code)) void onVerify(code);
  }

  return (
    <div className="email-verification">
      <div className="account-notice" role="status">
        <strong>{title}</strong>
        <span>Check {destination} for a verification code.</span>
        <span>
          If this request is eligible and delivery is accepted, the message
          contains an eight-digit code that expires in 15 minutes. If no message
          arrives, use the sign-in or password-recovery options as appropriate.
        </span>
        {import.meta.env.DEV ? (
          <a href="/development/emails" rel="noreferrer" target="_blank">
            Open local email inbox
          </a>
        ) : null}
      </div>
      <form className="account-form" onSubmit={submit}>
        <label>
          Verification code
          <input
            aria-label="Verification code"
            autoComplete="one-time-code"
            data-dialog-autofocus=""
            inputMode="numeric"
            placeholder="0000-0000"
            value={code}
            onChange={(event) => setCode(formatCode(event.target.value))}
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
          {submitting ? 'Verifying…' : 'Verify email'}
        </button>
      </form>
      <div className="verification-actions">
        <button type="button" disabled={submitting} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
