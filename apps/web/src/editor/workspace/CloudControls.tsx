/** Translates cloud transport, durability, recovery, role, and title state into precise controls. */
import { useEffect, useState } from 'react';

import type {
  CloudCollaborator,
  CloudConnectionState,
  CloudDeviceRecoveryState,
} from '../../collaboration/useCloudBoard';
import type { CloudBoardTitleState } from '../../collaboration/useCloudBoardTitle';
import { Icon } from '../../components/Icon';

interface CloudControlsProps {
  cloudBoardActive: boolean;
  collaborators: CloudCollaborator[];
  connectionState: CloudConnectionState;
  deviceRecoveryState: CloudDeviceRecoveryState;
  /** On-screen editor text that board state does not contain yet. */
  draftPending?: boolean;
  /**
   * Changes identity on any board edit, whatever tool or block produced it.
   * Its value is never read — only the fact that it changed.
   */
  editActivity?: unknown;
  /** Server-side durability: local work exists that no acknowledgement covers. */
  hasPendingWork?: boolean;
  /**
   * Signed-in identity, or null when anonymous. Only the display name is taken,
   * so this stays usable wherever a narrower user projection is on hand.
   */
  currentUser?: { displayName: string } | null;
  onOpenAccount: (() => void) | undefined;
  onRetryConnection?: () => void;
  onRetryTitle?: () => void;
  onShare(): void;
  shareLabel: string;
  titleState?: CloudBoardTitleState;
}

/**
 * First character of a display name, uppercased, for the signed-in avatar.
 * Uses the code-point iterator so an emoji or astral character is not split
 * into half a surrogate pair.
 */
function accountInitial(displayName: string): string {
  return [...displayName.trim()][0]?.toLocaleUpperCase('en-US') ?? '?';
}

/** States that render as a plain informational pill rather than a connection badge. */
type SimpleConnectionState = Extract<
  CloudConnectionState,
  'local' | 'read-only'
>;

function connectionLabel(state: SimpleConnectionState): string {
  switch (state) {
    case 'read-only':
      return 'View only';
    case 'local':
      return 'Local';
  }
}

type ConnectionTone = 'connected' | 'disconnected' | 'reconnecting';

/** A dropped socket usually recovers within this window, so it is never announced. */
const RECONNECT_GRACE_MS = 2_000;

/**
 * Holds `connected` through a brief drop so routine blips never paint a
 * disconnection the user cannot act on.
 */
function useConnectionTone(state: CloudConnectionState): ConnectionTone {
  const recovering = state === 'reconnecting';
  const [graceElapsed, setGraceElapsed] = useState(false);

  if (!recovering && graceElapsed) setGraceElapsed(false);

  useEffect(() => {
    if (!recovering) return;
    const timer = window.setTimeout(
      () => setGraceElapsed(true),
      RECONNECT_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [recovering]);

  if (state === 'offline' || state === 'connection-failed') {
    return 'disconnected';
  }
  if (recovering) return graceElapsed ? 'reconnecting' : 'connected';
  return 'connected';
}

/**
 * Durability. Green is a promise, so it is made only when the user has actually
 * stopped and the board is settled; yellow covers everything in between. Red is
 * reserved for a board that cannot be written at all — retrying will not help
 * and the user has to act. A dropped connection is not that: it is transient,
 * and the connection light already reports it.
 */
type SyncTone = 'blocked' | 'synced' | 'syncing';

/** Silence this long is treated as the user having stopped for good. */
const EDIT_IDLE_MS = 250;

/**
 * Green requires a quiet period covering BOTH the user and the sync layer.
 * Watching only one of them is what made this flicker: saves complete far faster
 * than people type, and the sync layer keeps working briefly after the last
 * keystroke, so either signal alone blinks. Any edit or any outstanding work
 * restarts the window, which makes the badge steady regardless of how the
 * database traffic underneath happens to be paced.
 */
function useSettled({
  editActivity,
  outstanding,
}: {
  editActivity: unknown;
  outstanding: boolean;
}): boolean {
  // Records which activity the quiet window has already elapsed for. Keeping it
  // as a value rather than a flag makes "settled" derivable during render, so a
  // new edit withdraws the claim immediately without any render-phase update.
  const [settledFor, setSettledFor] = useState<unknown>(editActivity);

  useEffect(() => {
    if (outstanding) return;
    // Keyed on the activity itself, so every edit restarts the quiet window.
    const timer = window.setTimeout(
      () => setSettledFor(editActivity),
      EDIT_IDLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [editActivity, outstanding]);

  return !outstanding && Object.is(settledFor, editActivity);
}

function syncTone({
  connectionState,
  outstanding,
  reachable,
  settled,
}: {
  connectionState: CloudConnectionState;
  outstanding: boolean;
  reachable: boolean;
  settled: boolean;
}): SyncTone | null {
  // A viewer has nothing to save, and a local board has nowhere to save it.
  if (connectionState === 'read-only' || connectionState === 'local') {
    return null;
  }
  if (connectionState === 'incompatible') return 'blocked';
  // Changes made with no way to send them. Reconnecting returns this to yellow
  // and then, once acknowledged and quiet, to green.
  if (outstanding && !reachable) return 'blocked';
  return settled ? 'synced' : 'syncing';
}

function connectionWord(tone: ConnectionTone, connecting: boolean): string {
  if (connecting) return 'Connecting…';
  return tone === 'connected'
    ? 'Connected'
    : tone === 'reconnecting'
      ? 'Reconnecting…'
      : 'Disconnected';
}

function syncWord(tone: SyncTone): string {
  return tone === 'synced'
    ? 'Synced'
    : tone === 'syncing'
      ? 'Syncing'
      : "Can't sync";
}

/** The transport, as its own persistent badge. */
function ConnectionBadge({
  connecting,
  tone,
}: {
  connecting: boolean;
  tone: ConnectionTone;
}) {
  return (
    <span className={`cloud-status is-${tone}`} role="status">
      <span className={`cloud-status-dot is-${tone}`} aria-hidden="true" />
      {connectionWord(tone, connecting)}
    </span>
  );
}

/** Durability, as its own persistent badge. */
function SyncBadge({ tone }: { tone: SyncTone }) {
  return (
    <span className={`cloud-status is-${tone}`} role="status">
      <span className={`cloud-status-dot is-${tone}`} aria-hidden="true" />
      {syncWord(tone)}
    </span>
  );
}

export function CloudControls({
  cloudBoardActive,
  collaborators,
  connectionState,
  currentUser = null,
  deviceRecoveryState,
  draftPending = false,
  editActivity,
  hasPendingWork = false,
  onOpenAccount,
  onRetryConnection = () => undefined,
  onRetryTitle = () => undefined,
  onShare,
  shareLabel,
  titleState = 'current',
}: CloudControlsProps) {
  const tone = useConnectionTone(connectionState);
  const outstanding =
    draftPending ||
    hasPendingWork ||
    connectionState === 'syncing' ||
    connectionState === 'connecting';
  const settled = useSettled({ editActivity, outstanding });
  const sync = syncTone({
    connectionState,
    outstanding,
    reachable: tone === 'connected',
    settled,
  });
  // A viewer session and an unsupported document describe the session itself
  // rather than a live transport, so they replace the badge entirely.
  const sessionState =
    connectionState === 'local' || connectionState === 'read-only'
      ? connectionState
      : null;

  return (
    <div className="workspace-top-right">
      {cloudBoardActive && (
        <>
          {sessionState !== null ? (
            <span className={`cloud-status is-${sessionState}`} role="status">
              {connectionLabel(sessionState)}
            </span>
          ) : connectionState === 'connection-failed' ? (
            <button
              className="cloud-status cloud-retry"
              type="button"
              onClick={onRetryConnection}
            >
              Disconnected — Retry
            </button>
          ) : (
            <>
              <ConnectionBadge
                connecting={connectionState === 'connecting'}
                tone={tone}
              />
              {sync !== null && <SyncBadge tone={sync} />}
            </>
          )}
          {deviceRecoveryState !== 'available' && (
            <span
              className={`cloud-status cloud-recovery-status is-${deviceRecoveryState}`}
              role="status"
            >
              {deviceRecoveryState === 'checking'
                ? 'Checking device recovery…'
                : 'Device recovery unavailable'}
            </span>
          )}
          {titleState === 'saving' && (
            <span className="cloud-status" role="status">
              Updating board name…
            </span>
          )}
          {titleState === 'unavailable' && (
            <button
              className="cloud-status cloud-retry"
              type="button"
              onClick={onRetryTitle}
            >
              Board name update failed — Retry
            </button>
          )}
        </>
      )}
      {cloudBoardActive ? (
        <button className="share-button" type="button" onClick={onShare}>
          {shareLabel}
        </button>
      ) : null}
      {collaborators.slice(0, 3).map((collaborator) => (
        <span
          className="avatar collaborator-avatar"
          key={collaborator.clientId}
          title={`${collaborator.name} is here`}
          aria-label={`${collaborator.name} is collaborating`}
          style={{ background: collaborator.color }}
        >
          {collaborator.name.charAt(0).toUpperCase()}
        </span>
      ))}
      {collaborators.length > 3 && (
        <span className="collaborator-overflow">
          +{collaborators.length - 3}
        </span>
      )}
      <button
        className={currentUser === null ? 'avatar' : 'avatar is-signed-in'}
        type="button"
        // The action is the same in both states, so the accessible name stays
        // stable; identity is carried by the visible initial and the tooltip.
        aria-label="Open account"
        title={
          currentUser === null ? 'Account settings' : currentUser.displayName
        }
        onClick={onOpenAccount}
      >
        {/* Signed in, the avatar carries the account's initial, matching how
            collaborator avatars above identify people. Anonymous keeps the
            generic glyph, so the two states are distinguishable at a glance. */}
        {currentUser === null ? (
          <Icon name="account" />
        ) : (
          <span aria-hidden="true">
            {accountInitial(currentUser.displayName)}
          </span>
        )}
      </button>
    </div>
  );
}
