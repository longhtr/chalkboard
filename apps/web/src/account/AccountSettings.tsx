/**
 * Signed-in personal account forms. Username, email, and password mutations are
 * independent. Sensitive fields mount only after an explicit action; switching
 * or cancelling actions discards credentials without disabling password managers.
 */
import {
  MAX_ACCOUNT_DISPLAY_NAME_LENGTH,
  MAX_ACCOUNT_EMAIL_LENGTH,
  MAX_ACCOUNT_PASSWORD_LENGTH,
  MIN_ACCOUNT_PASSWORD_LENGTH,
} from '@chalkboard/shared';
import { type FormEvent, useLayoutEffect, useRef, useState } from 'react';

import {
  decodeUserResponse,
  decodeVerificationRequiredResponse,
  isApiError,
  isUnavailableError,
  requestApi,
  type User,
} from './api';
import { EmailChangeVerificationDialog } from './EmailChangeVerificationDialog';

interface AccountSettingsProps {
  available: boolean;
  onAccountDeleted(): void;
  onSessionExpired(): void;
  onUserUpdated(user: User): void;
  user: User;
}

type Setting = 'deletion' | 'email' | 'password' | 'username';

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
  onAccountDeleted,
  onSessionExpired,
  onUserUpdated,
  user,
}: AccountSettingsProps) {
  const [activeSetting, setActiveSetting] = useState<Setting | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [lastAction, setLastAction] = useState<Setting | null>(null);
  const [username, setUsername] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  const [emailPassword, setEmailPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState<Setting | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [messageOwner, setMessageOwner] = useState<Setting | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletionError, setDeletionError] = useState('');
  const [deletionConfirmationOpen, setDeletionConfirmationOpen] =
    useState(false);

  useLayoutEffect(() => {
    if (activeSetting === null) {
      settingsRef.current
        ?.querySelector<HTMLElement>(`[data-setting-action="${lastAction}"]`)
        ?.focus();
      return;
    }
    const selector = deletionConfirmationOpen
      ? '[aria-label="Confirm account deletion"] button'
      : `[data-sensitive-setting="${activeSetting}"] input`;
    settingsRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [activeSetting, deletionConfirmationOpen, lastAction]);

  function selectSetting(setting: Setting | null) {
    setEmailPassword('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setDeletePassword('');
    setDeletionConfirmationOpen(false);
    setDeletionError('');
    setError('');
    setStatus('');
    setPendingEmail(null);
    setEmail(user.email);
    setActiveSetting(setting);
  }

  function openAction(setting: Setting, label: string) {
    return (
      <button
        className={
          setting === 'deletion' ? 'account-danger' : 'account-primary'
        }
        type="button"
        disabled={disabled}
        data-setting-action={setting}
        onClick={() => {
          setLastAction(setting);
          selectSetting(setting);
        }}
      >
        {label}
      </button>
    );
  }

  function cancelAction() {
    return (
      <button
        className="account-deletion-cancel"
        type="button"
        disabled={disabled}
        onClick={() => {
          selectSetting(null);
        }}
      >
        Cancel
      </button>
    );
  }

  function begin(setting: Setting) {
    setBusy(setting);
    setMessageOwner(setting);
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

  function failDeletion(caught: unknown, fallback: string) {
    if (isApiError(caught) && caught.status === 401) {
      onSessionExpired();
      return;
    }
    setDeletionError(errorMessage(caught, fallback));
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
      setEmailPassword('');
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

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessageOwner('password');
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

  async function beginDeletionConfirmation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deletePassword === '') return;
    setDeletionError('');
    begin('deletion');
    try {
      await requestApi('/api/account/deletion/verify-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: deletePassword }),
      });
      setDeletionConfirmationOpen(true);
    } catch (caught) {
      failDeletion(caught, 'Unable to verify the current password');
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deletePassword === '') return;
    setDeletionError('');
    begin('deletion');
    try {
      await requestApi('/api/account', {
        method: 'DELETE',
        body: JSON.stringify({ currentPassword: deletePassword }),
      });
      onAccountDeleted();
    } catch (caught) {
      setDeletionConfirmationOpen(false);
      failDeletion(caught, 'Unable to delete account');
    } finally {
      setBusy(null);
    }
  }

  function settingMessage(setting: Setting) {
    if (messageOwner !== setting) return null;
    if (error !== '') {
      return (
        <p className="account-error" role="alert">
          {error}
        </p>
      );
    }
    return status === '' ? null : (
      <p className="account-notice" role="status">
        {status}
      </p>
    );
  }

  const disabled = !available || busy !== null;
  return (
    <div className="account-settings" ref={settingsRef}>
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
        {settingMessage('username')}
        <button
          className="account-primary"
          type="submit"
          disabled={disabled || username.trim() === user.displayName}
        >
          Save username
        </button>
      </form>

      <form
        className="account-setting-form"
        data-sensitive-setting="email"
        onSubmit={changeEmail}
      >
        <div>
          <h3>Email</h3>
          <p>Used to sign in and receive board access.</p>
        </div>
        {activeSetting !== 'email' ? (
          <>
            <p>{user.email}</p>
            {openAction('email', 'Change email')}
          </>
        ) : (
          <>
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
            {settingMessage('email')}
            <button
              className="account-primary"
              type="submit"
              disabled={
                disabled || email.trim() === user.email || emailPassword === ''
              }
            >
              Verify new email
            </button>
            {cancelAction()}
          </>
        )}
      </form>

      {pendingEmail === null ? null : (
        <EmailChangeVerificationDialog
          destination={pendingEmail}
          error={error}
          onCancel={() => {
            setPendingEmail(null);
            setError('');
          }}
          onVerify={verifyEmailChange}
          submitting={busy === 'email'}
        />
      )}

      <form
        className="account-setting-form"
        data-sensitive-setting="password"
        onSubmit={changePassword}
      >
        <div>
          <h3>Password</h3>
          <p>Changing it requires your current password.</p>
        </div>
        {activeSetting !== 'password' ? (
          openAction('password', 'Change password')
        ) : (
          <>
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
            {settingMessage('password')}
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
            {cancelAction()}
          </>
        )}
      </form>

      {deletionConfirmationOpen ? (
        <form
          aria-label="Confirm account deletion"
          className="account-setting-form account-danger-zone"
          onSubmit={deleteAccount}
        >
          <div>
            <h3>Delete account permanently?</h3>
            <p>
              This will permanently delete your account, cloud boards,
              memberships, and uploaded assets. This action cannot be undone.
            </p>
          </div>
          <div className="account-deletion-actions">
            <button
              className="account-deletion-cancel"
              type="button"
              disabled={disabled}
              onClick={() => {
                selectSetting(null);
              }}
            >
              Cancel
            </button>
            <button
              className="account-danger"
              type="submit"
              disabled={disabled}
            >
              {busy === 'deletion' ? 'Deleting…' : 'Delete account permanently'}
            </button>
          </div>
        </form>
      ) : (
        <form
          className="account-setting-form account-danger-zone"
          data-sensitive-setting="deletion"
          onSubmit={beginDeletionConfirmation}
        >
          <div>
            <h3>Delete account</h3>
            <p>
              Permanently deletes your account, cloud boards, memberships, and
              uploaded assets. This cannot be undone.
            </p>
          </div>
          {activeSetting !== 'deletion' ? (
            openAction('deletion', 'Delete account')
          ) : (
            <>
              <label>
                Current password
                <input
                  aria-label="Current password for account deletion"
                  type="password"
                  maxLength={MAX_ACCOUNT_PASSWORD_LENGTH}
                  value={deletePassword}
                  disabled={disabled}
                  autoComplete="current-password"
                  onChange={(event) => {
                    setDeletePassword(event.target.value);
                    if (deletionError !== '') setDeletionError('');
                  }}
                  required
                />
              </label>
              {deletionError !== '' ? (
                <p className="account-error" role="alert">
                  {deletionError}
                </p>
              ) : null}
              <button
                className="account-danger"
                type="submit"
                disabled={disabled || deletePassword === ''}
              >
                {busy === 'deletion'
                  ? 'Checking password…'
                  : 'Continue to account deletion'}
              </button>
              {cancelAction()}
            </>
          )}
        </form>
      )}
    </div>
  );
}
