/** Explains unresolved direct cloud routes without unmounting or discarding the visible local workspace. */
import type { RouteStatus } from './appNavigation';
import { StatusNotice, type StatusNoticeAction } from '../StatusNotice';

interface BoardRouteNoticeProps {
  onDismiss(): void;
  onOpenAccount(): void;
  onRetry(): void;
  status: Exclude<RouteStatus, 'idle'>;
}

/** Explains a provisional or rejected cloud route without hiding local work. */
export function BoardRouteNotice({
  onDismiss,
  onOpenAccount,
  onRetry,
  status,
}: BoardRouteNoticeProps) {
  if (status === 'resolving') {
    return <StatusNotice busy body="Opening this cloud board…" />;
  }
  if (status === 'sign-in-required') {
    // Leaving is as necessary here as signing in. Someone who opens a shared
    // cloud link while signed out, and does not intend to sign in, otherwise
    // has no way back to their own board: the route stays on the cloud board
    // and this is the only notice with no way to leave it. The other statuses
    // carry the same action under the label "Dismiss"; named for where it goes
    // rather than what it closes, because here it is the way out.
    return (
      <StatusNotice
        actions={[
          { label: 'Sign in', onClick: onOpenAccount },
          { label: 'Use local board', onClick: onDismiss },
        ]}
        body="Sign in to open this cloud board"
      />
    );
  }
  const dismiss: StatusNoticeAction = { label: 'Dismiss', onClick: onDismiss };
  if (status === 'inaccessible') {
    return (
      <StatusNotice
        actions={[dismiss]}
        body="This cloud board is unavailable. It may have been deleted, or your access may have changed."
        tone="warning"
      />
    );
  }
  return (
    <StatusNotice
      actions={[{ label: 'Try again', onClick: onRetry }, dismiss]}
      body="Cloud access is unavailable. Chalkboard could not reach the server."
      tone="warning"
    />
  );
}
