/** Shared email-code instructions and input used by registration and email changes. */
import { type FormEvent, useState } from 'react';

import { formatCode } from './verificationCodeFormat';

interface VerificationCodeFormProps {
  destination: string;
  error: string;
  onCancel(): void;
  onResend(): Promise<void>;
  onVerify(code: string): Promise<void>;
  submitting: boolean;
  title: string;
}

/** Explains the intentionally empty email and submits its subject-line code. */
export function VerificationCodeForm({
  destination,
  error,
  onCancel,
  onResend,
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
        <span>We sent a verification code to {destination}.</span>
        <span>
          You do not need to open the email: the verification code is in its
          subject. The email body is completely empty. Check spam if you cannot
          find it.
        </span>
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
        <button
          type="button"
          disabled={submitting}
          onClick={() => void onResend()}
        >
          Send another code
        </button>
      </div>
    </div>
  );
}
