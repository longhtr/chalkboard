/**
 * Cloud-board sharing dialog opened exclusively from the board's Share control.
 * It owns the member projection while the server remains authoritative for
 * every invitation, role change, and removal.
 */
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { useModalFocus } from '../components/useModalFocus';
import {
  decodeMemberResponse,
  decodeShareResponse,
  decodeMembersResponse,
  decodePendingInvitationsResponse,
  isApiError,
  isUnavailableError,
  requestApi,
  type Board,
  type BoardMember,
  type BoardPendingInvitation,
} from './api';
import { MemberManager } from './MemberManager';

interface BoardAccessPanelProps {
  /**
   * Changes whenever this board's membership changed underneath the dialog,
   * so the lists are re-read instead of standing until it is reopened.
   */
  accessRevision?: number;
  board: Pick<Board, 'id' | 'role' | 'title'>;
  onClose(): void;
  onSessionExpired(): void;
}

function messageForError(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

/** Presents owner controls or explains the current member's effective role. */
export function BoardAccessPanel({
  accessRevision = 0,
  board,
  onClose,
  onSessionExpired,
}: BoardAccessPanelProps) {
  const panelRef = useModalFocus<HTMLElement>();
  const memberEmailRef = useRef<HTMLInputElement>(null);
  const [members, setMembers] = useState<BoardMember[]>([]);
  const [pending, setPending] = useState<BoardPendingInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [loading, setLoading] = useState(board.role === 'owner');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleError = useCallback(
    (caught: unknown, fallback: string) => {
      if (isApiError(caught) && caught.status === 401) {
        onSessionExpired();
        return;
      }
      setError(
        isUnavailableError(caught)
          ? 'Chalkboard cloud is unavailable. The board and its current access have not changed.'
          : messageForError(caught, fallback),
      );
    },
    [onSessionExpired],
  );

  const refreshPending = useCallback(async () => {
    const result = await requestApi(
      `/api/boards/${encodeURIComponent(board.id)}/invitations`,
      undefined,
      decodePendingInvitationsResponse,
    );
    setPending(result.invitations);
  }, [board.id]);

  useEffect(() => {
    if (board.role !== 'owner') return;
    let active = true;
    // Outstanding offers are loaded beside the members. Without them the owner
    // cannot tell an invitation nobody has answered from one that was declined,
    // and has no way to take it back.
    void requestApi(
      `/api/boards/${encodeURIComponent(board.id)}/invitations`,
      undefined,
      decodePendingInvitationsResponse,
    )
      .then((result) => {
        if (active) setPending(result.invitations);
      })
      .catch(() => {
        // The member list carries the panel's own failure reporting; a missing
        // pending list must not replace an otherwise working Share dialog.
      });
    void requestApi(
      `/api/boards/${encodeURIComponent(board.id)}/members`,
      undefined,
      decodeMembersResponse,
    )
      .then((result) => {
        if (!active) return;
        setMembers(result.members);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setLoading(false);
        handleError(caught, 'Unable to load sharing access');
      });
    return () => {
      active = false;
    };
  }, [accessRevision, board.id, board.role, handleError]);

  useEffect(() => {
    if (board.role !== 'owner' || loading) return;
    const focusTimer = window.setTimeout(() => memberEmailRef.current?.focus());
    return () => window.clearTimeout(focusTimer);
  }, [board.role, loading]);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setNotice('');
    // The owner is in the member list, so sharing with yourself can be named
    // for what it is rather than reported as an account that does not exist.
    const owner = members.find((member) => member.role === 'owner');
    if (
      owner !== undefined &&
      owner.email.toLocaleLowerCase('en-US') ===
        inviteEmail.trim().toLocaleLowerCase('en-US')
    ) {
      setError('You already own this board.');
      setSubmitting(false);
      return;
    }
    try {
      const result = await requestApi(
        `/api/boards/${encodeURIComponent(board.id)}/members`,
        {
          method: 'POST',
          body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
        },
        decodeShareResponse,
      );
      if (result.kind === 'member') {
        setMembers((current) => [
          ...current.filter((member) => member.userId !== result.member.userId),
          result.member,
        ]);
      } else {
        // An invitation grants nothing yet, so it must not appear among the
        // people who can already open the board.
        setNotice(
          `Invite sent to ${inviteEmail.trim()}. It appears under Board invites until they accept it.`,
        );
        await refreshPending().catch(() => undefined);
      }
      setInviteEmail('');
    } catch (caught) {
      if (isApiError(caught) && caught.status === 409) {
        // The invitee has switched offers off. Saying so at the moment of the
        // attempt is the point: otherwise the owner waits on an answer that
        // was never going to come.
        setError('That person does not accept new invites.');
      } else if (isApiError(caught) && caught.status === 404) {
        setError(
          'No Chalkboard account uses that email yet. Sharing currently works with existing accounts.',
        );
      } else {
        handleError(caught, 'Unable to add member');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function withdrawInvitation(invitation: BoardPendingInvitation) {
    setError('');
    setNotice('');
    try {
      await requestApi(
        `/api/boards/${encodeURIComponent(board.id)}/invitations/${encodeURIComponent(invitation.userId)}`,
        { method: 'DELETE' },
      );
      setPending((current) =>
        current.filter((entry) => entry.userId !== invitation.userId),
      );
    } catch (caught) {
      handleError(caught, 'Unable to withdraw invite');
    }
  }

  async function updateMember(member: BoardMember, role: 'editor' | 'viewer') {
    setError('');
    try {
      const result = await requestApi(
        `/api/boards/${encodeURIComponent(board.id)}/members/${encodeURIComponent(member.userId)}`,
        { method: 'PATCH', body: JSON.stringify({ role }) },
        decodeMemberResponse,
      );
      setMembers((current) =>
        current.map((entry) =>
          entry.userId === result.member.userId ? result.member : entry,
        ),
      );
    } catch (caught) {
      handleError(caught, 'Unable to update member');
    }
  }

  async function removeMember(member: BoardMember) {
    setError('');
    try {
      await requestApi(
        `/api/boards/${encodeURIComponent(board.id)}/members/${encodeURIComponent(member.userId)}`,
        { method: 'DELETE' },
      );
      setMembers((current) =>
        current.filter((entry) => entry.userId !== member.userId),
      );
    } catch (caught) {
      handleError(caught, 'Unable to remove member');
    }
  }

  return (
    <div
      className="account-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        className="account-panel board-access-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-access-title"
        aria-busy={loading || submitting}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <header className="account-header">
          <div>
            <h2 id="board-access-title">Board access</h2>
            <p className="account-panel-subject">{board.title}</p>
          </div>
          <button
            className="account-close"
            type="button"
            aria-label="Close sharing"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {error !== '' ? (
          <p className="account-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice !== '' ? (
          <p className="account-notice" role="status">
            {notice}
          </p>
        ) : null}
        {board.role !== 'owner' ? (
          <div className="board-access-summary">
            <strong>{board.title}</strong>
            <p>
              Your access is <strong>{board.role}</strong>. Only the board owner
              can invite people or change access.
            </p>
          </div>
        ) : loading ? (
          <p className="account-status" role="status">
            Loading board access…
          </p>
        ) : (
          <MemberManager
            board={board}
            inviteEmail={inviteEmail}
            inviteRole={inviteRole}
            memberEmailRef={memberEmailRef}
            members={members}
            onAdd={addMember}
            onChangeEmail={setInviteEmail}
            onChangeRole={setInviteRole}
            onError={handleError}
            onRemove={(member) => void removeMember(member)}
            onUpdate={(member, role) => void updateMember(member, role)}
            onWithdraw={(invitation) => void withdrawInvitation(invitation)}
            pending={pending}
            submitting={submitting}
          />
        )}
      </section>
    </div>
  );
}
