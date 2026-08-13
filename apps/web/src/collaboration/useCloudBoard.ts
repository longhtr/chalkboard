/**
 * Complete browser lifecycle for one cloud board: device recovery cache, Yjs
 * document, socket generation, replay, durable acknowledgement, Awareness,
 * reconnect, undo, and teardown. React state contains only visible projections.
 */
import {
  COLLABORATION_MESSAGE_ACKNOWLEDGEMENT,
  COLLABORATION_MESSAGE_AWARENESS,
  COLLABORATION_MESSAGE_SYNC,
  type BoardElement,
  type Point,
} from '@chalkboard/shared';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { boardContentEqual } from './boardContentEqual';
import { collaboratorColor } from './collaboratorColor';
import {
  applyOfflineBoardDiff,
  applyPendingCloudUpdates,
  CLOUD_BOARD_PENDING_REPLAY_ORIGIN,
  createCloudBoardUndoManager,
  isCloudBoardSchemaSupported,
  readCloudBoard,
  updateCloudBoard,
  writeCloudBoard,
} from './cloudBoardModel';
import { collaborationSocketUrl } from './collaborationSocketUrl';
import {
  CLOUD_CONNECTION_ATTEMPT_TIMEOUT_MS,
  cloudReconnectDelay,
} from './cloudReconnect';
import {
  loadCloudBoardCache,
  saveCloudBoardCache,
} from '../editor/local/boardStorage';
import {
  exceedsPendingCloudUpdateAge,
  exceedsPendingCloudUpdateLimits,
  MAX_PENDING_CLOUD_UPDATE_AGE_MS,
  PreservedCloudRecoveryError,
} from '../editor/cloud/cloudBoardCacheQueue';

/** User-visible socket, durability, authorization, and compatibility state. */
export type CloudConnectionState =
  | 'local'
  | 'connecting'
  | 'reconnecting'
  | 'connected'
  | 'syncing'
  | 'saved'
  | 'offline'
  | 'connection-failed'
  | 'read-only'
  | 'incompatible';

/** Whether a device cache can safely recover before live synchronization. */
export type CloudDeviceRecoveryState = 'available' | 'checking' | 'unavailable';

/** Sanitized ephemeral presence projected from one Awareness client. */
export interface CloudCollaborator {
  clientId: number;
  color: string;
  cursor?: Point;
  name: string;
  selection: string[];
  /** Signed-in account behind this session, or null if the peer published none. */
  userId: string | null;
}

/**
 * Projects raw Awareness state into the collaborators actually worth showing.
 *
 * Awareness issues a client id per tab, so one person with several tabs open
 * appears several times. Every session belonging to the local account is
 * dropped — your own other tabs are not other people, and showing them reports
 * you as collaborating with yourself.
 */
export function projectCollaborators(
  states: ReadonlyMap<number, Record<string, unknown>>,
  localClientId: number,
  localUserId: string | null,
): CloudCollaborator[] {
  const collaborators: CloudCollaborator[] = [];
  for (const [clientId, presence] of states) {
    if (clientId === localClientId) continue;
    const presenceUser = presence.user as
      { color?: unknown; id?: unknown; name?: unknown } | undefined;
    if (
      typeof presenceUser?.name !== 'string' ||
      typeof presenceUser.color !== 'string'
    )
      continue;
    const userId =
      typeof presenceUser.id === 'string' && presenceUser.id.length > 0
        ? presenceUser.id
        : null;
    if (localUserId !== null && userId === localUserId) continue;
    const cursor = presence.cursor as { x?: unknown; y?: unknown } | undefined;
    const point =
      typeof cursor?.x === 'number' && typeof cursor.y === 'number'
        ? { x: cursor.x, y: cursor.y }
        : null;
    const selection = Array.isArray(presence.selection)
      ? presence.selection.filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    collaborators.push({
      clientId,
      color: presenceUser.color,
      ...(point === null ? {} : { cursor: point }),
      name: presenceUser.name,
      selection,
      userId,
    });
  }
  return collaborators;
}

/**
 * Collapses the several Awareness clients one account produces when it opens a
 * board in more than one tab. Peers that publish no account identifier stay
 * distinct, so an older client is listed rather than hidden.
 */
export function distinctCollaborators(
  collaborators: readonly CloudCollaborator[],
): CloudCollaborator[] {
  const seen = new Set<string>();
  const distinct: CloudCollaborator[] = [];
  for (const collaborator of collaborators) {
    const key =
      collaborator.userId === null
        ? `client:${collaborator.clientId}`
        : `user:${collaborator.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(collaborator);
  }
  return distinct;
}

interface CloudBoardOptions {
  boardId: string | null;
  canEdit: boolean;
  elements: BoardElement[];
  onRemoteBoard(elements: BoardElement[], title: string): void;
  title: string;
  user: { displayName: string; id: string } | null;
}

function sendSyncStep1(socket: WebSocket, document: Y.Doc): void {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, document);
  socket.send(encoding.toUint8Array(encoder));
}

/**
 * Owns one cloud board's device cache, Yjs document, socket generation,
 * acknowledgement accounting, and Awareness state. A board is reported saved
 * only after every represented local update has a durable server sequence.
 */
export function useCloudBoard({
  boardId,
  canEdit,
  elements,
  onRemoteBoard,
  title,
  user,
}: CloudBoardOptions): {
  canRedo: boolean;
  canUndo: boolean;
  collaborators: CloudCollaborator[];
  deviceRecoveryState: CloudDeviceRecoveryState;
  hasPendingWork: boolean;
  redo(): void;
  retryConnection(): void;
  state: CloudConnectionState;
  undo(): void;
  updateCursor(cursor: Point | null): void;
  updateSelection(selection: string[]): void;
} {
  // React state is limited to user-visible status. Mutable protocol state lives
  // in refs so socket callbacks from one generation can be rejected immediately.
  const [state, setState] = useState<CloudConnectionState>(
    boardId === null ? 'local' : 'connecting',
  );
  const [collaborators, setCollaborators] = useState<CloudCollaborator[]>([]);
  const [cacheReady, setCacheReady] = useState({
    boardId: null as string | null,
    version: 0,
  });
  const [deviceRecovery, setDeviceRecovery] = useState<{
    boardId: string | null;
    state: CloudDeviceRecoveryState;
    version: number;
  }>({ boardId: null, state: 'available', version: 0 });
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [historyAvailability, setHistoryAvailability] = useState({
    boardId: null as string | null,
    canRedo: false,
    canUndo: false,
  });
  const cacheLoadVersionRef = useRef(0);
  const documentRef = useRef<Y.Doc | null>(null);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const awarenessRef = useRef<awarenessProtocol.Awareness | null>(null);
  const cursorFrameRef = useRef<number | null>(null);
  const pendingCursorRef = useRef<Point | null>(null);
  const selectionRef = useRef<string[]>([]);
  const syncedRef = useRef(false);
  const pendingUpdatesRef = useRef(0);
  const pendingRawUpdatesRef = useRef<Uint8Array[]>([]);
  const pendingRawUpdateBytesRef = useRef(0);
  const pendingSinceRef = useRef<number | null>(null);
  const pendingSnapshotRef = useRef(false);
  const pendingCacheRef = useRef(false);
  const reconnectFailuresRef = useRef(0);
  const preservedRecoveryBoardRef = useRef<string | null>(null);
  const incompatibleRef = useRef(false);
  const publishedBoardRef = useRef({ elements, title });
  const baselineRef = useRef({ elements, title });
  const localRef = useRef({ elements, title });
  const remoteCallbackRef = useRef(onRemoteBoard);

  // Durability is tracked in refs so socket callbacks stay synchronous, but the
  // workspace needs it as rendered state to warn about work that is not safe yet.
  const [pendingWork, setPendingWork] = useState(false);
  const refreshPendingWork = useCallback(() => {
    setPendingWork(
      pendingCacheRef.current ||
        pendingUpdatesRef.current > 0 ||
        pendingRawUpdatesRef.current.length > 0,
    );
  }, []);

  // Keep callback-facing values current without reconnecting whenever the local
  // editor publishes a document revision.
  useEffect(() => {
    localRef.current = { elements, title };
    remoteCallbackRef.current = onRemoteBoard;
  }, [elements, onRemoteBoard, title]);

  const cacheBoard = useCallback(
    (
      activeBoardId: string,
      record: Parameters<typeof saveCloudBoardCache>[1],
    ) => {
      if (preservedRecoveryBoardRef.current === activeBoardId) return;
      void saveCloudBoardCache(activeBoardId, record).then(
        () =>
          setDeviceRecovery((current) =>
            current.boardId === activeBoardId
              ? { ...current, state: 'available' }
              : current,
          ),
        () =>
          setDeviceRecovery((current) =>
            current.boardId === activeBoardId
              ? { ...current, state: 'unavailable' }
              : current,
          ),
      );
    },
    [],
  );

  // Device recovery must load before network reconciliation. Its generation
  // number prevents an older IndexedDB read from replacing a newly selected board.
  useEffect(() => {
    if (boardId === null) return;
    const loadVersion = cacheLoadVersionRef.current + 1;
    cacheLoadVersionRef.current = loadVersion;
    pendingCacheRef.current = false;
    pendingRawUpdatesRef.current = [];
    pendingRawUpdateBytesRef.current = 0;
    pendingSinceRef.current = null;
    pendingSnapshotRef.current = false;
    reconnectFailuresRef.current = 0;
    preservedRecoveryBoardRef.current = null;
    incompatibleRef.current = false;
    refreshPendingWork();
    let disposed = false;
    void loadCloudBoardCache(boardId)
      .then((cached) => {
        if (disposed) return;
        setDeviceRecovery({
          boardId,
          state: 'available',
          version: loadVersion,
        });
        if (cached !== null) {
          const pendingSince = cached.pending
            ? (cached.pendingSince ?? cached.updatedAt)
            : null;
          const updatesExceededAge =
            pendingSince !== null &&
            cached.pendingUpdates.length > 0 &&
            exceedsPendingCloudUpdateAge(pendingSince, Date.now());
          const pendingUpdates = updatesExceededAge
            ? []
            : cached.pendingUpdates;
          pendingCacheRef.current = cached.pending;
          pendingRawUpdatesRef.current = pendingUpdates;
          pendingRawUpdateBytesRef.current = pendingUpdates.reduce(
            (total, update) => total + update.byteLength,
            0,
          );
          pendingSinceRef.current = pendingSince;
          pendingSnapshotRef.current =
            cached.pending && pendingUpdates.length === 0;
          refreshPendingWork();
          baselineRef.current = {
            elements: cached.baselineElements,
            title: cached.baselineTitle,
          };
          publishedBoardRef.current = {
            elements: cached.elements,
            title: cached.title,
          };
          localRef.current = {
            elements: cached.elements,
            title: cached.title,
          };
          remoteCallbackRef.current(cached.elements, cached.title);
          if (updatesExceededAge) {
            cacheBoard(boardId, {
              baselineElements: cached.baselineElements,
              baselineTitle: cached.baselineTitle,
              elements: cached.elements,
              pending: true,
              ...(pendingSince === null ? {} : { pendingSince }),
              pendingUpdates: [],
              title: cached.title,
              updatedAt: Date.now(),
            });
          }
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          if (error instanceof PreservedCloudRecoveryError) {
            preservedRecoveryBoardRef.current = boardId;
          }
          setDeviceRecovery({
            boardId,
            state: 'unavailable',
            version: loadVersion,
          });
        }
      })
      .finally(() => {
        if (!disposed) setCacheReady({ boardId, version: loadVersion });
      });
    return () => {
      disposed = true;
    };
  }, [boardId, cacheBoard, refreshPendingWork]);

  // One effect owns the entire network generation. Creating and disposing the
  // document, Awareness instance, undo manager, timers, and socket together
  // prevents callbacks from a retired board mutating the current board.
  useEffect(() => {
    if (
      boardId === null ||
      cacheReady.boardId !== boardId ||
      cacheReady.version !== cacheLoadVersionRef.current
    )
      return;
    let disposed = false;
    let reconnectTimer: number | null = null;
    const document = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(document);
    const undoManager = createCloudBoardUndoManager(document);
    const updateHistoryAvailability = () => {
      setHistoryAvailability({
        boardId,
        canRedo: undoManager.redoStack.length > 0,
        canUndo: undoManager.undoStack.length > 0,
      });
    };
    undoManager.on('stack-item-added', updateHistoryAvailability);
    undoManager.on('stack-item-popped', updateHistoryAvailability);
    undoManager.on('stack-cleared', updateHistoryAvailability);
    undoManagerRef.current = undoManager;
    awarenessRef.current = awareness;
    if (user !== null) {
      awareness.setLocalStateField('user', {
        color: collaboratorColor(user.id),
        // Identifies the account behind this tab. Board members already see
        // each other's names and addresses.
        id: user.id,
        name: user.displayName,
      });
      awareness.setLocalStateField('selection', selectionRef.current);
    }
    const socket = new WebSocket(collaborationSocketUrl(boardId));
    socket.binaryType = 'arraybuffer';
    documentRef.current = document;
    socketRef.current = socket;
    syncedRef.current = false;
    pendingUpdatesRef.current = 0;
    let pendingAgeTimer: number | null = null;
    let connectionAttemptTimer: number | null = window.setTimeout(() => {
      if (!disposed && !syncedRef.current) socket.close();
    }, CLOUD_CONNECTION_ATTEMPT_TIMEOUT_MS);

    const clearConnectionAttemptTimer = () => {
      if (connectionAttemptTimer === null) return;
      window.clearTimeout(connectionAttemptTimer);
      connectionAttemptTimer = null;
    };
    const clearPendingAgeTimer = () => {
      if (pendingAgeTimer === null) return;
      window.clearTimeout(pendingAgeTimer);
      pendingAgeTimer = null;
    };
    const switchPendingUpdatesToSnapshot = () => {
      pendingRawUpdatesRef.current = [];
      pendingRawUpdateBytesRef.current = 0;
      pendingSnapshotRef.current = true;
      clearPendingAgeTimer();
    };
    const cachePendingSnapshot = () => {
      const current = localRef.current;
      cacheBoard(boardId, {
        baselineElements: baselineRef.current.elements,
        baselineTitle: baselineRef.current.title,
        elements: current.elements,
        pending: true,
        ...(pendingSinceRef.current === null
          ? {}
          : { pendingSince: pendingSinceRef.current }),
        pendingUpdates: [],
        title: current.title,
        updatedAt: Date.now(),
      });
    };
    const schedulePendingAgeLimit = () => {
      clearPendingAgeTimer();
      if (
        pendingSnapshotRef.current ||
        pendingRawUpdatesRef.current.length === 0
      )
        return;
      const now = Date.now();
      pendingSinceRef.current ??= now;
      const age = now - pendingSinceRef.current;
      if (exceedsPendingCloudUpdateAge(pendingSinceRef.current, now)) {
        switchPendingUpdatesToSnapshot();
        cachePendingSnapshot();
        return;
      }
      pendingAgeTimer = window.setTimeout(
        () => {
          pendingAgeTimer = null;
          if (disposed || pendingRawUpdatesRef.current.length === 0) return;
          schedulePendingAgeLimit();
        },
        MAX_PENDING_CLOUD_UPDATE_AGE_MS - Math.max(0, age) + 1,
      );
    };

    // Local Yjs updates are cached before acknowledgement. Once the bounded raw
    // queue cannot represent them safely, recovery switches to a complete
    // semantic snapshot rather than dropping or extending the queue.
    const sendDocumentUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === socket || incompatibleRef.current) return;
      const now = Date.now();
      pendingSinceRef.current ??= now;
      if (
        origin !== CLOUD_BOARD_PENDING_REPLAY_ORIGIN &&
        !pendingSnapshotRef.current
      ) {
        const exceedsRecoveryLimit =
          exceedsPendingCloudUpdateAge(pendingSinceRef.current, now) ||
          exceedsPendingCloudUpdateLimits(
            pendingRawUpdatesRef.current.length,
            pendingRawUpdateBytesRef.current,
            update.byteLength,
          );
        if (exceedsRecoveryLimit) {
          switchPendingUpdatesToSnapshot();
        } else {
          pendingRawUpdatesRef.current.push(new Uint8Array(update));
          pendingRawUpdateBytesRef.current += update.byteLength;
          schedulePendingAgeLimit();
        }
      }
      pendingCacheRef.current = true;
      refreshPendingWork();
      if (socket.readyState !== WebSocket.OPEN) return;
      pendingUpdatesRef.current += 1;
      setState('syncing');
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      socket.send(encoding.toUint8Array(encoder));
    };
    const sendAwarenessUpdate = (
      changes: { added: number[]; removed: number[]; updated: number[] },
      origin: unknown,
    ) => {
      const changed = [
        ...changes.added,
        ...changes.updated,
        ...changes.removed,
      ];
      if (origin !== socket && socket.readyState === WebSocket.OPEN) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
        );
        socket.send(encoding.toUint8Array(encoder));
      }
      const next = projectCollaborators(
        awareness.getStates(),
        awareness.clientID,
        user?.id ?? null,
      );
      setCollaborators(next);
    };
    schedulePendingAgeLimit();
    document.on('update', sendDocumentUpdate);
    awareness.on('update', sendAwarenessUpdate);
    socket.addEventListener('open', () => {
      if (disposed) return;
      sendSyncStep1(socket, document);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, [
          awareness.clientID,
        ]),
      );
      socket.send(encoding.toUint8Array(encoder));
    });
    // Sync messages may reconcile cached work, while acknowledgement messages
    // may clear only the oldest represented pending update. Neither path can
    // infer durability from transport state alone.
    socket.addEventListener('message', (event) => {
      if (disposed) return;
      if (!(event.data instanceof ArrayBuffer)) {
        socket.close(1003, 'Binary collaboration messages are required');
        return;
      }
      const message = new Uint8Array(event.data);
      const decoder = decoding.createDecoder(message);
      const messageType = decoding.readVarUint(decoder);
      if (messageType === COLLABORATION_MESSAGE_ACKNOWLEDGEMENT) {
        const sequence = decoding.readVarUint(decoder);
        const durable = sequence > 0;
        pendingUpdatesRef.current = Math.max(0, pendingUpdatesRef.current - 1);
        if (durable) {
          const acknowledgedUpdate = pendingRawUpdatesRef.current.shift();
          pendingRawUpdateBytesRef.current = Math.max(
            0,
            pendingRawUpdateBytesRef.current -
              (acknowledgedUpdate?.byteLength ?? 0),
          );
        }
        const acknowledged = readCloudBoard(document);
        const fullyAcknowledged =
          durable &&
          pendingUpdatesRef.current === 0 &&
          pendingRawUpdatesRef.current.length === 0;
        pendingCacheRef.current = !fullyAcknowledged;
        refreshPendingWork();
        if (fullyAcknowledged) {
          baselineRef.current = acknowledged;
          pendingSinceRef.current = null;
          pendingSnapshotRef.current = false;
          clearPendingAgeTimer();
        } else {
          pendingSinceRef.current ??= Date.now();
          schedulePendingAgeLimit();
        }
        publishedBoardRef.current = acknowledged;
        cacheBoard(boardId, {
          baselineElements: fullyAcknowledged
            ? acknowledged.elements
            : baselineRef.current.elements,
          baselineTitle: fullyAcknowledged
            ? acknowledged.title
            : baselineRef.current.title,
          elements: acknowledged.elements,
          pending: !fullyAcknowledged,
          ...(fullyAcknowledged || pendingSinceRef.current === null
            ? {}
            : { pendingSince: pendingSinceRef.current }),
          pendingUpdates: pendingRawUpdatesRef.current,
          title: acknowledged.title,
          updatedAt: Date.now(),
        });
        setState(
          pendingUpdatesRef.current > 0
            ? 'syncing'
            : fullyAcknowledged
              ? 'saved'
              : 'connected',
        );
        return;
      }
      if (messageType === COLLABORATION_MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          decoding.readVarUint8Array(decoder),
          socket,
        );
        return;
      }
      if (messageType !== COLLABORATION_MESSAGE_SYNC) return;
      const syncType = decoding.readVarUint(decoding.clone(decoder));
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, document, socket);
      if (!isCloudBoardSchemaSupported(document)) {
        clearConnectionAttemptTimer();
        incompatibleRef.current = true;
        syncedRef.current = true;
        undoManager.clear();
        setState('incompatible');
        return;
      }
      incompatibleRef.current = false;
      if (
        encoding.length(encoder) > 1 &&
        socket.readyState === WebSocket.OPEN
      ) {
        socket.send(encoding.toUint8Array(encoder));
      }
      if (
        !syncedRef.current &&
        (syncType === syncProtocol.messageYjsSyncStep2 ||
          syncType === syncProtocol.messageYjsUpdate)
      ) {
        syncedRef.current = true;
        reconnectFailuresRef.current = 0;
        clearConnectionAttemptTimer();
        let recoveredSnapshotIsDurable = false;
        if (canEdit && pendingRawUpdatesRef.current.length > 0) {
          pendingRawUpdatesRef.current = applyPendingCloudUpdates(
            document,
            pendingRawUpdatesRef.current,
          );
          pendingRawUpdateBytesRef.current =
            pendingRawUpdatesRef.current.reduce(
              (total, update) => total + update.byteLength,
              0,
            );
          pendingCacheRef.current = pendingRawUpdatesRef.current.length > 0;
        }
        const root = document.getMap('board');
        if (canEdit && root.get('initialized') !== true) {
          writeCloudBoard(
            document,
            localRef.current.elements,
            localRef.current.title,
          );
        } else if (
          canEdit &&
          pendingCacheRef.current &&
          pendingRawUpdatesRef.current.length === 0
        ) {
          const remote = readCloudBoard(document);
          recoveredSnapshotIsDurable = boardContentEqual(
            remote,
            localRef.current.elements,
            localRef.current.title,
          );
          if (recoveredSnapshotIsDurable) {
            pendingCacheRef.current = false;
            pendingSinceRef.current = null;
            pendingSnapshotRef.current = false;
            clearPendingAgeTimer();
            baselineRef.current = remote;
          } else {
            applyOfflineBoardDiff(
              document,
              baselineRef.current,
              localRef.current,
            );
          }
        }
        undoManager.clear();
        refreshPendingWork();
        setState(
          canEdit
            ? recoveredSnapshotIsDurable
              ? 'saved'
              : pendingUpdatesRef.current > 0
                ? 'syncing'
                : 'connected'
            : 'read-only',
        );
      }
      if (syncedRef.current) {
        const remote = readCloudBoard(document);
        remoteCallbackRef.current(remote.elements, remote.title);
        publishedBoardRef.current = remote;
        const pending =
          pendingUpdatesRef.current > 0 ||
          pendingRawUpdatesRef.current.length > 0 ||
          pendingCacheRef.current;
        if (!pending) {
          baselineRef.current = remote;
          pendingSinceRef.current = null;
          clearPendingAgeTimer();
        } else {
          pendingSinceRef.current ??= Date.now();
          schedulePendingAgeLimit();
        }
        refreshPendingWork();
        cacheBoard(boardId, {
          baselineElements: pending
            ? baselineRef.current.elements
            : remote.elements,
          baselineTitle: pending ? baselineRef.current.title : remote.title,
          elements: remote.elements,
          pending,
          ...(pendingSinceRef.current === null
            ? {}
            : { pendingSince: pendingSinceRef.current }),
          pendingUpdates: pendingRawUpdatesRef.current,
          title: remote.title,
          updatedAt: Date.now(),
        });
      }
    });
    // Offline time consumes no retry allowance. A successful synchronization
    // resets failures; exhaustion leaves the cached board editable with an
    // explicit retry action.
    const reconnect = (delay: number) => {
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (delay === 0) setState('reconnecting');
      reconnectTimer = window.setTimeout(() => {
        if (disposed) return;
        setState('reconnecting');
        setConnectionAttempt((current) => current + 1);
      }, delay);
    };
    const handleOffline = () => {
      if (disposed) return;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      setState('offline');
      socket.close();
    };
    const handleOnline = () => {
      if (disposed || socket.readyState === WebSocket.OPEN) return;
      reconnectFailuresRef.current = 0;
      reconnect(0);
    };
    socket.addEventListener('close', () => {
      if (disposed) return;
      clearConnectionAttemptTimer();
      // A closed socket is only "offline" when the device says so. While retry
      // budget remains this is a recovering connection, not a lost one, so the
      // status stays on `reconnecting` and never flashes a false disconnection.
      if (!window.navigator.onLine) {
        setState('offline');
        return;
      }
      const nextAttempt = reconnectFailuresRef.current + 1;
      const delay = cloudReconnectDelay(nextAttempt);
      if (delay === null) {
        setState('connection-failed');
        return;
      }
      reconnectFailuresRef.current = nextAttempt;
      setState('reconnecting');
      reconnect(delay);
    });
    socket.addEventListener('error', () => {
      if (!disposed && !window.navigator.onLine) setState('offline');
    });
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      // Mark disposal before closing resources because close/message callbacks
      // may already be queued by the browser.
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      clearConnectionAttemptTimer();
      clearPendingAgeTimer();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      document.off('update', sendDocumentUpdate);
      awareness.off('update', sendAwarenessUpdate);
      socket.close();
      undoManager.off('stack-item-added', updateHistoryAvailability);
      undoManager.off('stack-item-popped', updateHistoryAvailability);
      undoManager.off('stack-cleared', updateHistoryAvailability);
      undoManager.destroy();
      awareness.destroy();
      document.destroy();
      if (documentRef.current === document) documentRef.current = null;
      if (socketRef.current === socket) socketRef.current = null;
      if (awarenessRef.current === awareness) awarenessRef.current = null;
      if (undoManagerRef.current === undoManager) undoManagerRef.current = null;
    };
  }, [
    boardId,
    cacheBoard,
    cacheReady,
    canEdit,
    connectionAttempt,
    refreshPendingWork,
    user,
  ]);

  // Workspace publications become local Yjs transactions only after cache and
  // network setup has selected the same board generation.
  useEffect(() => {
    if (boardId === null || !canEdit || incompatibleRef.current) return;
    const published = publishedBoardRef.current;
    const unchanged = boardContentEqual(published, elements, title);
    const document = documentRef.current;
    if (!syncedRef.current || document === null) {
      if (
        (state === 'offline' || state === 'connection-failed') &&
        !unchanged
      ) {
        pendingCacheRef.current = true;
        pendingSinceRef.current ??= Date.now();
        refreshPendingWork();
        publishedBoardRef.current = { elements, title };
        cacheBoard(boardId, {
          baselineElements: baselineRef.current.elements,
          baselineTitle: baselineRef.current.title,
          elements,
          pending: true,
          ...(pendingSinceRef.current === null
            ? {}
            : { pendingSince: pendingSinceRef.current }),
          pendingUpdates: pendingRawUpdatesRef.current,
          title,
          updatedAt: Date.now(),
        });
      }
      return;
    }
    if (unchanged) {
      publishedBoardRef.current = { elements, title };
      return;
    }
    updateCloudBoard(document, published.elements, elements, title);
    pendingCacheRef.current = true;
    refreshPendingWork();
    publishedBoardRef.current = { elements, title };
    cacheBoard(boardId, {
      baselineElements: baselineRef.current.elements,
      baselineTitle: baselineRef.current.title,
      elements,
      pending: true,
      ...(pendingSinceRef.current === null
        ? {}
        : { pendingSince: pendingSinceRef.current }),
      pendingUpdates: pendingRawUpdatesRef.current,
      title,
      updatedAt: Date.now(),
    });
  }, [
    boardId,
    cacheBoard,
    canEdit,
    elements,
    refreshPendingWork,
    state,
    title,
  ]);

  // Yjs history tracks only local origins, so undo and redo cannot erase a
  // collaborator's accepted transaction.
  const applyHistory = useCallback(
    (direction: 'redo' | 'undo') => {
      if (boardId === null || !canEdit || incompatibleRef.current) return;
      const document = documentRef.current;
      const undoManager = undoManagerRef.current;
      if (document === null || undoManager === null) return;
      if (direction === 'undo') undoManager.undo();
      else undoManager.redo();
      const next = readCloudBoard(document);
      localRef.current = next;
      publishedBoardRef.current = next;
      pendingCacheRef.current = true;
      refreshPendingWork();
      remoteCallbackRef.current(next.elements, next.title);
      cacheBoard(boardId, {
        baselineElements: baselineRef.current.elements,
        baselineTitle: baselineRef.current.title,
        elements: next.elements,
        pending: true,
        ...(pendingSinceRef.current === null
          ? {}
          : { pendingSince: pendingSinceRef.current }),
        pendingUpdates: pendingRawUpdatesRef.current,
        title: next.title,
        updatedAt: Date.now(),
      });
    },
    [boardId, cacheBoard, canEdit, refreshPendingWork],
  );

  const undo = useCallback(() => applyHistory('undo'), [applyHistory]);
  const redo = useCallback(() => applyHistory('redo'), [applyHistory]);
  const retryConnection = useCallback(() => {
    if (boardId === null) return;
    reconnectFailuresRef.current = 0;
    setState('reconnecting');
    setConnectionAttempt((current) => current + 1);
  }, [boardId]);

  const updateSelection = useCallback((selection: string[]) => {
    selectionRef.current = selection;
    awarenessRef.current?.setLocalStateField('selection', selection);
  }, []);

  const updateCursor = useCallback((cursor: Point | null) => {
    pendingCursorRef.current = cursor;
    if (cursorFrameRef.current !== null) return;
    cursorFrameRef.current = window.requestAnimationFrame(() => {
      cursorFrameRef.current = null;
      awarenessRef.current?.setLocalStateField(
        'cursor',
        pendingCursorRef.current,
      );
    });
  }, []);

  useEffect(
    () => () => {
      if (cursorFrameRef.current !== null) {
        window.cancelAnimationFrame(cursorFrameRef.current);
      }
    },
    [],
  );

  const historyIsAvailable =
    historyAvailability.boardId === boardId &&
    canEdit &&
    state !== 'connecting' &&
    state !== 'local' &&
    state !== 'read-only' &&
    state !== 'incompatible';
  return {
    canRedo: historyIsAvailable && historyAvailability.canRedo,
    canUndo: historyIsAvailable && historyAvailability.canUndo,
    collaborators,
    deviceRecoveryState:
      boardId === null
        ? 'available'
        : deviceRecovery.boardId === boardId &&
            deviceRecovery.version === cacheReady.version
          ? deviceRecovery.state
          : 'checking',
    hasPendingWork: boardId !== null && canEdit && pendingWork,
    redo,
    retryConnection,
    state,
    undo,
    updateCursor,
    updateSelection,
  };
}
