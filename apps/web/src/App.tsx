/**
 * Browser application composition root. It resolves route intent against local
 * storage or server authorization, owns board-library dialogs and session
 * state, and delegates all board-content editing to `Workspace`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  decodeBoardResponse,
  decodeBoardsResponse,
  decodeInvitationsResponse,
  decodeTrashedBoardsResponse,
  isApiError,
  isBoardAccessWithdrawnError,
  requestApi,
  type Board,
  type BoardInvitation,
  type TrashedCloudBoardSummary,
} from './account/api';
import {
  cloudSelection,
  initialNavigation,
  forgetBoard,
  loadLastCloudBoard,
  loadLastLocalBoardId,
  readBoardInviteToken,
  rememberBoard,
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
import { StatusNotice } from './StatusNotice';
import type { CloudBoardSelection } from './cloudBoardSelection';
import { BoardInvites } from './account/BoardInvites';
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
import { duplicateCloudBoard } from './editor/cloud/cloudToCloud';
import { copyCloudBoardToLocal } from './editor/cloud/cloudToLocal';
import { copyLocalBoardToCloud } from './editor/cloud/localToCloud';
import { setWorkspaceFontChoice } from './math/mathLiveRuntime';

/** Keeps the legacy migration sentinel out of canonical browser URLs. */
function localNavigationPath(boardId: string): string {
  return boardId === LEGACY_LOCAL_BOARD_ID ? '/local' : localBoardPath(boardId);
}

/**
 * Owns browser navigation, session state, and the local/cloud board libraries.
 * The selected board is delegated to `Workspace`; this component never edits
 * board contents directly.
 */
export function App() {
  const [initialInviteToken] = useState(readBoardInviteToken);
  const [accountOpen, setAccountOpen] = useState(false);
  // Suppresses the invitation sign-in prompt once the reader closes it.
  const [invitationSignInDismissed, setInvitationSignInDismissed] =
    useState(false);
  const [localBoardLibraryOpen, setLocalBoardLibraryOpen] = useState(false);
  const [boardAccessRevision, setBoardAccessRevision] = useState(0);
  const [boardInvitesOpen, setBoardInvitesOpen] = useState(false);
  const [boardInvitations, setBoardInvitations] = useState<BoardInvitation[]>(
    [],
  );
  const [boardInvitesState, setBoardInvitesState] = useState<
    'idle' | 'loading' | 'ready' | 'signed-out' | 'unavailable'
  >('idle');
  const [unavailableBoard, setUnavailableBoard] = useState<
    'cloud' | 'local' | 'remembered' | null
  >(null);
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
  // Read by the popstate listener and by resolution callbacks, which must see
  // the account signed in now rather than the one captured when they attached.
  const sessionUserIdRef = useRef<string | null>(null);
  // Cloud recovery runs from the resolution effect, which is declared above the
  // callbacks it needs.
  const refreshCloudBoardsRef = useRef<() => Promise<Board[]>>(async () => []);
  const createCloudBoardRef = useRef<() => Promise<void>>(
    async () => undefined,
  );
  const localNavigationRevisionRef = useRef(0);
  const localBoardsRefreshRevisionRef = useRef(0);
  const cloudBoardsRefreshRevisionRef = useRef(0);
  // Trashing publishes the same unavailable-board notification used by other
  // tabs. The initiating tab owns its replacement directly, so suppress its
  // parallel fallback until navigation has completed.
  const localBoardTrashInFlightRef = useRef<string | null>(null);
  const cloudBoardDepartureInFlightRef = useRef<string | null>(null);
  const implicitCloudRequestRef = useRef(
    readBoardRoute(window.location.pathname).kind === 'default' &&
      navigation.requestedBoardId !== null,
  );
  const [canonicalEntryPath] = useState(() => {
    // A remembered cloud board is not canonical until the current session and
    // server both confirm it. Startup therefore exposes the local URL first.
    // The legacy sentinel is an initialization input, never a concrete board
    // identity; IndexedDB replaces the compatibility route with the real ID.
    const localPath = localNavigationPath(navigation.localBoardId);
    const path =
      navigation.status === 'idle' && navigation.selectedBoard !== null
        ? boardPath(navigation.selectedBoard.id)
        : localPath;
    return `${path}${window.location.search}${window.location.hash}`;
  });
  const [resolutionAttempt, setResolutionAttempt] = useState(0);
  const [bootstrapLocalBoardId] = useState(() => navigation.localBoardId);
  const { authenticate, expire, refresh, session, signOut } = useSession();
  const { localBoardId, requestedBoardId, selectedBoard, status } = navigation;
  // Read inside a stable callback, so re-selecting a board does not rebuild the
  // socket effect that asked for the refresh in the first place.
  const selectedBoardRef = useRef(selectedBoard);
  useEffect(() => {
    selectedBoardRef.current = selectedBoard;
  }, [selectedBoard]);

  // Navigation caches are hints for startup, never proof that a board exists or
  // that the current session may open it.
  useEffect(() => {
    sessionUserIdRef.current = session.user?.id ?? null;
  }, [session.user]);

  useEffect(() => {
    localBoardIdRef.current = localBoardId;
    rememberLocalBoard(localBoardId);
    if (session.user === null) return;
    // Whichever board this account is actually looking at is the one to reopen,
    // local or cloud alike.
    if (selectedBoard !== null) {
      rememberBoard(session.user.id, {
        kind: 'cloud',
        selection: selectedBoard,
      });
    } else if (status === 'idle') {
      rememberBoard(session.user.id, { id: localBoardId, kind: 'local' });
    }
  }, [localBoardId, selectedBoard, session.user, status]);

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
              window.history.replaceState(
                null,
                '',
                localNavigationPath(fallbackId),
              );
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
              localNavigationPath(localBoardIdRef.current),
            );
          });
        return;
      }
      implicitCloudRequestRef.current = false;
      const cached = loadLastCloudBoard(sessionUserIdRef.current);
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
      window.history.replaceState(
        null,
        '',
        localNavigationPath(localBoardIdRef.current),
      );
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
          const gone = isBoardAccessWithdrawnError(error);
          // A board that is gone, or no longer shared with this account, must
          // stop being the one reopened on the next visit. Whichever board this
          // account had open before it takes over, including when the request
          // was the implicit restore made at startup.
          // A cloud board that is gone, or no longer shared with this account,
          // must stop being the one reopened. A cloud board is replaced by
          // another cloud board: whichever this account had open before, else
          // any it still owns, else a fresh one. Dropping to a local board
          // instead would quietly change which storage the reader is working
          // in.
          if (gone && sessionUserIdRef.current !== null) {
            const accountId = sessionUserIdRef.current;
            forgetBoard(accountId, requestedBoardId);
            // Nobody asked for this one by address: it is the board this
            // account had open last, which reads differently from a link that
            // no longer works.
            setUnavailableBoard(
              implicitCloudRequestRef.current ? 'remembered' : 'cloud',
            );
            const openCloud = (board: CloudBoardSelection) => {
              implicitCloudRequestRef.current = false;
              window.history.replaceState(null, '', boardPath(board.id));
              setNavigation((current) =>
                current.requestedBoardId === requestedBoardId
                  ? {
                      localBoardId: current.localBoardId,
                      requestedBoardId: board.id,
                      selectedBoard: board,
                      status: 'resolving',
                    }
                  : current,
              );
            };
            const remembered = loadLastCloudBoard(accountId);
            if (remembered !== null) {
              openCloud(remembered);
              return;
            }
            void refreshCloudBoardsRef
              .current()
              .then(async (boards) => {
                if (!active) return;
                const existing = boards.find(
                  (board) => board.id !== requestedBoardId,
                );
                if (existing !== undefined) {
                  openCloud(cloudSelection(existing));
                  return;
                }
                await createCloudBoardRef.current();
              })
              .catch(() => {
                if (!active) return;
                setNavigation((current) =>
                  current.requestedBoardId === requestedBoardId
                    ? { ...current, status: 'inaccessible' }
                    : current,
                );
              });
            return;
          }
          if (implicitCloudRequestRef.current) {
            returnToLocalBoard();
          } else if (isApiError(error) && error.status === 401) {
            expire();
            setNavigation((current) =>
              current.requestedBoardId === requestedBoardId
                ? { ...current, status: 'sign-in-required' }
                : current,
            );
          } else if (gone) {
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

  const refreshBoardInvitations = useCallback(async () => {
    if (session.status !== 'authenticated') {
      setBoardInvitations([]);
      setBoardInvitesState('signed-out');
      return;
    }
    setBoardInvitesState('loading');
    try {
      const result = await requestApi(
        '/api/board-invitations',
        undefined,
        decodeInvitationsResponse,
      );
      setBoardInvitations(result.invitations);
      setBoardInvitesState('ready');
    } catch (error) {
      if (isApiError(error) && error.status === 401) expire();
      setBoardInvitesState('unavailable');
    }
  }, [expire, session.status]);

  // Accepting is the moment the board becomes one of yours, so the board list
  // is refreshed with the invitation list rather than waiting for the next
  // time something else happens to reload it.
  const answerBoardInvitation = useCallback(
    async (boardId: string, answer: 'accept' | 'reject') => {
      await requestApi(`/api/board-invitations/${boardId}/${answer}`, {
        method: 'POST',
      });
      await refreshBoardInvitations();
      if (answer === 'accept') await refreshCloudBoardsRef.current();
    },
    [refreshBoardInvitations],
  );

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
        if (localBoardIdRef.current === bootstrapLocalBoardId) {
          // Publish the durable identity before an older session-resolution
          // callback can choose its local fallback path.
          localBoardIdRef.current = initialization.selectedBoardId;
        }
        setNavigation((current) => ({
          ...current,
          localBoardId:
            current.localBoardId === bootstrapLocalBoardId
              ? initialization.selectedBoardId
              : current.localBoardId,
        }));
        // A URL naming a board that no longer exists is replaced below with
        // whichever board could be opened. Say so, rather than quietly showing
        // different work than the link asked for.
        if (
          route.kind === 'local' &&
          route.boardId !== null &&
          route.boardId !== LEGACY_LOCAL_BOARD_ID &&
          !initialization.preferredBoardFound
        ) {
          setUnavailableBoard('local');
        }
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
            `${localNavigationPath(initialization.selectedBoardId)}${window.location.search}${window.location.hash}`,
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
  const selectLocalBoard = useCallback(async (boardId: string) => {
    const revision = ++localNavigationRevisionRef.current;
    try {
      const record = await localBoardRepository.read(boardId);
      if (revision !== localNavigationRevisionRef.current) return;
      if (record === null) {
        window.history.replaceState(
          null,
          '',
          localNavigationPath(localBoardIdRef.current),
        );
        return;
      }
      // Publish the identity synchronously with navigation so an outstanding
      // unavailable-board notification cannot create a second replacement.
      localBoardIdRef.current = boardId;
      window.history.pushState(null, '', localNavigationPath(boardId));
      rememberLocalBoard(boardId);
      setNavigation((current) => ({
        ...current,
        localBoardId: boardId,
        requestedBoardId: null,
        selectedBoard: null,
        status: 'idle',
      }));
    } catch {
      if (revision !== localNavigationRevisionRef.current) return;
      window.history.replaceState(
        null,
        '',
        localNavigationPath(localBoardIdRef.current),
      );
    }
  }, []);

  // Local library commands delegate durability to the repository, then refresh
  // the visible summaries from committed IndexedDB state.
  const createAndOpenLocalBoard = useCallback(
    async (title: string) => {
      const created = await localBoardRepository.create(title);
      await refreshLocalBoards();
      setLocalBoardLibraryOpen(false);
      await selectLocalBoard(created.id);
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
            new URL(localNavigationPath(created.id), window.location.href).href,
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
      await selectLocalBoard(imported.board.id);
    },
    [refreshLocalBoards, selectLocalBoard],
  );

  const handleLocalBoardUnavailable = useCallback(() => {
    const unavailableBoardId = localBoardIdRef.current;
    if (localBoardTrashInFlightRef.current === unavailableBoardId) return;
    // Another tab deleted the open board. Replacing it silently leaves the
    // reader looking at a board they did not ask for, with no way to tell.
    setUnavailableBoard('local');
    void refreshLocalBoards()
      .then(async (remaining) => {
        if (localBoardIdRef.current !== unavailableBoardId) return;
        const next = remaining.find(({ id }) => id !== unavailableBoardId);
        if (next !== undefined) {
          await selectLocalBoard(next.id);
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
      await selectLocalBoard(duplicated.id);
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

  // The same endpoint the workspace title uses. Renaming from the library
  // spares the reader from opening a board just to correct its name, and the
  // server repeats the editor check either way.
  const renameStoredCloudBoard = useCallback(
    async (boardId: string, title: string) => {
      const { board } = await requestApi(
        `/api/boards/${encodeURIComponent(boardId)}`,
        { method: 'PATCH', body: JSON.stringify({ title }) },
        decodeBoardResponse,
      );
      setCloudBoards((current) =>
        current.map((candidate) =>
          candidate.id === board.id ? { ...candidate, ...board } : candidate,
        ),
      );
    },
    [],
  );

  const trashStoredLocalBoard = useCallback(
    async (boardId: string) => {
      localBoardTrashInFlightRef.current = boardId;
      try {
        const trashed = await localBoardRepository.trash(boardId);
        if (trashed === null) throw new Error('Local board not found');
        const remaining = await refreshLocalBoards();
        if (boardId === localBoardId) {
          const next = remaining[0];
          if (next === undefined) {
            await createAndOpenLocalBoard('Untitled board');
          } else {
            await selectLocalBoard(next.id);
          }
        }
      } finally {
        if (localBoardTrashInFlightRef.current === boardId) {
          localBoardTrashInFlightRef.current = null;
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
      // Access-change callbacks run outside React's render cycle and must stop
      // trusting the previous board as soon as navigation accepts this one.
      selectedBoardRef.current = selection;
      if (board !== null) {
        setCloudBoards((current) =>
          current.map((candidate) =>
            candidate.id === board.id ? { ...candidate, ...board } : candidate,
          ),
        );
      }
      const path =
        selection === null
          ? localNavigationPath(localBoardId)
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

  useEffect(() => {
    refreshCloudBoardsRef.current = refreshCloudBoards;
    createCloudBoardRef.current = createAndOpenCloudBoard;
  }, [createAndOpenCloudBoard, refreshCloudBoards]);

  const trashStoredCloudBoard = useCallback(
    async (boardId: string) => {
      cloudBoardDepartureInFlightRef.current = boardId;
      try {
        await requestApi(`/api/boards/${encodeURIComponent(boardId)}`, {
          method: 'DELETE',
        });
        const remaining = await refreshCloudBoards();
        if (selectedBoard?.id !== boardId) return;
        const next = remaining[0];
        if (next === undefined) {
          await createAndOpenCloudBoard();
        } else {
          selectBoard(next);
        }
      } finally {
        if (cloudBoardDepartureInFlightRef.current === boardId) {
          cloudBoardDepartureInFlightRef.current = null;
        }
      }
    },
    [
      createAndOpenCloudBoard,
      refreshCloudBoards,
      selectBoard,
      selectedBoard?.id,
    ],
  );

  // Leaving is the same shape as trashing from the reader's side: the board
  // goes away and, if they were looking at it, they need somewhere else to be.
  const leaveStoredCloudBoard = useCallback(
    async (boardId: string) => {
      cloudBoardDepartureInFlightRef.current = boardId;
      try {
        await requestApi(
          `/api/boards/${encodeURIComponent(boardId)}/membership`,
          { method: 'DELETE' },
        );
        const remaining = await refreshCloudBoards();
        if (selectedBoard?.id !== boardId) return;
        const next = remaining[0];
        if (next === undefined) {
          await createAndOpenCloudBoard();
        } else {
          selectBoard(next);
        }
      } finally {
        if (cloudBoardDepartureInFlightRef.current === boardId) {
          cloudBoardDepartureInFlightRef.current = null;
        }
      }
    },
    [
      createAndOpenCloudBoard,
      refreshCloudBoards,
      selectBoard,
      selectedBoard?.id,
    ],
  );

  // The open board's role is a snapshot taken when it was opened, so refreshing
  // the board list alone would leave the editor obeying a role the owner has
  // since changed. Re-reading the board itself is what makes a promotion or a
  // demotion take effect where the person is already working.
  // An invitee is not connected to the board being offered -- they have not
  // joined it -- so the gateway signal that tells the owner about an answer
  // cannot reach them. While the dialog is open it re-reads instead, which is
  // what makes an offer withdrawn elsewhere disappear, and a new one appear.
  useEffect(() => {
    if (!boardInvitesOpen || session.status !== 'authenticated') return;
    const poll = () => void refreshBoardInvitations();
    const timer = window.setInterval(poll, 8000);
    window.addEventListener('focus', poll);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', poll);
    };
  }, [boardInvitesOpen, refreshBoardInvitations, session.status]);

  const refreshOpenBoardAccess = useCallback(async () => {
    const open = selectedBoardRef.current;
    if (open === null || cloudBoardDepartureInFlightRef.current === open.id) {
      return;
    }
    // Somebody joined, left, or was re-roled. The owner is watching the same
    // board, so their Share dialog is told to re-read rather than showing a
    // membership list that is already out of date.
    setBoardAccessRevision((current) => current + 1);
    try {
      const result = await requestApi(
        `/api/boards/${encodeURIComponent(open.id)}`,
        undefined,
        decodeBoardResponse,
      );
      selectBoard(result.board);
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        expire();
        return;
      }
      if (!isBoardAccessWithdrawnError(caught)) return;
      // A stale check for the board this tab just left must not race the
      // command that already selected or created its replacement.
      if (
        cloudBoardDepartureInFlightRef.current === open.id ||
        selectedBoardRef.current?.id !== open.id
      ) {
        return;
      }
      // A 403/404 proves access was withdrawn. A timeout or server failure does
      // not, so it leaves the open board and its recovery state untouched.
      const remaining = await refreshCloudBoards().catch(() => []);
      setUnavailableBoard('cloud');
      const next = remaining[0];
      if (next === undefined) await createAndOpenCloudBoard();
      else selectBoard(next);
    }
  }, [createAndOpenCloudBoard, expire, refreshCloudBoards, selectBoard]);

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

  // Works from any role: a viewer could already reach a personal copy through
  // local storage in two steps, so this only removes the detour.
  const duplicateStoredCloudBoard = useCallback(
    async (board: Board) => {
      if (session.user === null)
        throw new Error('Sign in to duplicate a cloud board.');
      await duplicateCloudBoard(board, session.user.id);
      await refreshCloudBoards().catch(() => {
        // The duplicate is durable even when its list refresh is offline.
      });
    },
    [refreshCloudBoards, session.user],
  );

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
  const invitation = useBoardInvitation({
    initialToken: initialInviteToken,
    onAccepted: handleBoardInvitationAccepted,
    onSessionExpired: handleSessionExpired,
    sessionStatus: session.status,
    viewerIsDemo: session.user?.isDemo ?? false,
  });

  const handleSignOut = useCallback(() => {
    localNavigationRevisionRef.current += 1;
    signOut();
    window.history.pushState(null, '', localNavigationPath(localBoardId));
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
    setInvitationSignInDismissed(true);
  }, []);
  const handleBoardAccessSessionExpired = useCallback(() => {
    setBoardAccessOpen(false);
    handleSessionExpired();
    setAccountOpen(true);
  }, [handleSessionExpired]);
  const useLocalBoard = () => selectBoard(null);
  const activeCloudBoard = status === 'idle' ? selectedBoard : null;
  // Opening a cloud link cold has nothing to show yet: the board is still being
  // resolved and the only board in hand is this device's own. Rendering that
  // one flashes somebody's local drawing in place of the board they asked for,
  // so the wait is shown as a wait. A cloud board already open stays on screen,
  // because there the previous board is the honest thing to keep showing.
  const openingCloudBoard =
    status === 'resolving' &&
    requestedBoardId !== null &&
    selectedBoard === null;
  // The workspace remains mounted behind library and account dialogs so an
  // interrupted modal workflow cannot discard the open board.
  return (
    <>
      {localStorageReady && !openingCloudBoard ? (
        <Workspace
          key={
            activeCloudBoard?.id ??
            `local:${localBoardId}:${localBoardRevision}`
          }
          cloudAccessConfirmed={activeCloudBoard !== null}
          cloudBoard={activeCloudBoard}
          currentUser={session.user}
          {...(invitation.error === undefined
            ? {}
            : { invitationError: invitation.error })}
          localBoardId={localBoardId}
          onDismissInvitationError={invitation.dismissError}
          onCloudBoardTitleReconciled={handleCloudBoardTitleReconciled}
          onCloudSessionExpired={handleSessionExpired}
          onCopyLocalBoardToCloud={copyCurrentLocalBoardToCloud}
          onCreateCloudBoard={createAndOpenCloudBoard}
          onCreateLocalBoard={() => createLocalBoardInNewTab('Untitled board')}
          onImportLocalBoard={importAndOpenLocalBoard}
          onLocalBoardUnavailable={handleLocalBoardUnavailable}
          onManageCloudAccess={manageCloudAccess}
          onOpenAccount={openAccount}
          onCloudAccessChanged={() => {
            void refreshOpenBoardAccess();
          }}
          onOpenBoards={openLocalBoardLibrary}
          onOpenBoardInvites={() => {
            setBoardInvitesOpen(true);
            void refreshBoardInvitations();
          }}
          notices={
            <>
              {status !== 'idle' && (
                <BoardRouteNotice
                  status={status}
                  onDismiss={useLocalBoard}
                  onOpenAccount={openAccount}
                  onRetry={() => {
                    if (session.status === 'authenticated') {
                      setResolutionAttempt((current) => current + 1);
                    } else {
                      void refresh();
                    }
                  }}
                />
              )}
              {unavailableBoard !== null && (
                <StatusNotice
                  actions={[
                    {
                      label: 'Dismiss',
                      onClick: () => setUnavailableBoard(null),
                    },
                  ]}
                  body={
                    unavailableBoard === 'local'
                      ? 'That board is unavailable. It may have been deleted, so another one was opened.'
                      : unavailableBoard === 'remembered'
                        ? 'The board this account had open last is no longer available. It may have been deleted, or it may no longer be shared with you, so another one was opened.'
                        : 'That cloud board is unavailable. It may have been deleted, or your access may have changed, so another one was opened.'
                  }
                  tone="warning"
                />
              )}
            </>
          }
        />
      ) : (
        <main className="fatal-state" aria-busy={!localStorageError}>
          <section className="fatal-state__card" role="status">
            <strong>
              {localStorageError
                ? 'Local storage needs attention'
                : openingCloudBoard
                  ? 'Opening the board…'
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

      {boardInvitesOpen && (
        <BoardInvites
          invitations={boardInvitations}
          onAccept={(boardId) => answerBoardInvitation(boardId, 'accept')}
          onClose={() => setBoardInvitesOpen(false)}
          onReject={(boardId) => answerBoardInvitation(boardId, 'reject')}
          onSessionExpired={handleSessionExpired}
          state={
            session.status === 'authenticated'
              ? boardInvitesState
              : 'signed-out'
          }
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
          onDuplicateCloud={duplicateStoredCloudBoard}
          onLeaveCloud={leaveStoredCloudBoard}
          onOpen={(boardId) => {
            setLocalBoardLibraryOpen(false);
            void selectLocalBoard(boardId);
          }}
          onOpenCloud={(board) => {
            setLocalBoardLibraryOpen(false);
            selectBoard(board);
          }}
          onRename={renameStoredLocalBoard}
          onRenameCloud={renameStoredCloudBoard}
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
          accessRevision={boardAccessRevision}
          board={activeCloudBoard}
          onClose={() => setBoardAccessOpen(false)}
          onSessionExpired={handleBoardAccessSessionExpired}
        />
      )}

      {(accountOpen ||
        // Prompt only while a redemption is genuinely waiting on a sign-in:
        // guidance clears once it succeeds or terminally fails.
        (invitation.guidance !== undefined &&
          session.status !== 'authenticated' &&
          session.status !== 'loading' &&
          !invitationSignInDismissed)) && (
        <AccountPanel
          {...(invitation.guidance === undefined
            ? {}
            : { invitationMessage: invitation.guidance })}
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
