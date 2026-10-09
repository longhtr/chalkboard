/**
 * Pending offers of board access, and the two answers to them.
 *
 * Sharing a board by email used to write the membership outright, so a board
 * someone else owned appeared among your own without you agreeing to it. The
 * offer now waits here. Accepting is what writes the membership; declining
 * removes the offer and leaves nothing behind.
 *
 * One answer is in flight at a time. Accepting and declining are both single
 * decisions about the same row, so letting two run at once would race to
 * consume it and report one of them as a failure that had in fact happened.
 */
import { useEffect, useState } from 'react';

import './BoardInvites.css';

import {
  decodeBoardInvitationPreference,
  isApiError,
  requestApi,
  type BoardInvitation,
} from './api';
import { useModalFocus } from '../components/useModalFocus';

interface BoardInvitesProps {
  invitations: BoardInvitation[];
  onAccept(boardId: string): Promise<void>;
  onClose(): void;
  onReject(boardId: string): Promise<void>;
  onSessionExpired(): void;
  state: 'idle' | 'loading' | 'ready' | 'signed-out' | 'unavailable';
}

function roleDescription(role: BoardInvitation['role']): string {
  return role === 'editor' ? 'Can edit' : 'Can view';
}

/** Lists pending board invitations and records the invitee's answer. */
export function BoardInvites({
  invitations,
  onAccept,
  onClose,
  onReject,
  onSessionExpired,
  state,
}: BoardInvitesProps) {
  const dialogRef = useModalFocus<HTMLDivElement>();
  const [busyBoardId, setBusyBoardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acceptsInvites, setAcceptsInvites] = useState<boolean | null>(null);
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [preferenceStatus, setPreferenceStatus] = useState<string | null>(null);
  const signedIn = state !== 'signed-out';

  // This preference belongs to the invitation workflow, so it is read only
  // while this dialog is open. A failed preference read never hides invitations
  // that were loaded successfully.
  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    void requestApi(
      '/api/account/board-invitations',
      undefined,
      decodeBoardInvitationPreference,
    )
      .then((result) => {
        if (!active) return;
        setPreferenceError(null);
        setAcceptsInvites(result.acceptsBoardInvitations);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (isApiError(caught) && caught.status === 401) {
          onSessionExpired();
          return;
        }
        setPreferenceError('Invite preference is unavailable right now.');
      });
    return () => {
      active = false;
    };
  }, [onSessionExpired, signedIn]);

  const toggleInvites = async () => {
    if (acceptsInvites === null || preferenceBusy) return;
    const next = !acceptsInvites;
    setPreferenceBusy(true);
    setPreferenceError(null);
    setPreferenceStatus(null);
    try {
      const result = await requestApi(
        '/api/account/board-invitations',
        {
          body: JSON.stringify({ acceptsBoardInvitations: next }),
          method: 'PATCH',
        },
        decodeBoardInvitationPreference,
      );
      setAcceptsInvites(result.acceptsBoardInvitations);
      setPreferenceStatus(
        result.acceptsBoardInvitations
          ? 'New board invites are allowed.'
          : 'New board invites are blocked.',
      );
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) onSessionExpired();
      else setPreferenceError('Unable to change the invite preference.');
    } finally {
      setPreferenceBusy(false);
    }
  };

  const answer = async (
    boardId: string,
    respond: (boardId: string) => Promise<void>,
  ) => {
    if (busyBoardId !== null) return;
    setBusyBoardId(boardId);
    setError(null);
    try {
      await respond(boardId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'That invitation could not be answered.',
      );
    } finally {
      setBusyBoardId(null);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        aria-labelledby="board-invites-title"
        aria-modal="true"
        className="board-invites"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
        ref={dialogRef}
        role="dialog"
      >
        <header className="board-invites__header">
          <h2 id="board-invites-title">Board invites</h2>
          <button
            aria-label="Close board invites"
            className="board-invites__close"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <p className="board-invites__intro">
          A board shared with you stays here until you accept it. Accepting adds
          it to your boards; declining removes the invite.
        </p>
        {signedIn ? (
          <section
            aria-labelledby="board-invites-preference-title"
            className="board-invites__preference"
          >
            <div>
              <h3 id="board-invites-preference-title">
                Do not accept new invites
              </h3>
              <p>
                When this is on, nobody can offer you their boards. Boards you
                have already joined are unaffected.
              </p>
            </div>
            <button
              aria-checked={acceptsInvites === null ? false : !acceptsInvites}
              aria-label="Do not accept new invites"
              className="board-invites__switch"
              disabled={acceptsInvites === null || preferenceBusy}
              onClick={() => void toggleInvites()}
              role="switch"
              type="button"
            >
              <span aria-hidden="true" />
            </button>
            {preferenceError === null ? null : (
              <p className="board-invites__preference-message" role="alert">
                {preferenceError}
              </p>
            )}
            {preferenceStatus === null ? null : (
              <p className="board-invites__preference-message" role="status">
                {preferenceStatus}
              </p>
            )}
          </section>
        ) : null}
        {error === null ? null : (
          <p className="board-invites__error" role="alert">
            {error}
          </p>
        )}
        {state === 'signed-out' ? (
          <p className="board-invites__empty">
            Sign in to see boards shared with you.
          </p>
        ) : state === 'loading' ? (
          <p className="board-invites__empty" role="status">
            Loading invites…
          </p>
        ) : state === 'unavailable' ? (
          <p className="board-invites__empty" role="status">
            Invites are unavailable right now.
          </p>
        ) : invitations.length === 0 ? (
          <p className="board-invites__empty">No pending invites.</p>
        ) : (
          <ul
            aria-label="Pending board invites"
            className="board-invites__list"
          >
            {invitations.map((invitation) => (
              <li className="board-invites__entry" key={invitation.boardId}>
                <div className="board-invites__summary">
                  <strong>{invitation.title}</strong>
                  <span>
                    {invitation.invitedByDisplayName} ·{' '}
                    {roleDescription(invitation.role)}
                  </span>
                </div>
                <div className="board-invites__actions">
                  <button
                    className="board-invites__accept"
                    disabled={busyBoardId !== null}
                    onClick={() => void answer(invitation.boardId, onAccept)}
                    type="button"
                  >
                    Accept
                  </button>
                  <button
                    className="board-invites__reject"
                    disabled={busyBoardId !== null}
                    onClick={() => void answer(invitation.boardId, onReject)}
                    type="button"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
