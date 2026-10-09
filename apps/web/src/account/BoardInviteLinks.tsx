/**
 * Owner-only invitation-link controls. Tokens are shown only when created;
 * subsequent list responses contain metadata needed for expiry and revocation.
 */
import { useEffect, useRef, useState } from 'react';

import { copyTextToClipboard } from '../clipboard';
import {
  decodeInviteLinkResponse,
  decodeInviteLinksResponse,
  requestApi,
  type BoardInviteLink,
} from './api';

export function BoardInviteLinks({
  boardId,
  onError,
}: {
  boardId: string;
  onError(error: unknown, fallback: string): void;
}) {
  const onErrorRef = useRef(onError);
  const [links, setLinks] = useState<BoardInviteLink[]>([]);
  const [copiedRole, setCopiedRole] = useState<'editor' | 'viewer' | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const copiedResetRef = useRef<number | null>(null);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(
    () => () => {
      if (copiedResetRef.current !== null) {
        window.clearTimeout(copiedResetRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void requestApi(
      `/api/boards/${encodeURIComponent(boardId)}/invite-links`,
      undefined,
      decodeInviteLinksResponse,
    )
      .then((result) => {
        if (active) setLinks(result.links);
      })
      .catch((error: unknown) => {
        if (active)
          onErrorRef.current(error, 'Unable to load invitation links');
      });
    return () => {
      active = false;
    };
  }, [boardId]);

  async function copyLink(role: 'editor' | 'viewer') {
    setSubmitting(true);
    try {
      const result = await requestApi(
        `/api/boards/${encodeURIComponent(boardId)}/invite-links`,
        {
          method: 'POST',
          body: JSON.stringify({ role }),
        },
        decodeInviteLinkResponse,
      );
      const url = new URL('/', window.location.origin);
      url.hash = new URLSearchParams({ invite: result.token }).toString();
      await copyTextToClipboard(url.toString());
      setLinks((current) => [
        ...current.filter((link) => link.role !== role),
        result.link,
      ]);
      setCopiedRole(role);
      if (copiedResetRef.current !== null) {
        window.clearTimeout(copiedResetRef.current);
      }
      copiedResetRef.current = window.setTimeout(
        () => setCopiedRole((current) => (current === role ? null : current)),
        1_500,
      );
    } catch (error) {
      onError(error, 'Unable to create invitation link');
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeLink(link: BoardInviteLink) {
    try {
      await requestApi(
        `/api/boards/${encodeURIComponent(boardId)}/invite-links/${encodeURIComponent(link.id)}`,
        { method: 'DELETE' },
      );
      setLinks((current) =>
        current.filter((candidate) => candidate.id !== link.id),
      );
    } catch (error) {
      onError(error, 'Unable to revoke invitation link');
    }
  }

  return (
    <div className="invite-link-manager">
      <p className="member-role-help">
        Invitation links require a Chalkboard account and expire after 30 days.
        Creating a replacement revokes the prior unredeemed link for that role.
      </p>
      {(['viewer', 'editor'] as const).map((role) => {
        const activeLink = links.find((link) => link.role === role);
        const label = role === 'viewer' ? 'read-only' : 'read-and-edit';
        return (
          <div className="invite-link-row" key={role}>
            <span>
              <strong>{label}</strong>
              <small>
                {activeLink === undefined
                  ? 'No active link'
                  : `Active until ${new Date(activeLink.expiresAt).toLocaleDateString()}`}
              </small>
            </span>
            <button
              type="button"
              // The visible label shortens to "Copy link" because the row
              // already names the role, so the accessible name carries the
              // role — and the copied confirmation, which is otherwise
              // visible-only and never reaches assistive technology.
              aria-label={
                copiedRole === role
                  ? `Copied ${label} link`
                  : `Copy ${label} link`
              }
              disabled={submitting}
              onClick={() => void copyLink(role)}
            >
              {copiedRole === role ? 'Copied' : 'Copy link'}
            </button>
            {activeLink !== undefined && (
              <button
                className="invite-link-revoke"
                type="button"
                aria-label={`Revoke ${label} link`}
                onClick={() => void revokeLink(activeLink)}
              >
                Revoke
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
