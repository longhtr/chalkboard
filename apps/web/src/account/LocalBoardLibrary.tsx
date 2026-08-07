/**
 * Device/cloud board chooser. Operations are serialized through one busy guard,
 * destructive actions require confirmation, and trash views remain explicit.
 */
import { truncateBoardTitle } from '@chalkboard/shared';
import { useRef, useState } from 'react';

import './LocalBoardLibrary.css';

import type { Board, TrashedCloudBoardSummary } from './api';
import { useModalFocus } from '../components/useModalFocus';
import type {
  LocalBoardSummary,
  TrashedLocalBoardSummary,
} from '../editor/local/localBoardRepository';

interface LocalBoardLibraryProps {
  boards: LocalBoardSummary[];
  cloudBoards: Board[];
  cloudBoardsState: 'idle' | 'loading' | 'ready' | 'signed-out' | 'unavailable';
  currentBoardId: string;
  currentCloudBoardId: string | null;
  onClose(): void;
  onCopyCloudToLocal(boardId: string): Promise<LocalBoardSummary>;
  onCopyLocalToCloud(boardId: string): Promise<Board>;
  onDeleteAllCloudPermanently(): Promise<void>;
  onDeleteAllPermanently(): Promise<void>;
  onDeleteCloudPermanently(boardId: string): Promise<void>;
  onDeletePermanently(boardId: string): Promise<void>;
  onDuplicate(boardId: string): Promise<void>;
  onOpen(boardId: string): void;
  onOpenCloud(board: Board): void;
  onRename(boardId: string, title: string): Promise<void>;
  onRestore(boardId: string): Promise<void>;
  onRestoreAll(): Promise<void>;
  onRestoreAllCloud(): Promise<void>;
  onRestoreCloud(boardId: string): Promise<void>;
  onSignIn(): void;
  onTrash(boardId: string): Promise<void>;
  onTrashCloud(boardId: string): Promise<void>;
  signedIn: boolean;
  trashedBoards: TrashedLocalBoardSummary[];
  trashedCloudBoards: TrashedCloudBoardSummary[];
}

type TrashView = 'cloud' | 'device' | null;

interface TrashPanelBoard {
  deletedAt: number | string;
  id: string;
  title: string;
}

interface TrashPanelProps {
  boards: TrashPanelBoard[];
  busy: boolean;
  kind: 'Cloud' | 'Device';
  onBack(): void;
  onDelete(boardId: string, title: string): void;
  onEmpty(): void;
  onRestore(boardId: string, title: string): void;
  onRestoreAll(): void;
}

function TrashPanel({
  boards,
  busy,
  kind,
  onBack,
  onDelete,
  onEmpty,
  onRestore,
  onRestoreAll,
}: TrashPanelProps) {
  return (
    <section
      className="local-board-library__trash-view"
      aria-labelledby="board-trash-title"
    >
      <header className="local-board-library__trash-view-header">
        <button type="button" onClick={onBack}>
          ← Back to boards
        </button>
        <div>
          <h3 id="board-trash-title">{kind} trash</h3>
        </div>
        <div className="local-board-library__trash-actions">
          <button
            type="button"
            disabled={busy || boards.length === 0}
            onClick={onRestoreAll}
          >
            Restore all
          </button>
          <button
            type="button"
            disabled={busy || boards.length === 0}
            onClick={onEmpty}
          >
            Empty trash
          </button>
        </div>
      </header>
      {boards.length === 0 ? (
        <p className="local-board-library__trash-empty">Trash is empty.</p>
      ) : (
        <ul className="local-board-library__list" aria-label={`${kind} trash`}>
          {boards.map((board) => (
            <li className="local-board-library__entry" key={board.id}>
              <div className="local-board-library__trashed-summary">
                <strong>{board.title}</strong>
                <small>
                  Deleted {new Date(board.deletedAt).toLocaleDateString()}
                </small>
              </div>
              <div className="local-board-library__actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRestore(board.id, board.title)}
                >
                  Restore
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDelete(board.id, board.title)}
                >
                  Delete permanently
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {kind === 'Device' && boards.length > 0 ? (
        <span className="local-board-library__trash-retention">
          Kept for 30 days
        </span>
      ) : null}
    </section>
  );
}

export function LocalBoardLibrary({
  boards,
  cloudBoards,
  cloudBoardsState,
  currentBoardId,
  currentCloudBoardId,
  onClose,
  onCopyCloudToLocal,
  onCopyLocalToCloud,
  onDeleteAllCloudPermanently,
  onDeleteAllPermanently,
  onDeleteCloudPermanently,
  onDeletePermanently,
  onDuplicate,
  onOpen,
  onOpenCloud,
  onRename,
  onRestore,
  onRestoreAll,
  onRestoreAllCloud,
  onRestoreCloud,
  onSignIn,
  onTrash,
  onTrashCloud,
  signedIn,
  trashedBoards,
  trashedCloudBoards,
}: LocalBoardLibraryProps) {
  const dialogRef = useModalFocus<HTMLDivElement>();
  const [trashView, setTrashView] = useState<TrashView>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const operationInFlightRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');

  const run = async (operation: () => Promise<void>, success = '') => {
    if (operationInFlightRef.current) return;
    operationInFlightRef.current = true;
    setBusy(true);
    setError('');
    setAnnouncement('');
    try {
      await operation();
      setAnnouncement(success);
    } catch {
      setError(
        'The board operation could not be completed. Your existing boards were not changed.',
      );
    } finally {
      operationInFlightRef.current = false;
      setBusy(false);
    }
  };

  const deviceTrashBoards: TrashPanelBoard[] = trashedBoards.map((board) => ({
    deletedAt: board.trashedAt,
    id: board.id,
    title: board.title,
  }));

  return (
    <div
      className="account-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="local-board-library"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-board-library-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (trashView === null) onClose();
            else setTrashView(null);
          }
        }}
      >
        <header className="local-board-library__header">
          <h2 id="local-board-library-title">Boards</h2>
          <button type="button" aria-label="Close boards" onClick={onClose}>
            ×
          </button>
        </header>

        {error !== '' ? (
          <p className="account-error" role="alert">
            {error}
          </p>
        ) : null}

        {trashView === 'device' ? (
          <TrashPanel
            boards={deviceTrashBoards}
            busy={busy}
            kind="Device"
            onBack={() => setTrashView(null)}
            onDelete={(boardId, title) =>
              void run(
                () => onDeletePermanently(boardId),
                `Permanently deleted ${title}.`,
              )
            }
            onEmpty={() => void run(onDeleteAllPermanently, 'Emptied trash.')}
            onRestore={(boardId, title) =>
              void run(() => onRestore(boardId), `Restored ${title}.`)
            }
            onRestoreAll={() =>
              void run(onRestoreAll, 'Restored all trashed boards.')
            }
          />
        ) : trashView === 'cloud' ? (
          <TrashPanel
            boards={trashedCloudBoards}
            busy={busy}
            kind="Cloud"
            onBack={() => setTrashView(null)}
            onDelete={(boardId, title) =>
              void run(
                () => onDeleteCloudPermanently(boardId),
                `Permanently deleted ${title}.`,
              )
            }
            onEmpty={() =>
              void run(onDeleteAllCloudPermanently, 'Emptied cloud trash.')
            }
            onRestore={(boardId, title) =>
              void run(() => onRestoreCloud(boardId), `Restored ${title}.`)
            }
            onRestoreAll={() =>
              void run(onRestoreAllCloud, 'Restored all cloud boards.')
            }
          />
        ) : (
          <>
            <section
              className="local-board-library__section local-board-library__section--device"
              aria-labelledby="local-board-list-title"
            >
              <header className="local-board-library__section-header">
                <h3 id="local-board-list-title">On this device</h3>
                <button type="button" onClick={() => setTrashView('device')}>
                  Device trash
                  {trashedBoards.length > 0 ? ` (${trashedBoards.length})` : ''}
                </button>
              </header>
              <ul
                className="local-board-library__list"
                aria-label="On this device"
              >
                {boards.map((board) => {
                  const isCurrent = board.id === currentBoardId;
                  const isEditing = editingId === board.id;
                  return (
                    <li
                      className={
                        isCurrent
                          ? 'local-board-library__entry is-current'
                          : 'local-board-library__entry'
                      }
                      key={board.id}
                    >
                      {isEditing ? (
                        <form
                          className="local-board-library__rename"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const title = editingTitle.trim();
                            if (title === '') return;
                            void run(async () => {
                              await onRename(board.id, title);
                              setEditingId(null);
                            });
                          }}
                        >
                          <input
                            aria-label={`Rename ${board.title}`}
                            value={editingTitle}
                            disabled={busy}
                            onChange={(event) =>
                              setEditingTitle(
                                truncateBoardTitle(event.currentTarget.value),
                              )
                            }
                          />
                          <button type="submit" disabled={busy}>
                            Save
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          <button
                            className="local-board-library__open"
                            type="button"
                            aria-label={`Open ${board.title}`}
                            data-dialog-autofocus={isCurrent || undefined}
                            data-local-board-id={board.id}
                            onClick={() => onOpen(board.id)}
                          >
                            <span className="local-board-library__summary">
                              <strong>{board.title}</strong>
                              <small>
                                Updated{' '}
                                {new Date(board.updatedAt).toLocaleDateString()}
                              </small>
                            </span>
                            {isCurrent ? (
                              <span className="local-board-library__current">
                                Open
                              </span>
                            ) : null}
                          </button>
                          <div className="local-board-library__actions">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setEditingId(board.id);
                                setEditingTitle(board.title);
                              }}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() => onDuplicate(board.id))
                              }
                            >
                              Duplicate
                            </button>
                            {signedIn ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await onCopyLocalToCloud(board.id);
                                  }, `Copied ${board.title} to cloud boards.`)
                                }
                              >
                                Copy to cloud
                              </button>
                            ) : null}
                            <button
                              type="button"
                              disabled={busy || boards.length <= 1}
                              onClick={() =>
                                void run(
                                  () => onTrash(board.id),
                                  `Moved ${board.title} to trash.`,
                                )
                              }
                            >
                              Trash
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            <section
              className="local-board-library__section local-board-library__section--cloud"
              aria-labelledby="cloud-board-list-title"
            >
              <header className="local-board-library__section-header">
                <h3 id="cloud-board-list-title">On the cloud</h3>
                {signedIn ? (
                  <button type="button" onClick={() => setTrashView('cloud')}>
                    Cloud trash
                    {trashedCloudBoards.length > 0
                      ? ` (${trashedCloudBoards.length})`
                      : ''}
                  </button>
                ) : null}
              </header>
              {cloudBoardsState === 'signed-out' ? (
                <div className="local-board-library__cloud-status">
                  <span>You are not signed in.</span>
                  <button type="button" onClick={onSignIn}>
                    Sign in
                  </button>
                </div>
              ) : cloudBoardsState === 'loading' ||
                cloudBoardsState === 'idle' ? (
                <p className="local-board-library__cloud-status" role="status">
                  Loading cloud boards…
                </p>
              ) : cloudBoardsState === 'unavailable' ? (
                <p className="local-board-library__cloud-status" role="alert">
                  Cloud storage is unavailable. Check your connection and try
                  again.
                </p>
              ) : cloudBoards.length === 0 ? (
                <p className="local-board-library__cloud-status">
                  No cloud boards yet.
                </p>
              ) : (
                <ul
                  className="local-board-library__list"
                  aria-label="On the cloud"
                >
                  {cloudBoards.map((board) => {
                    const isCurrent = board.id === currentCloudBoardId;
                    return (
                      <li
                        className={
                          isCurrent
                            ? 'local-board-library__entry is-current'
                            : 'local-board-library__entry'
                        }
                        key={board.id}
                      >
                        <button
                          className="local-board-library__open"
                          type="button"
                          aria-label={`Open cloud board ${board.title}`}
                          onClick={() => onOpenCloud(board)}
                        >
                          <span className="local-board-library__summary">
                            <strong>{board.title}</strong>
                            <small>
                              {board.role[0]?.toUpperCase()}
                              {board.role.slice(1)} · Updated{' '}
                              {new Date(board.updatedAt).toLocaleDateString()}
                            </small>
                          </span>
                          {isCurrent ? (
                            <span className="local-board-library__current">
                              Open
                            </span>
                          ) : null}
                        </button>
                        <div className="local-board-library__actions">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await onCopyCloudToLocal(board.id);
                              }, `Copied ${board.title} to local boards.`)
                            }
                          >
                            Copy to local
                          </button>
                          {board.role === 'owner' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  () => onTrashCloud(board.id),
                                  `Moved ${board.title} to cloud trash.`,
                                )
                              }
                            >
                              Trash
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}

        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>
    </div>
  );
}
