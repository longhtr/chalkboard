/**
 * Owns one fragment-delivered invitation from initial session gating through
 * authenticated redemption, URL cleanup, error guidance, and accepted board.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { decodeBoardResponse, isApiError, requestApi, type Board } from './api';
import type { SessionState } from './useSession';

interface BoardInvitationOptions {
  initialToken: string | null;
  onAccepted(board: Board): void;
  onSessionExpired(): void;
  sessionStatus: SessionState['status'];
  /** Partition of the signed-in reader, which decides the refusal wording. */
  viewerIsDemo: boolean;
}

/**
 * Guidance and failure are separate channels because they want opposite
 * lifecycles: guidance must persist until the invitation resolves, while a
 * terminal failure must be dismissible and must not outlive the session that
 * produced it.
 */
export interface BoardInvitationState {
  /** Terminal failure. Dismissible, and cleared whenever the session changes. */
  error?: string;
  /** Pending guidance that persists until redemption succeeds or fails. */
  guidance?: string;
  dismissError(): void;
}

/** A failure that ends redemption, versus one that still awaits the reader. */
interface InvitationFailure {
  kind: 'guidance' | 'terminal';
  message: string;
}

/** Redeems one fragment-delivered board invitation after authentication. */
export function useBoardInvitation({
  initialToken,
  onAccepted,
  onSessionExpired,
  sessionStatus,
  viewerIsDemo,
}: BoardInvitationOptions): BoardInvitationState {
  const [token, setToken] = useState(initialToken);
  const [failure, setFailure] = useState<InvitationFailure>();
  const redemptionRef = useRef<Promise<{ board: Board }> | null>(null);
  const onAcceptedRef = useRef(onAccepted);
  const onSessionExpiredRef = useRef(onSessionExpired);
  // A terminal failure belongs to the session that produced it, so any change
  // of session retires it. Done here rather than by comparing a stored status,
  // because statuses repeat: signing out and back in returns to
  // `authenticated`, which resurrected a failure the sign-out had retired.
  // Guidance survives, because it is waiting for exactly this transition.
  const [lastSessionStatus, setLastSessionStatus] = useState(sessionStatus);
  if (lastSessionStatus !== sessionStatus) {
    setLastSessionStatus(sessionStatus);
    setFailure((current) =>
      current?.kind === 'terminal' ? undefined : current,
    );
  }

  useEffect(() => {
    onAcceptedRef.current = onAccepted;
    onSessionExpiredRef.current = onSessionExpired;
  }, [onAccepted, onSessionExpired]);

  const dismissError = useCallback(() => {
    setFailure((current) =>
      current?.kind === 'terminal' ? undefined : current,
    );
  }, []);

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
        setFailure(undefined);
        onAcceptedRef.current(board);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        redemptionRef.current = null;
        if (isApiError(caught) && caught.status === 401) {
          // The token is deliberately retained so redemption retries once the
          // reader signs in. That makes this guidance, not a terminal failure.
          onSessionExpiredRef.current();
          setFailure({
            kind: 'guidance',
            message: 'Sign in to accept this board invitation.',
          });
        } else if (isApiError(caught) && caught.status === 403) {
          // The link is valid; this account simply may not use it. Keeping the
          // token would retry forever, so drop it as with any terminal case.
          window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${window.location.search}`,
          );
          setToken(null);
          setFailure({
            kind: 'terminal',
            // Worded here rather than taken from the response, because the API
            // error message carries a support reference this case should not.
            message: viewerIsDemo
              ? 'Sharing only works between the same account type. Since this board is owned by a regular account, it can only be shared with another regular account. Your account is a demo account.'
              : 'Sharing only works between the same account type. Since this board is owned by a demo account, it can only be shared with another demo account. Your account is a regular account.',
          });
        } else if (isApiError(caught) && caught.status === 404) {
          window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${window.location.search}`,
          );
          setToken(null);
          setFailure({
            kind: 'terminal',
            message: 'This invitation link is invalid, expired, or revoked.',
          });
        } else {
          setFailure({
            kind: 'terminal',
            message:
              'The invitation could not be accepted. Check your connection and try again.',
          });
        }
      });

    return () => {
      active = false;
    };
  }, [sessionStatus, token, viewerIsDemo]);

  const error = failure?.kind === 'terminal' ? failure.message : undefined;
  const guidance =
    failure?.kind === 'guidance'
      ? failure.message
      : token === null
        ? undefined
        : sessionStatus === 'authenticated'
          ? 'Accepting board invitation…'
          : sessionStatus === 'offline-unknown'
            ? 'Reconnect to Chalkboard cloud to accept this board invitation.'
            : 'Sign in or create an account to accept this board invitation.';

  return {
    dismissError,
    ...(error === undefined ? {} : { error }),
    ...(guidance === undefined ? {} : { guidance }),
  };
}
