/**
 * WebSocket trust boundary. It validates origin, path, session, board role, and
 * connection admission before handing an upgraded socket to the room hub; it
 * also propagates session and board authorization invalidation.
 */
import type { FastifyInstance } from 'fastify';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';

import { createRateLimiter, requestOriginIsAllowed } from '../api/security.js';
import { logOperationalError } from '../operations/errorDiagnostics.js';
import {
  OperationalMetrics,
  type CollaborationMetricsSnapshot,
} from '../operations/metrics.js';
import {
  readSessionToken,
  type CollaborationAuthorization,
} from './authorization.js';
import { createGenerationTracker } from './generationTracker.js';
import {
  DEFAULT_COLLABORATION_COMPACTION_LIMITS,
  type CollaborationCompactionLimits,
} from './compactionController.js';
import {
  DEFAULT_COLLABORATION_DOCUMENT_LIMITS,
  type CollaborationDocumentLimits,
} from './documentAdmission.js';
import {
  CollaborationHub,
  DEFAULT_COMPACTION_UPDATE_THRESHOLD,
} from './hub.js';
import type { CollaborationPersistence } from './persistence.js';
import {
  DEFAULT_COLLABORATION_PERSISTENCE_QUEUE_LIMITS,
  type CollaborationPersistenceQueueLimits,
} from './persistenceQueue.js';

const COLLABORATION_BOARD_PATH = /^\/collaboration\/([^/]{1,128})$/;
const BOARD_ID_SCHEMA = z.uuid();
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_COLLABORATION_CLIENTS = 1_000;
/** Maximum simultaneous WebSocket peers admitted for one opaque session. */
export const MAX_COLLABORATION_CONNECTIONS_PER_SESSION = 16;
/** Maximum live sockets sharing one public demo identity. */
export const MAX_DEMO_COLLABORATION_CONNECTIONS_PER_USER = 32;
/** Maximum live sockets across all public demo identities. */
const MAX_DEMO_COLLABORATION_CONNECTIONS = 100;
/** Maximum accepted Yjs updates per demo identity in one minute. */
const MAX_DEMO_COLLABORATION_UPDATES_PER_MINUTE = 600;
/** Maximum accepted Yjs updates across all demos in one minute. */
const MAX_DEMO_COLLABORATION_UPDATES_PER_MINUTE_GLOBAL = 2_000;
/** Maximum materialized state admitted for a public demo board. */
const MAX_DEMO_COLLABORATION_DOCUMENT_BYTES = 1 * 1_024 * 1_024;

/** Drain and authorization-invalidation controls exposed to HTTP routes. */
export interface CollaborationGatewayControl {
  beginDrain(): void;
  invalidateBoard(boardId: string): void;
  invalidateSession(sessionToken: string): void;
  invalidateUser(userId: string): void;
  metricsSnapshot(): CollaborationMetricsSnapshot;
}

interface CollaborationGatewayOptions {
  authorization?: CollaborationAuthorization | undefined;
  compactionLimits?: CollaborationCompactionLimits;
  compactionUpdateThreshold?: number;
  documentLimits?: CollaborationDocumentLimits;
  metrics?: OperationalMetrics;
  persistence?: CollaborationPersistence | undefined;
  persistenceQueueLimits?: CollaborationPersistenceQueueLimits;
  publicOrigin?: string | null;
}

/**
 * Owns WebSocket upgrade admission before handing accepted binary traffic to
 * the room hub. Origin, session, role, identity, and connection limits are
 * checked independently of browser state.
 */
export function installCollaborationGateway(
  app: FastifyInstance,
  options: CollaborationGatewayOptions = {},
): CollaborationGatewayControl {
  const {
    authorization,
    compactionLimits = DEFAULT_COLLABORATION_COMPACTION_LIMITS,
    compactionUpdateThreshold = DEFAULT_COMPACTION_UPDATE_THRESHOLD,
    documentLimits = DEFAULT_COLLABORATION_DOCUMENT_LIMITS,
    metrics = new OperationalMetrics(),
    persistence,
    persistenceQueueLimits = DEFAULT_COLLABORATION_PERSISTENCE_QUEUE_LIMITS,
    publicOrigin = null,
  } = options;
  const reportedOperationalErrors = new WeakSet<object>();
  const hub = new CollaborationHub({
    compactionLimits,
    compactionUpdateThreshold,
    documentLimits,
    metrics,
    onOperationalError: (event, error) => {
      if (typeof error === 'object' && error !== null) {
        if (reportedOperationalErrors.has(error)) return;
        reportedOperationalErrors.add(error);
      }
      logOperationalError(app.log, event, error);
    },
    persistence,
    persistenceQueueLimits,
  });
  const server = new WebSocketServer({ maxPayload: 1_000_000, noServer: true });
  const pendingSessionConnections = new Map<string, number>();
  const connections = new Map<
    WebSocket,
    {
      boardId: string;
      isDemo: boolean;
      sessionToken: string | null;
      userId: string | null;
    }
  >();
  const activeBoards = new Map<string, number>();
  const activeSessions = new Map<string, number>();
  const activeDemoUsers = new Map<string, number>();
  const pendingDemoUsers = new Map<string, number>();
  let activeDemoConnections = 0;
  let pendingDemoConnections = 0;
  const boardGenerations = createGenerationTracker({
    isProtected: (boardId) => activeBoards.has(boardId),
    maximumEntries: 4_096,
  });
  const sessionGenerations = createGenerationTracker({
    isProtected: (sessionToken) => activeSessions.has(sessionToken),
    maximumEntries: 4_096,
  });
  const increment = (counts: Map<string, number>, key: string) =>
    counts.set(key, (counts.get(key) ?? 0) + 1);
  const decrement = (counts: Map<string, number>, key: string) => {
    const count = counts.get(key) ?? 0;
    if (count <= 1) counts.delete(key);
    else counts.set(key, count - 1);
  };
  const liveClients = new WeakSet<WebSocket>();
  const limitUpgrades = createRateLimiter({ limit: 120, windowMs: 60_000 });
  const limitDemoUserUpdates = createRateLimiter({
    limit: MAX_DEMO_COLLABORATION_UPDATES_PER_MINUTE,
    windowMs: 60_000,
  });
  const limitDemoGlobalUpdates = createRateLimiter({
    limit: MAX_DEMO_COLLABORATION_UPDATES_PER_MINUTE_GLOBAL,
    windowMs: 60_000,
  });
  const reserveDemoConnection = (userId: string): (() => void) | null => {
    const userConnections =
      (activeDemoUsers.get(userId) ?? 0) + (pendingDemoUsers.get(userId) ?? 0);
    if (
      userConnections >= MAX_DEMO_COLLABORATION_CONNECTIONS_PER_USER ||
      activeDemoConnections + pendingDemoConnections >=
        MAX_DEMO_COLLABORATION_CONNECTIONS
    ) {
      return null;
    }
    increment(pendingDemoUsers, userId);
    pendingDemoConnections += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      decrement(pendingDemoUsers, userId);
      pendingDemoConnections = Math.max(0, pendingDemoConnections - 1);
    };
  };
  let draining = false;
  const reject = (
    socket: Duplex,
    status: 400 | 401 | 403 | 429 | 503,
    label: string,
  ) => {
    socket.write(
      `HTTP/1.1 ${status} ${label}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
    socket.destroy();
  };
  const handleUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    const rejectUpgrade = (
      status: 400 | 401 | 403 | 429 | 503,
      label: string,
    ) => reject(socket, status, label);
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const match = path.match(COLLABORATION_BOARD_PATH);
    const boardId = match?.[1];
    if (boardId === undefined) {
      socket.destroy();
      return;
    }
    if (!BOARD_ID_SCHEMA.safeParse(boardId).success) {
      rejectUpgrade(400, 'Bad Request');
      return;
    }
    const rate = limitUpgrades(
      `collaboration:${request.socket.remoteAddress ?? 'unknown'}`,
    );
    if (!rate.allowed) {
      rejectUpgrade(429, 'Too Many Requests');
      return;
    }
    if (draining) {
      rejectUpgrade(503, 'Service Unavailable');
      return;
    }
    if (server.clients.size >= MAX_COLLABORATION_CLIENTS) {
      metrics.recordCollaborationPolicyRejection();
      rejectUpgrade(503, 'Service Unavailable');
      return;
    }
    const forwardedHostHeader = request.headers['x-forwarded-host'];
    const forwardedHost = Array.isArray(forwardedHostHeader)
      ? forwardedHostHeader[0]
      : forwardedHostHeader;
    if (
      !requestOriginIsAllowed({
        ...(publicOrigin === null ? {} : { expectedOrigin: publicOrigin }),
        ...(forwardedHost === undefined ? {} : { forwardedHost }),
        ...(request.headers.host === undefined
          ? {}
          : { host: request.headers.host }),
        ...(request.headers.origin === undefined
          ? {}
          : { origin: request.headers.origin }),
      })
    ) {
      rejectUpgrade(403, 'Forbidden');
      return;
    }
    const upgrade = (options: {
      admitUpdate?: () => boolean;
      canEdit: boolean | (() => boolean);
      isDemo?: boolean;
      releaseDemoReservation?: () => void;
      releaseReservation?: () => void;
      sessionToken: string | null;
      userId: string | null;
    }) => {
      const {
        admitUpdate = () => true,
        canEdit,
        isDemo = false,
        releaseDemoReservation = () => undefined,
        releaseReservation = () => undefined,
        sessionToken,
        userId,
      } = options;
      server.handleUpgrade(request, socket, head, (webSocket) => {
        releaseDemoReservation();
        connections.set(webSocket, {
          boardId,
          isDemo,
          sessionToken,
          userId,
        });
        increment(activeBoards, boardId);
        if (sessionToken !== null) increment(activeSessions, sessionToken);
        if (isDemo && userId !== null) {
          increment(activeDemoUsers, userId);
          activeDemoConnections += 1;
        }
        releaseReservation();
        liveClients.add(webSocket);
        webSocket.on('pong', () => liveClients.add(webSocket));
        webSocket.once('close', () => {
          connections.delete(webSocket);
          decrement(activeBoards, boardId);
          if (sessionToken !== null) decrement(activeSessions, sessionToken);
          if (isDemo && userId !== null) {
            decrement(activeDemoUsers, userId);
            activeDemoConnections = Math.max(0, activeDemoConnections - 1);
          }
        });
        server.emit('connection', webSocket, request);
        void hub
          .connect(
            boardId,
            webSocket,
            canEdit,
            admitUpdate,
            isDemo ? MAX_DEMO_COLLABORATION_DOCUMENT_BYTES : undefined,
            // Binds published presence identity to the authenticated account,
            // so a peer cannot claim another member's and disappear from that
            // member's participant list and overlay.
            userId,
          )
          .catch(() => {
            // The hub records the bounded room failure once without board data.
            webSocket.close(1011, 'Collaboration room failed to load');
          });
      });
    };
    if (authorization === undefined) {
      upgrade({ canEdit: true, sessionToken: null, userId: null });
      return;
    }
    const token = readSessionToken(request.headers.cookie);
    if (token === null) {
      metrics.recordAuthenticationFailure();
      rejectUpgrade(401, 'Unauthorized');
      return;
    }
    let activeSessionConnections = 0;
    for (const connection of connections.values()) {
      if (connection.sessionToken === token) activeSessionConnections += 1;
    }
    const pendingConnections = pendingSessionConnections.get(token) ?? 0;
    if (
      activeSessionConnections + pendingConnections >=
      MAX_COLLABORATION_CONNECTIONS_PER_SESSION
    ) {
      metrics.recordCollaborationPolicyRejection();
      rejectUpgrade(429, 'Too Many Requests');
      return;
    }
    pendingSessionConnections.set(token, pendingConnections + 1);
    let reservationReleased = false;
    const releaseReservation = () => {
      if (reservationReleased) return;
      reservationReleased = true;
      const current = pendingSessionConnections.get(token) ?? 0;
      if (current <= 1) pendingSessionConnections.delete(token);
      else pendingSessionConnections.set(token, current - 1);
    };
    socket.once('close', releaseReservation);

    const authorizeAndUpgrade = () => {
      const boardGeneration = boardGenerations.current(boardId);
      const sessionGeneration = sessionGenerations.current(token);
      void Promise.resolve()
        .then(() => authorization.authorize(boardId, token))
        .then((authorized) => {
          if (draining) {
            releaseReservation();
            rejectUpgrade(503, 'Service Unavailable');
            return;
          }
          if (socket.destroyed) {
            releaseReservation();
            return;
          }
          if (
            boardGeneration !== boardGenerations.current(boardId) ||
            sessionGeneration !== sessionGenerations.current(token)
          ) {
            authorizeAndUpgrade();
            return;
          }
          if (authorized === null) {
            releaseReservation();
            metrics.recordAuthenticationFailure();
            rejectUpgrade(403, 'Forbidden');
            return;
          }
          const role =
            typeof authorized === 'string' ? authorized : authorized.role;
          const userId =
            typeof authorized === 'string' ? null : authorized.userId;
          const isDemo =
            typeof authorized === 'string' ? false : authorized.isDemo;
          const releaseDemoReservation =
            isDemo && userId !== null
              ? reserveDemoConnection(userId)
              : undefined;
          if (isDemo && releaseDemoReservation === null) {
            releaseReservation();
            metrics.recordCollaborationPolicyRejection();
            rejectUpgrade(429, 'Too Many Requests');
            return;
          }
          if (typeof releaseDemoReservation === 'function') {
            socket.once('close', releaseDemoReservation);
          }
          const admitUpdate =
            isDemo && userId !== null
              ? () => {
                  const userRate = limitDemoUserUpdates(`demo:${userId}`);
                  if (!userRate.allowed) return false;
                  return limitDemoGlobalUpdates('demo:global').allowed;
                }
              : () => true;
          upgrade({
            admitUpdate,
            canEdit:
              role === 'viewer'
                ? false
                : () =>
                    boardGeneration === boardGenerations.current(boardId) &&
                    sessionGeneration === sessionGenerations.current(token),
            isDemo,
            ...(typeof releaseDemoReservation === 'function'
              ? { releaseDemoReservation }
              : {}),
            releaseReservation,
            sessionToken: token,
            userId,
          });
        })
        .catch((error: unknown) => {
          releaseReservation();
          metrics.recordStorageFailure();
          logOperationalError(app.log, 'collaboration.authorization', error);
          socket.destroy();
        });
    };
    authorizeAndUpgrade();
  };
  const heartbeat = setInterval(() => {
    for (const client of server.clients) {
      if (!liveClients.has(client)) {
        client.terminate();
        continue;
      }
      liveClients.delete(client);
      client.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  app.server.on('upgrade', handleUpgrade);
  app.addHook('onClose', async () => {
    draining = true;
    clearInterval(heartbeat);
    app.server.off('upgrade', handleUpgrade);
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await hub.destroy();
  });
  return {
    beginDrain() {
      if (draining) return;
      draining = true;
      for (const client of server.clients) {
        client.close(1012, 'Server is restarting');
      }
    },
    invalidateBoard(boardId) {
      boardGenerations.advance(boardId);
      for (const [client, connection] of connections) {
        if (connection.boardId === boardId) {
          client.close(1008, 'Board access changed');
        }
      }
    },
    invalidateSession(sessionToken) {
      sessionGenerations.advance(sessionToken);
      for (const [client, connection] of connections) {
        if (connection.sessionToken === sessionToken) {
          client.close(1008, 'Session ended');
        }
      }
    },
    invalidateUser(userId) {
      for (const [client, connection] of connections) {
        if (connection.userId === userId) {
          if (connection.sessionToken !== null) {
            sessionGenerations.advance(connection.sessionToken);
          }
          client.close(1008, 'Account credentials changed');
        }
      }
    },
    metricsSnapshot() {
      const compaction = hub.compactionSnapshot;
      const persistenceQueue = hub.persistenceQueueSnapshot;
      return {
        activeClients: server.clients.size,
        activeCompactions: compaction.active,
        activeRooms: hub.activeRoomCount,
        oldestPendingPersistenceAgeMilliseconds:
          persistenceQueue.oldestAgeMilliseconds,
        pendingCompactions: compaction.pending,
        pendingPersistenceBytes: persistenceQueue.pendingBytes,
        pendingPersistenceWrites: persistenceQueue.pendingUpdates,
      };
    },
  };
}
