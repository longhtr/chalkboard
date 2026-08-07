/**
 * Browser application composition root. It resolves route intent against local
 * storage or server authorization, owns board-library dialogs and session
 * state, and delegates all board-content editing to `Workspace`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  decodeBoardResponse,
  decodeBoardsResponse,
  decodeTrashedBoardsResponse,
  isApiError,
  requestApi,
  type Board,
  type TrashedCloudBoardSummary,
} from './account/api';
import {
  cloudSelection,
  initialNavigation,
  loadLastCloudBoard,
  loadLastLocalBoardId,
  readBoardInviteToken,
  rememberCloudBoard,
  rememberLocalBoard,
  type NavigationState,
} from './account/appNavigation';
import {
  boardPath,
  localBoardPath,
  readBoardRoute,
} from './account/boardRouting';
import { AccountPanel } from './account/AccountPanel';
import { BoardAccessPanel } from './account/BoardAccessPanel';
import { BoardRouteNotice } from './account/BoardRouteNotice';
import { LocalBoardLibrary } from './account/LocalBoardLibrary';
import { useBoardInvitation } from './account/useBoardInvitation';
import { useSession } from './account/useSession';
import { Workspace } from './editor/Workspace';
import { LEGACY_LOCAL_BOARD_ID } from './editor/local/localBoardCache';
import {
  localBoardRepository,
  type LocalBoardSummary,
  type TrashedLocalBoardSummary,
} from './editor/local/localBoardRepository';
import { copyCloudBoardToLocal } from './editor/cloud/cloudToLocal';
import { copyLocalBoardToCloud } from './editor/cloud/localToCloud';
import { setWorkspaceFontChoice } from './math/mathLiveRuntime';

/**
 * Owns browser navigation, session state, and the local/cloud board libraries.
 * The selected board is delegated to `Workspace`; this component never edits
 * board contents directly.
 */
export function App() {
  const [initialInviteToken] = useState(readBoardInviteToken);
  const [accountOpen, setAccountOpen] = useState(
    () => initialInviteToken !== null,
  );
  const [localBoardLibraryOpen, setLocalBoardLibraryOpen] = useState(false);
  const [localBoards, setLocalBoards] = useState<LocalBoardSummary[]>([]);
  const [cloudBoards, setCloudBoards] = useState<Board[]>([]);
  const [trashedCloudBoards, setTrashedCloudBoards] = useState<
    TrashedCloudBoardSummary[]
  >([]);
  const [cloudBoardsState, setCloudBoardsState] = useState<
    'idle' | 'loading' | 'ready' | 'unavailable'
  >('idle');
  const [localStorageReady, setLocalStorageReady] = useState(false);
  const [localStorageError, setLocalStorageError] = useState(false);
  const [localStorageAttempt, setLocalStorageAttempt] = useState(0);
  const [trashedLocalBoards, setTrashedLocalBoards] = useState<
    TrashedLocalBoardSummary[]
  >([]);
  const [localBoardRevision, setLocalBoardRevision] = useState(0);
  const [boardAccessOpen, setBoardAccessOpen] = useState(false);
  const [navigation, setNavigation] =
    useState<NavigationState>(initialNavigation);
  const localBoardIdRef = useRef(navigation.localBoardId);
  const localNavigationRevisionRef = useRef(0);
  const localBoardsRefreshRevisionRef = useRef(0);
  const cloudBoardsRefreshRevisionRef = useRef(0);
  const implicitCloudRequestRef = useRef(
    readBoardRoute(window.location.pathname).kind === 'default' &&
      navigation.requestedBoardId !== null,
  );
  const [canonicalEntryPath] = useState(() => {
    // A remembered cloud board is not canonical until the current session and
    // server both confirm it. Startup therefore exposes the local URL first.
    const path =
      navigation.status === 'idle' && navigation.selectedBoard !== null
        ? boardPath(navigation.selectedBoard.id)
        : localBoardPath(navigation.localBoardId);
    return `${path}${window.location.search}${window.location.hash}`;
  });
  const [resolutionAttempt, setResolutionAttempt] = useState(0);
  const [bootstrapLocalBoardId] = useState(() => navigation.localBoardId);
  const { authenticate, expire, refresh, session, signOut } = useSession();
  const { localBoardId, requestedBoardId, selectedBoard, status } = navigation;

  // Navigation caches are hints for startup, never proof that a board exists or
  // that the current session may open it.
  useEffect(() => {
    localBoardIdRef.current = localBoardId;
    rememberLocalBoard(localBoardId);
    if (selectedBoard !== null) {
      rememberCloudBoard(selectedBoard);
    }
  }, [localBoardId, selectedBoard]);

  useEffect(() => {
    if (readBoardRoute(window.location.pathname).kind !== 'default') return;
    window.history.replaceState(null, '', canonicalEntryPath);
  }, [canonicalEntryPath]);

  // Browser history is resolved through the same storage and authorization
  // boundaries as an initial URL; cached selections cannot bypass either.
  useEffect(() => {
    const handlePopState = () => {
      const revision = ++localNavigationRevisionRef.current;
      const route = readBoardRoute(window.location.pathname);
      if (route.kind === 'local' || route.kind === 'default') {
        implicitCloudRequestRef.current = false;
        const boardId =
          route.kind === 'local' && route.boardId !== null
            ? route.boardId
            : loadLastLocalBoardId();
        void localBoardRepository
          .read(boardId)
          .then((record) => {
            if (revision !== localNavigationRevisionRef.current) return;
            if (record === null) {
              const fallbackId = localBoardIdRef.current;
              window.history.replaceState(null, '', localBoardPath(fallbackId));
              setNavigation((current) => ({
                ...current,
                localBoardId: fallbackId,
                requestedBoardId: null,
                selectedBoard: null,
                status: 'idle',
              }));
              return;
            }
            setNavigation({
              localBoardId: boardId,
              requestedBoardId: null,
              selectedBoard: null,
              status: 'idle',
            });
          })
          .catch(() => {
            if (revision !== localNavigationRevisionRef.current) return;
            window.history.replaceState(
              null,
              '',
              localBoardPath(localBoardIdRef.current),
            );
          });
        return;
      }
      implicitCloudRequestRef.current = false;
      const cached = loadLastCloudBoard();
      setNavigation((current) => ({
        localBoardId: current.localBoardId,
        requestedBoardId: route.boardId,
        selectedBoard:
          current.selectedBoard?.id === route.boardId
            ? current.selectedBoard
            : cached?.id === route.boardId
              ? cached
              : null,
        status: 'resolving',
      }));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Cloud URLs remain provisional until the current session authorizes them.
  useEffect(() => {
    if (requestedBoardId === null) return;
    let active = true;
    const returnToLocalBoard = () => {
      implicitCloudRequestRef.current = false;
      window.history.replaceState(null, '', localBoardPath(localBoardId));
      setNavigation((current) =>
        current.requestedBoardId === requestedBoardId
          ? {
              localBoardId: current.localBoardId,
              requestedBoardId: null,
              selectedBoard: null,
              status: 'idle',
            }
          : current,
      );
    };
    const resolutionTimer = window.setTimeout(() => {
      if (!active) return;
      if (session.status === 'anonymous') {
        if (
          implicitCloudRequestRef.current ||
          selectedBoard?.id === requestedBoardId
        ) {
          // A remembered board must never become the active URL without a
          // current account. Its device cache remains intact for later sign-in.
          returnToLocalBoard();
        } else {
          setNavigation((current) =>
            current.requestedBoardId === requestedBoardId
              ? { ...current, status: 'sign-in-required' }
              : current,
          );
        }
        return;
      }
      if (session.status === 'offline-unknown') {
        if (implicitCloudRequestRef.current) returnToLocalBoard();
        else {
          setNavigation((current) =>
            current.requestedBoardId === requestedBoardId
              ? { ...current, status: 'unavailable' }
              : current,
          );
        }
        return;
      }
      if (session.status !== 'authenticated') return;

      void requestApi(
        `/api/boards/${encodeURIComponent(requestedBoardId)}`,
        undefined,
        decodeBoardResponse,
      )
        .then((result) => {
          if (!active) return;
          if (implicitCloudRequestRef.current) {
            implicitCloudRequestRef.current = false;
            window.history.replaceState(null, '', boardPath(result.board.id));
          }
          setNavigation((current) =>
            current.requestedBoardId === requestedBoardId
              ? {
                  localBoardId: current.localBoardId,
                  requestedBoardId: null,
                  selectedBoard: cloudSelection(result.board),
                  status: 'idle',
                }
              : current,
          );
        })
        .catch((error: unknown) => {
          if (!active) return;
          if (implicitCloudRequestRef.current) {
            returnToLocalBoard();
          } else if (isApiError(error) && error.status === 401) {
            expire();
            setNavigation((current) =>
              current.requestedBoardId === requestedBoardId
                ? { ...current, status: 'sign-in-required' }
                : current,
            );
          } else if (
            isApiError(error) &&
            (error.status === 403 || error.status === 404)
          ) {
            setNavigation((current) =>
              current.requestedBoardId === requestedBoardId
                ? { ...current, status: 'inaccessible' }
                : current,
            );
          } else {
            setNavigation((current) =>
              current.requestedBoardId === requestedBoardId
                ? { ...current, status: 'unavailable' }
                : current,
            );
          }
        });
    });
    return () => {
      active = false;
      window.clearTimeout(resolutionTimer);
    };
  }, [
    expire,
    localBoardId,
    requestedBoardId,
    resolutionAttempt,
    selectedBoard?.id,
    session.status,
  ]);

  // Revision numbers discard responses from a library refresh superseded by a
  // newer mutation or session change.
  const refreshLocalBoards = useCallback(async () => {
    const revision = ++localBoardsRefreshRevisionRef.current;
    const [boards, trashedBoards] = await Promise.all([
      localBoardRepository.list(),
      localBoardRepository.listTrash(),
    ]);
    if (revision === localBoardsRefreshRevisionRef.current) {
      setLocalBoards(boards);
      setTrashedLocalBoards(trashedBoards);
    }
    return boards;
  }, []);
  const refreshCloudBoards = useCallback(async () => {
    const revision = ++cloudBoardsRefreshRevisionRef.current;
    if (session.status !== 'authenticated') {
      setCloudBoards([]);
      setTrashedCloudBoards([]);
      setCloudBoardsState('idle');
      return [];
    }
    setCloudBoardsState('loading');
    try {
      const [activeResult, trashResult] = await Promise.all([
        requestApi('/api/boards', undefined, decodeBoardsResponse),
        requestApi('/api/boards/trash', undefined, decodeTrashedBoardsResponse),
      ]);
      if (revision === cloudBoardsRefreshRevisionRef.current) {
        setCloudBoards(activeResult.boards);
        setTrashedCloudBoards(trashResult.boards);
        setCloudBoardsState('ready');
      }
      return activeResult.boards;
    } catch (error) {
      if (isApiError(error) && error.status === 401) expire();
      if (revision === cloudBoardsRefreshRevisionRef.current) {
        setCloudBoardsState('unavailable');
      }
      throw error;
    }
  }, [expire, session.status]);

  useEffect(() => {
    let active = true;
    void localBoardRepository
      .initialize(bootstrapLocalBoardId)
      .then(async (initialization) => {
        const trashedBoards = await localBoardRepository.listTrash();
        if (!active) return;
        setLocalBoards(initialization.boards);
        setTrashedLocalBoards(trashedBoards);
        const route = readBoardRoute(window.location.pathname);
        setNavigation((current) => ({
          ...current,
          localBoardId:
            current.localBoardId === bootstrapLocalBoardId
              ? initialization.selectedBoardId
              : current.localBoardId,
        }));
        if (
          route.kind === 'default' ||
          (route.kind === 'local' &&
            (route.boardId === null ||
              route.boardId === LEGACY_LOCAL_BOARD_ID ||
              !initialization.preferredBoardFound))
        ) {
          window.history.replaceState(
            null,
            '',
            `${localBoardPath(initialization.selectedBoardId)}${window.location.search}${window.location.hash}`,
          );
        }
        setLocalStorageReady(true);
      })
      .catch(() => {
        if (!active) return;
        setLocalStorageError(true);
      });
    return () => {
      active = false;
    };
  }, [bootstrapLocalBoardId, localStorageAttempt]);

  // Selection changes URL and identity together before the workspace remounts.
  const selectLocalBoard = useCallback((boardId: string) => {
    const revision = ++localNavigationRevisionRef.current;
    void localBoardRepository
      .read(boardId)
      .then((record) => {
        if (revision !== localNavigationRevisionRef.current) return;
        if (record === null) {
          window.history.replaceState(
            null,
            '',
            localBoardPath(localBoardIdRef.current),
          );
          return;
        }
        window.history.pushState(null, '', localBoardPath(boardId));
        rememberLocalBoard(boardId);
        setNavigation((current) => ({
          ...current,
          localBoardId: boardId,
          requestedBoardId: null,
          selectedBoard: null,
          status: 'idle',
        }));
      })
      .catch(() => {
        if (revision !== localNavigationRevisionRef.current) return;
        window.history.replaceState(
          null,
          '',
          localBoardPath(localBoardIdRef.current),
        );
      });
  }, []);

  // Local library commands delegate durability to the repository, then refresh
  // the visible summaries from committed IndexedDB state.
  const createAndOpenLocalBoard = useCallback(
    async (title: string) => {
      const created = await localBoardRepository.create(title);
      await refreshLocalBoards();
      setLocalBoardLibraryOpen(false);
      selectLocalBoard(created.id);
    },
    [refreshLocalBoards, selectLocalBoard],
  );

  const createLocalBoardInNewTab = useCallback(
    (title: string) => {
      const newTab = window.open('about:blank', '_blank');
      if (newTab === null) return;
      newTab.opener = null;
      void localBoardRepository
        .create(title)
        .then((created) => {
          void refreshLocalBoards();
          newTab.location.replace(
            new URL(localBoardPath(created.id), window.location.href).href,
          );
        })
        .catch(() => {
          newTab.document.title = 'Board creation failed';
          newTab.document.body.textContent =
            'The board could not be created. You can close this tab.';
        });
    },
    [refreshLocalBoards],
  );

  const importAndOpenLocalBoard = useCallback(
    async (bytes: Uint8Array, signal?: AbortSignal) => {
      const imported = await localBoardRepository.importArchive(bytes, signal);
      await setWorkspaceFontChoice(imported.font);
      await refreshLocalBoards();
      selectLocalBoard(imported.board.id);
    },
    [refreshLocalBoards, selectLocalBoard],
  );

  const handleLocalBoardUnavailable = useCallback(() => {
    const unavailableBoardId = localBoardIdRef.current;
    void refreshLocalBoards()
      .then(async (remaining) => {
        if (localBoardIdRef.current !== unavailableBoardId) return;
        const next = remaining.find(({ id }) => id !== unavailableBoardId);
        if (next !== undefined) {
          selectLocalBoard(next.id);
          return;
        }
        await createAndOpenLocalBoard('Untitled board');
      })
      .catch(() => {
        // The workspace already owns the storage failure message and retry UI.
      });
  }, [createAndOpenLocalBoard, refreshLocalBoards, selectLocalBoard]);

  const duplicateAndOpenLocalBoard = useCallback(
    async (boardId: string) => {
      const duplicated = await localBoardRepository.duplicate(boardId);
      if (duplicated === null) throw new Error('Local board not found');
      await refreshLocalBoards();
      setLocalBoardLibraryOpen(false);
      selectLocalBoard(duplicated.id);
    },
    [refreshLocalBoards, selectLocalBoard],
  );

  const renameStoredLocalBoard = useCallback(
    async (boardId: string, title: string) => {
      const renamed = await localBoardRepository.rename(boardId, title);
      if (renamed === null) throw new Error('Local board not found');
      await refreshLocalBoards();
      if (boardId === localBoardId) {
        setLocalBoardRevision((current) => current + 1);
      }
    },
    [localBoardId, refreshLocalBoards],
  );

  const trashStoredLocalBoard = useCallback(
    async (boardId: string) => {
      const trashed = await localBoardRepository.trash(boardId);
      if (trashed === null) throw new Error('Local board not found');
      const remaining = await refreshLocalBoards();
      if (boardId === localBoardId) {
        const next = remaining[0];
        if (next === undefined) {
          await createAndOpenLocalBoard('Untitled board');
        } else {
          selectLocalBoard(next.id);
        }
      }
    },
    [
      createAndOpenLocalBoard,
      localBoardId,
      refreshLocalBoards,
      selectLocalBoard,
    ],
  );

  const restoreStoredLocalBoard = useCallback(
    async (boardId: string) => {
      const restored = await localBoardRepository.restore(boardId);
      if (restored === null) throw new Error('Trashed local board not found');
      await refreshLocalBoards();
    },
    [refreshLocalBoards],
  );

  const permanentlyDeleteStoredLocalBoard = useCallback(
    async (boardId: string) => {
      await localBoardRepository.deletePermanently(boardId);
      await refreshLocalBoards();
    },
    [refreshLocalBoards],
  );

  const restoreAllStoredLocalBoards = useCallback(async () => {
    await localBoardRepository.restoreAll();
    await refreshLocalBoards();
  }, [refreshLocalBoards]);

  const emptyLocalBoardTrash = useCallback(async () => {
    await localBoardRepository.deleteAllPermanently();
    await refreshLocalBoards();
  }, [refreshLocalBoards]);

  // Cloud library commands repeat authorization on the server; list state is
  // merely a projection of those accepted operations.
  const selectBoard = useCallback(
    (board: Board | null) => {
      localNavigationRevisionRef.current += 1;
      const selection = board === null ? null : cloudSelection(board);
      if (board !== null) {
        setCloudBoards((current) =>
          current.map((candidate) =>
            candidate.id === board.id ? { ...candidate, ...board } : candidate,
          ),
        );
      }
      const path =
        selection === null
          ? localBoardPath(localBoardId)
          : boardPath(selection.id);
      const replace = selectedBoard?.id === selection?.id;
      window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
      setNavigation({
        localBoardId,
        requestedBoardId: null,
        selectedBoard: selection,
        status: 'idle',
      });
    },
    [localBoardId, selectedBoard?.id],
  );

  const createAndOpenCloudBoard = useCallback(async () => {
    const result = await requestApi(
      '/api/boards',
      {
        method: 'POST',
        body: JSON.stringify({ title: 'Untitled board' }),
      },
      decodeBoardResponse,
    );
    setCloudBoards((current) => [
      result.board,
      ...current.filter((board) => board.id !== result.board.id),
    ]);
    selectBoard(result.board);
  }, [selectBoard]);

  const trashStoredCloudBoard = useCallback(
    async (boardId: string) => {
      await requestApi(`/api/boards/${encodeURIComponent(boardId)}`, {
        method: 'DELETE',
      });
      await refreshCloudBoards();
      if (selectedBoard?.id === boardId) selectBoard(null);
    },
    [refreshCloudBoards, selectBoard, selectedBoard?.id],
  );

  const restoreStoredCloudBoard = useCallback(
    async (boardId: string) => {
      await requestApi(`/api/boards/${encodeURIComponent(boardId)}/restore`, {
        method: 'POST',
      });
      await refreshCloudBoards();
    },
    [refreshCloudBoards],
  );

  const permanentlyDeleteStoredCloudBoard = useCallback(
    async (boardId: string) => {
      await requestApi(`/api/boards/${encodeURIComponent(boardId)}/permanent`, {
        method: 'DELETE',
      });
      await refreshCloudBoards();
    },
    [refreshCloudBoards],
  );

  const restoreAllStoredCloudBoards = useCallback(async () => {
    await requestApi('/api/boards/trash/restore-all', { method: 'POST' });
    await refreshCloudBoards();
  }, [refreshCloudBoards]);

  const emptyCloudBoardTrash = useCallback(async () => {
    await requestApi('/api/boards/trash', { method: 'DELETE' });
    await refreshCloudBoards();
  }, [refreshCloudBoards]);

  // Copying crosses durability domains by creating an independent destination;
  // it never changes the source board's identity or contents.
  const copyStoredLocalBoardToCloud = useCallback(
    async (boardId: string) => {
      if (session.user === null)
        throw new Error('Sign in to copy a board to cloud.');
      const source = await localBoardRepository.read(boardId);
      if (source === null)
        throw new Error('The local source board was not found.');
      const destination = await copyLocalBoardToCloud(source, session.user.id);
      await refreshCloudBoards().catch(() => {
        // The durable destination can open even while its list refresh is offline.
      });
      return destination;
    },
    [refreshCloudBoards, session.user],
  );

  const copyCurrentLocalBoardToCloud = useCallback(async () => {
    const destination = await copyStoredLocalBoardToCloud(localBoardId);
    selectBoard(destination);
  }, [copyStoredLocalBoardToCloud, localBoardId, selectBoard]);

  const copyStoredCloudBoardToLocal = useCallback(
    async (boardId: string) => {
      const created = await copyCloudBoardToLocal(boardId);
      await refreshLocalBoards();
      return created;
    },
    [refreshLocalBoards],
  );

  const handleCloudBoardTitleReconciled = useCallback(
    (boardId: string, title: string) => {
      setNavigation((current) =>
        current.selectedBoard?.id === boardId
          ? {
              ...current,
              selectedBoard: { ...current.selectedBoard, title },
            }
          : current,
      );
      setCloudBoards((current) =>
        current.map((board) =>
          board.id === boardId ? { ...board, title } : board,
        ),
      );
    },
    [],
  );

  const handleSessionExpired = useCallback(() => {
    expire();
    setNavigation((current) =>
      current.selectedBoard === null
        ? current
        : {
            ...current,
            requestedBoardId: current.selectedBoard.id,
            status: 'sign-in-required',
          },
    );
  }, [expire]);
  const handleBoardInvitationAccepted = useCallback(
    (board: Board) => {
      selectBoard(board);
      setAccountOpen(false);
    },
    [selectBoard],
  );
  const invitationMessage = useBoardInvitation({
    initialToken: initialInviteToken,
    onAccepted: handleBoardInvitationAccepted,
    onSessionExpired: handleSessionExpired,
    sessionStatus: session.status,
  });

  const handleSignOut = useCallback(() => {
    localNavigationRevisionRef.current += 1;
    signOut();
    window.history.pushState(null, '', localBoardPath(localBoardId));
    setNavigation({
      localBoardId,
      requestedBoardId: null,
      selectedBoard: null,
      status: 'idle',
    });
  }, [localBoardId, signOut]);

  const openAccount = useCallback(() => {
    setLocalBoardLibraryOpen(false);
    setBoardAccessOpen(false);
    setAccountOpen(true);
  }, []);
  const openLocalBoardLibrary = useCallback(() => {
    setAccountOpen(false);
    setBoardAccessOpen(false);
    setLocalBoardLibraryOpen(true);
    void refreshLocalBoards();
    void refreshCloudBoards().catch(() => {
      // The local-board library remains usable while cloud listing is offline.
    });
  }, [refreshCloudBoards, refreshLocalBoards]);
  const manageCloudAccess = useCallback(() => {
    if (selectedBoard === null) return;
    setAccountOpen(false);
    setBoardAccessOpen(true);
  }, [selectedBoard]);
  const closeAccount = useCallback(() => {
    setAccountOpen(false);
  }, []);
  const handleBoardAccessSessionExpired = useCallback(() => {
    setBoardAccessOpen(false);
    handleSessionExpired();
    setAccountOpen(true);
  }, [handleSessionExpired]);
  const useLocalBoard = () => selectBoard(null);
  const activeCloudBoard = status === 'idle' ? selectedBoard : null;
  // The workspace remains mounted behind library and account dialogs so an
  // interrupted modal workflow cannot discard the open board.
  return (
    <>
      {localStorageReady ? (
        <Workspace
          key={
            activeCloudBoard?.id ??
            `local:${localBoardId}:${localBoardRevision}`
          }
          cloudAccessConfirmed={activeCloudBoard !== null}
          cloudBoard={activeCloudBoard}
          currentUser={session.user}
          localBoardId={localBoardId}
          onCloudBoardTitleReconciled={handleCloudBoardTitleReconciled}
          onCloudSessionExpired={handleSessionExpired}
          onCopyLocalBoardToCloud={copyCurrentLocalBoardToCloud}
          onCreateCloudBoard={createAndOpenCloudBoard}
          onCreateLocalBoard={() => createLocalBoardInNewTab('Untitled board')}
          onImportLocalBoard={importAndOpenLocalBoard}
          onLocalBoardUnavailable={handleLocalBoardUnavailable}
          onManageCloudAccess={manageCloudAccess}
          onOpenAccount={openAccount}
          onOpenBoards={openLocalBoardLibrary}
        />
      ) : (
        <main className="fatal-state" aria-busy={!localStorageError}>
          <section className="fatal-state__card" role="status">
            <strong>
              {localStorageError
                ? 'Local storage needs attention'
                : 'Opening your local boards…'}
            </strong>
            {localStorageError ? (
              <>
                <span>
                  Chalkboard could not open its on-device board library. No
                  board was replaced.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setLocalStorageError(false);
                    setLocalStorageAttempt((current) => current + 1);
                  }}
                >
                  Try again
                </button>
              </>
            ) : null}
          </section>
        </main>
      )}

      {status !== 'idle' && localStorageReady && (
        <BoardRouteNotice
          cachedBoardVisible={false}
          status={status}
          onOpenAccount={openAccount}
          onRetry={() => {
            if (session.status === 'authenticated') {
              setResolutionAttempt((current) => current + 1);
            } else {
              void refresh();
            }
          }}
          onUseLocalBoard={useLocalBoard}
        />
      )}

      {localBoardLibraryOpen && (
        <LocalBoardLibrary
          boards={localBoards}
          cloudBoards={cloudBoards}
          cloudBoardsState={
            session.status === 'authenticated' ? cloudBoardsState : 'signed-out'
          }
          currentBoardId={activeCloudBoard === null ? localBoardId : ''}
          currentCloudBoardId={activeCloudBoard?.id ?? null}
          onClose={() => setLocalBoardLibraryOpen(false)}
          onCopyCloudToLocal={copyStoredCloudBoardToLocal}
          onCopyLocalToCloud={copyStoredLocalBoardToCloud}
          onDeleteAllCloudPermanently={emptyCloudBoardTrash}
          onDeleteAllPermanently={emptyLocalBoardTrash}
          onDeleteCloudPermanently={permanentlyDeleteStoredCloudBoard}
          onDeletePermanently={permanentlyDeleteStoredLocalBoard}
          onDuplicate={duplicateAndOpenLocalBoard}
          onOpen={(boardId) => {
            setLocalBoardLibraryOpen(false);
            selectLocalBoard(boardId);
          }}
          onOpenCloud={(board) => {
            setLocalBoardLibraryOpen(false);
            selectBoard(board);
          }}
          onRename={renameStoredLocalBoard}
          onRestore={restoreStoredLocalBoard}
          onRestoreAll={restoreAllStoredLocalBoards}
          onRestoreAllCloud={restoreAllStoredCloudBoards}
          onRestoreCloud={restoreStoredCloudBoard}
          onSignIn={openAccount}
          onTrash={trashStoredLocalBoard}
          onTrashCloud={trashStoredCloudBoard}
          signedIn={session.status === 'authenticated'}
          trashedBoards={trashedLocalBoards}
          trashedCloudBoards={trashedCloudBoards}
        />
      )}

      {boardAccessOpen && activeCloudBoard !== null && (
        <BoardAccessPanel
          board={activeCloudBoard}
          onClose={() => setBoardAccessOpen(false)}
          onSessionExpired={handleBoardAccessSessionExpired}
        />
      )}

      {accountOpen && (
        <AccountPanel
          {...(invitationMessage === undefined ? {} : { invitationMessage })}
          session={session}
          onAuthenticated={authenticate}
          onRefreshSession={refresh}
          onSessionExpired={handleSessionExpired}
          onSignOut={handleSignOut}
          onClose={closeAccount}
        />
      )}
    </>
  );
}
