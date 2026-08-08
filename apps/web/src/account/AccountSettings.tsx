/**
 * Signed-in personal account forms. Username, email, and password mutations are
 * independent so one failed sensitive change cannot discard another draft.
 */
import {
  MAX_ACCOUNT_DISPLAY_NAME_LENGTH,
  MAX_ACCOUNT_EMAIL_LENGTH,
  MAX_ACCOUNT_PASSWORD_LENGTH,
  MIN_ACCOUNT_PASSWORD_LENGTH,
} from '@chalkboard/shared';
import { type FormEvent, useState } from 'react';

import {
  decodeUserResponse,
  decodeVerificationRequiredResponse,
  isApiError,
  isUnavailableError,
  requestApi,
  type User,
} from './api';
import { VerificationCodeForm } from './VerificationCodeForm';

interface AccountSettingsProps {
  available: boolean;
  onSessionExpired(): void;
  onUserUpdated(user: User): void;
  user: User;
}

type Setting = 'email' | 'password' | 'username';

function errorMessage(error: unknown, fallback: string): string {
  if (isApiError(error) && error.status === 502) return error.message;
  if (isUnavailableError(error)) {
    return 'Account services are unavailable. Try again after reconnecting.';
  }
  return isApiError(error) ? error.message : fallback;
}

/** Renders and submits the three account mutations supported by the API. */
export function AccountSettings({
  available,
  onSessionExpired,
  onUserUpdated,
  user,
}: AccountSettingsProps) {
  const [username, setUsername] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  const [emailPassword, setEmailPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState<Setting | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  function begin(setting: Setting) {
    setBusy(setting);
    setError('');
    setStatus('');
  }

  function fail(caught: unknown, fallback: string) {
    if (isApiError(caught) && caught.status === 401) {
      onSessionExpired();
      return;
    }
    setError(errorMessage(caught, fallback));
  }

  async function changeUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (username.trim() === '') return;
    begin('username');
    try {
      const result = await requestApi(
        '/api/account/display-name',
        {
          method: 'PATCH',
          body: JSON.stringify({ displayName: username }),
        },
        decodeUserResponse,
      );
      setUsername(result.user.displayName);
      onUserUpdated(result.user);
      setStatus('Username updated.');
    } catch (caught) {
      fail(caught, 'Unable to update username');
    } finally {
      setBusy(null);
    }
  }

  async function changeEmail(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (email.trim() === '' || emailPassword === '') return;
    begin('email');
    try {
      const result = await requestApi(
        '/api/account/email',
        {
          method: 'PATCH',
          body: JSON.stringify({
            currentPassword: emailPassword,
            email: email.trim(),
          }),
        },
        decodeVerificationRequiredResponse,
      );
      setPendingEmail(result.email ?? email.trim());
    } catch (caught) {
      fail(caught, 'Unable to update email');
    } finally {
      setBusy(null);
    }
  }

  async function verifyEmailChange(code: string) {
    setBusy('email');
    setError('');
    try {
      const result = await requestApi(
        '/api/account/email/verify',
        {
          method: 'POST',
          body: JSON.stringify({ code }),
        },
        decodeUserResponse,
      );
      setEmail(result.user.email);
      setEmailPassword('');
      setPendingEmail(null);
      onUserUpdated(result.user);
      setStatus('Email updated.');
    } catch (caught) {
      fail(caught, 'Unable to verify the new email');
    } finally {
      setBusy(null);
    }
  }

  async function resendEmailChangeCode() {
    await changeEmail();
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setStatus('');
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
    begin('password');
    try {
      await requestApi('/api/account/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setStatus('Password updated.');
    } catch (caught) {
      fail(caught, 'Unable to update password');
    } finally {
      setBusy(null);
    }
  }

  const disabled = !available || busy !== null;
  return (
    <div className="account-settings">
      {error !== '' && pendingEmail === null ? (
        <p className="account-error" role="alert">
          {error}
        </p>
      ) : null}
      {status !== '' ? (
        <p className="account-notice" role="status">
          {status}
        </p>
      ) : null}

      <form className="account-setting-form" onSubmit={changeUsername}>
        <div>
          <h3>Username</h3>
          <p>The name other people see on shared boards.</p>
        </div>
        <input
          aria-label="Username"
          maxLength={MAX_ACCOUNT_DISPLAY_NAME_LENGTH}
          value={username}
          disabled={disabled}
          autoComplete="nickname"
          onChange={(event) => setUsername(event.target.value)}
          required
        />
        <button
          className="account-primary"
          type="submit"
          disabled={disabled || username.trim() === user.displayName}
        >
          Save username
        </button>
      </form>

      {pendingEmail === null ? (
        <form className="account-setting-form" onSubmit={changeEmail}>
          <div>
            <h3>Email</h3>
            <p>Used to sign in and receive board access.</p>
          </div>
          <input
            aria-label="Account email"
            type="email"
            maxLength={MAX_ACCOUNT_EMAIL_LENGTH}
            value={email}
            disabled={disabled}
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label>
            Current password
            <input
              aria-label="Current password for email change"
              type="password"
              maxLength={MAX_ACCOUNT_PASSWORD_LENGTH}
              value={emailPassword}
              disabled={disabled}
              autoComplete="current-password"
              onChange={(event) => setEmailPassword(event.target.value)}
              required
            />
          </label>
          <button
            className="account-primary"
            type="submit"
            disabled={
              disabled || email.trim() === user.email || emailPassword === ''
            }
          >
            Verify new email
          </button>
        </form>
      ) : (
        <section className="account-setting-form" aria-label="Verify new email">
          <VerificationCodeForm
            destination={pendingEmail}
            error={error}
            onCancel={() => {
              setPendingEmail(null);
              setError('');
            }}
            onResend={resendEmailChangeCode}
            onVerify={verifyEmailChange}
            submitting={busy === 'email'}
            title="Verify the new email before changing your account"
          />
        </section>
      )}

      <form className="account-setting-form" onSubmit={changePassword}>
        <div>
          <h3>Password</h3>
          <p>Changing it requires your current password.</p>
        </div>
        <label>
          Current password
          <input
            aria-label="Current password"
            type="password"
            minLength={MIN_ACCOUNT_PASSWORD_LENGTH}
            maxLength={MAX_ACCOUNT_PASSWORD_LENGTH}
            value={currentPassword}
            disabled={disabled}
            autoComplete="current-password"
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </label>
        <label>
          New password
          <input
            aria-label="New password"
            type="password"
            minLength={MIN_ACCOUNT_PASSWORD_LENGTH}
            maxLength={MAX_ACCOUNT_PASSWORD_LENGTH}
            value={newPassword}
            disabled={disabled}
            autoComplete="new-password"
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </label>
        <label>
          Confirm new password
          <input
            aria-label="Confirm new password"
            type="password"
            minLength={MIN_ACCOUNT_PASSWORD_LENGTH}
            maxLength={MAX_ACCOUNT_PASSWORD_LENGTH}
            value={confirmPassword}
            disabled={disabled}
            autoComplete="new-password"
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </label>
        <button
          className="account-primary"
          type="submit"
          disabled={
            disabled ||
            currentPassword === '' ||
            newPassword === '' ||
            confirmPassword === ''
          }
        >
          Change password
        </button>
      </form>
    </div>
  );
}
