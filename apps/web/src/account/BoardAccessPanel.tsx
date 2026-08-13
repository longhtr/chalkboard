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
  decodeMembersResponse,
  isApiError,
  isUnavailableError,
  requestApi,
  type Board,
  type BoardMember,
} from './api';
import { MemberManager } from './MemberManager';

interface BoardAccessPanelProps {
  board: Pick<Board, 'id' | 'role' | 'title'>;
  onClose(): void;
  onSessionExpired(): void;
}

function messageForError(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

/** Presents owner controls or explains the current member's effective role. */
export function BoardAccessPanel({
  board,
  onClose,
  onSessionExpired,
}: BoardAccessPanelProps) {
  const panelRef = useModalFocus<HTMLElement>();
  const memberEmailRef = useRef<HTMLInputElement>(null);
  const [members, setMembers] = useState<BoardMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [loading, setLoading] = useState(board.role === 'owner');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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

  useEffect(() => {
    if (board.role !== 'owner') return;
    let active = true;
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
  }, [board.id, board.role, handleError]);

  useEffect(() => {
    if (board.role !== 'owner' || loading) return;
    const focusTimer = window.setTimeout(() => memberEmailRef.current?.focus());
    return () => window.clearTimeout(focusTimer);
  }, [board.role, loading]);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const result = await requestApi(
        `/api/boards/${encodeURIComponent(board.id)}/members`,
        {
          method: 'POST',
          body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
        },
        decodeMemberResponse,
      );
      setMembers((current) => [
        ...current.filter((member) => member.userId !== result.member.userId),
        result.member,
      ]);
      setInviteEmail('');
    } catch (caught) {
      if (isApiError(caught) && caught.status === 404) {
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
            submitting={submitting}
          />
        )}
      </section>
    </div>
  );
}
