/** Owner-only member list and invitation form; server responses remain the authoritative projection. */
import { MAX_ACCOUNT_EMAIL_LENGTH } from '@chalkboard/shared';
import type { FormEvent, RefObject } from 'react';

import type { Board, BoardMember, BoardPendingInvitation } from './api';
import { BoardInviteLinks } from './BoardInviteLinks';

interface MemberManagerProps {
  board: Pick<Board, 'id' | 'role' | 'title'>;
  inviteEmail: string;
  inviteRole: 'editor' | 'viewer';
  memberEmailRef: RefObject<HTMLInputElement | null>;
  members: BoardMember[];
  onAdd(event: FormEvent<HTMLFormElement>): void;
  onChangeEmail(email: string): void;
  onChangeRole(role: 'editor' | 'viewer'): void;
  onError(error: unknown, fallback: string): void;
  onRemove(member: BoardMember): void;
  onUpdate(member: BoardMember, role: 'editor' | 'viewer'): void;
  onWithdraw(invitation: BoardPendingInvitation): void;
  /** Offers nobody has answered yet; none of these can open the board. */
  pending: BoardPendingInvitation[];
  submitting: boolean;
}

/**
 * Renders owner-only sharing controls. It presents server results but grants no
 * authority itself; every invitation and membership change is rechecked by the
 * API route that receives it.
 */
export function MemberManager({
  board,
  inviteEmail,
  inviteRole,
  memberEmailRef,
  members,
  onAdd,
  onChangeEmail,
  onChangeRole,
  onError,
  onRemove,
  onUpdate,
  onWithdraw,
  pending,
  submitting,
}: MemberManagerProps) {
  return (
    <section className="member-manager" aria-label={`Manage ${board.title}`}>
      <BoardInviteLinks boardId={board.id} onError={onError} />
      <form className="member-invite" onSubmit={onAdd}>
        <input
          ref={memberEmailRef}
          type="email"
          maxLength={MAX_ACCOUNT_EMAIL_LENGTH}
          aria-label="Member email"
          placeholder="teammate@example.com"
          value={inviteEmail}
          onChange={(event) => onChangeEmail(event.target.value)}
          required
        />
        <select
          aria-label="New member role"
          value={inviteRole}
          onChange={(event) =>
            onChangeRole(event.target.value as 'editor' | 'viewer')
          }
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <button className="account-primary" type="submit" disabled={submitting}>
          Add
        </button>
      </form>
      <p className="member-role-help">
        Editors can change the board. Viewers can inspect and navigate without
        changing it. The person must already have a Chalkboard account.
      </p>
      <div className="member-list">
        {members.map((member) => (
          <div className="member-row" key={member.userId}>
            <span className="member-avatar">
              {member.displayName.charAt(0).toUpperCase()}
            </span>
            <span className="member-details">
              <strong>{member.displayName}</strong>
              <small>{member.email}</small>
            </span>
            {member.role === 'owner' ? (
              <span className="member-role-label">Owner</span>
            ) : (
              <>
                <select
                  aria-label={`Role for ${member.displayName}`}
                  value={member.role}
                  onChange={(event) =>
                    onUpdate(member, event.target.value as 'editor' | 'viewer')
                  }
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  className="member-remove"
                  type="button"
                  aria-label={`Remove ${member.displayName}`}
                  onClick={() => onRemove(member)}
                >
                  ×
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {pending.length === 0 ? null : (
        <div className="member-pending">
          {/* Separated from the members because these people cannot open the
              board yet. Listing them together would say they already can. */}
          <h4>Awaiting a reply</h4>
          <div className="member-list">
            {pending.map((invitation) => (
              <div className="member-row" key={invitation.userId}>
                <span className="member-avatar">
                  {invitation.displayName.charAt(0).toUpperCase()}
                </span>
                <span className="member-details">
                  <strong>{invitation.displayName}</strong>
                  <small>{invitation.email}</small>
                </span>
                <span className="member-role-label">
                  {invitation.role === 'editor' ? 'Editor' : 'Viewer'} · invited
                </span>
                <button
                  aria-label={`Withdraw invite for ${invitation.displayName}`}
                  className="member-remove"
                  onClick={() => onWithdraw(invitation)}
                  type="button"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
