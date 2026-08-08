/**
 * Owns one fragment-delivered invitation from initial session gating through
 * authenticated redemption, URL cleanup, error guidance, and accepted board.
 */
import { useEffect, useRef, useState } from 'react';

import { decodeBoardResponse, isApiError, requestApi, type Board } from './api';
import type { SessionState } from './useSession';

interface BoardInvitationOptions {
  initialToken: string | null;
  onAccepted(board: Board): void;
  onSessionExpired(): void;
  sessionStatus: SessionState['status'];
}

/** Redeems one fragment-delivered board invitation after authentication. */
export function useBoardInvitation({
  initialToken,
  onAccepted,
  onSessionExpired,
  sessionStatus,
}: BoardInvitationOptions): string | undefined {
  const [token, setToken] = useState(initialToken);
  const [error, setError] = useState<string>();
  const redemptionRef = useRef<Promise<{ board: Board }> | null>(null);
  const onAcceptedRef = useRef(onAccepted);
  const onSessionExpiredRef = useRef(onSessionExpired);

  useEffect(() => {
    onAcceptedRef.current = onAccepted;
    onSessionExpiredRef.current = onSessionExpired;
  }, [onAccepted, onSessionExpired]);

  useEffect(() => {
    if (token === null || sessionStatus !== 'authenticated') return;
    const redemption =
      redemptionRef.current ??
      requestApi(
        '/api/board-invites/redeem',
        {
          method: 'POST',
          body: JSON.stringify({ token }),
        },
        decodeBoardResponse,
      );
    redemptionRef.current = redemption;
    let active = true;

    void redemption
      .then(({ board }) => {
        if (!active) return;
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}`,
        );
        setToken(null);
        setError(undefined);
        onAcceptedRef.current(board);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        redemptionRef.current = null;
        if (isApiError(caught) && caught.status === 401) {
          onSessionExpiredRef.current();
          setError('Sign in to accept this board invitation.');
        } else if (isApiError(caught) && caught.status === 404) {
          window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${window.location.search}`,
          );
          setToken(null);
          setError('This invitation link is invalid, expired, or revoked.');
        } else {
          setError(
            'The invitation could not be accepted. Check your connection and try again.',
          );
        }
      });

    return () => {
      active = false;
    };
  }, [sessionStatus, token]);

  if (error !== undefined) return error;
  if (token === null) return undefined;
  if (sessionStatus === 'authenticated') {
    return 'Accepting board invitation…';
  }
  if (sessionStatus === 'offline-unknown') {
    return 'Reconnect to Chalkboard cloud to accept this board invitation.';
  }
  return 'Sign in or create an account to accept this board invitation.';
}
