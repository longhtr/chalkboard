/** Explains unresolved direct cloud routes without unmounting or discarding the visible local workspace. */
import type { RouteStatus } from './appNavigation';

interface BoardRouteNoticeProps {
  cachedBoardVisible: boolean;
  onOpenAccount(): void;
  onRetry(): void;
  onUseLocalBoard(): void;
  status: Exclude<RouteStatus, 'idle'>;
}

/** Explains a provisional or rejected cloud route without hiding local work. */
export function BoardRouteNotice({
  cachedBoardVisible,
  onOpenAccount,
  onRetry,
  onUseLocalBoard,
  status,
}: BoardRouteNoticeProps) {
  return (
    <aside
      className="board-route-notice"
      aria-busy={status === 'resolving'}
      role="status"
    >
      {status === 'resolving' ? (
        <>
          <strong>Opening cloud board…</strong>
          <span>
            {cachedBoardVisible
              ? 'Showing the copy kept on this device while access is checked.'
              : 'Your local board remains available while access is checked.'}
          </span>
        </>
      ) : status === 'sign-in-required' ? (
        <>
          <strong>Sign in to open this cloud board</strong>
          <span>Your local board and cached work have not been removed.</span>
          <div>
            <button type="button" onClick={onOpenAccount}>
              Sign in
            </button>
            <button type="button" onClick={onUseLocalBoard}>
              Use local board
            </button>
          </div>
        </>
      ) : status === 'inaccessible' ? (
        <>
          <strong>This cloud board is unavailable</strong>
          <span>
            It may have been deleted, or your access may have changed.
            {cachedBoardVisible
              ? ' The cached copy on this device was not removed.'
              : ' Your local board was not changed.'}
          </span>
          <div>
            <button type="button" onClick={onOpenAccount}>
              Open boards
            </button>
            <button type="button" onClick={onUseLocalBoard}>
              Use local board
            </button>
          </div>
        </>
      ) : (
        <>
          <strong>Cloud access is unavailable</strong>
          <span>
            {cachedBoardVisible
              ? 'The cached copy remains available and has not been removed.'
              : 'Your local board remains available.'}
          </span>
          <div>
            <button type="button" onClick={onRetry}>
              Try again
            </button>
            <button type="button" onClick={onUseLocalBoard}>
              Use local board
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
