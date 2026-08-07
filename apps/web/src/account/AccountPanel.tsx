/**
 * Account dialog. Authentication and personal account actions belong here;
 * board selection belongs to the board library and sharing belongs to the
 * board-level Share control.
 */
import { useState } from 'react';

import { useModalFocus } from '../components/useModalFocus';
import { isApiError, isUnavailableError, requestApi } from './api';
import { AccountForm } from './AccountForm';
import { AccountSettings } from './AccountSettings';
import type { SessionState, User } from './useSession';

interface AccountPanelProps {
  invitationMessage?: string;
  onAuthenticated(user: User): void;
  onClose(): void;
  onRefreshSession(): Promise<void>;
  onSessionExpired(): void;
  onSignOut(): void;
  session: SessionState;
}

function messageForError(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

/** Switches between authentication and the signed-in account summary. */
export function AccountPanel({
  invitationMessage,
  onAuthenticated,
  onClose,
  onRefreshSession,
  onSessionExpired,
  onSignOut,
  session,
}: AccountPanelProps) {
  const panelRef = useModalFocus<HTMLElement>();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function logout() {
    setSubmitting(true);
    setError('');
    try {
      await requestApi('/api/auth/logout', { method: 'POST' });
      onSignOut();
    } catch (caught) {
      setError(
        isUnavailableError(caught)
          ? 'Reconnect before signing out so this session can be closed safely.'
          : messageForError(caught, 'Unable to sign out'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const user = session.user;
  const accountKnown = user !== null;
  const cloudAvailable = session.status === 'authenticated';

  return (
    <div className="account-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={panelRef}
        className={
          accountKnown
            ? 'account-panel account-panel--settings'
            : 'account-panel account-panel--auth'
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-panel-title"
        aria-busy={session.status === 'loading' || submitting}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="account-header">
          <div>
            <h2 id="account-panel-title">
              {accountKnown
                ? 'Account'
                : mode === 'login'
                  ? 'Sign in'
                  : 'Create account'}
            </h2>
          </div>
          <button
            className="account-close"
            type="button"
            aria-label="Close account panel"
            data-dialog-autofocus={accountKnown ? '' : undefined}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {invitationMessage !== undefined ? (
          <p className="account-notice" role="status">
            {invitationMessage}
          </p>
        ) : null}

        {session.status === 'loading' ? (
          <p className="account-status" role="status">
            Checking your session… Your local board is ready.
          </p>
        ) : !accountKnown ? (
          <AccountForm
            mode={mode}
            offline={session.status === 'offline-unknown'}
            onAuthenticated={onAuthenticated}
            onModeChange={setMode}
            onRefreshSession={onRefreshSession}
          />
        ) : (
          <div className="account-settings-shell">
            {session.status === 'offline-unknown' ? (
              <div className="account-status" role="status">
                <strong>Account services are unavailable.</strong>
                <span>Your local and cached work remain available.</span>
                <button type="button" onClick={() => void onRefreshSession()}>
                  Reconnect
                </button>
              </div>
            ) : null}
            {error !== '' ? (
              <p className="account-error" role="alert">
                {error}
              </p>
            ) : null}
            <AccountSettings
              available={cloudAvailable}
              onSessionExpired={onSessionExpired}
              onUserUpdated={onAuthenticated}
              user={user}
            />
            <button
              className="account-sign-out"
              type="button"
              disabled={submitting || !cloudAvailable}
              onClick={() => void logout()}
            >
              Sign out
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
