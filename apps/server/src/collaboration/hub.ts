/**
 * Registry and lifecycle owner for in-memory collaboration rooms. It serializes
 * room creation per board, enforces process-wide capacity, and drains every
 * accepted room before shutdown completes.
 */
import type { RawData, WebSocket } from 'ws';

import { OperationalMetrics } from '../operations/metrics.js';
import {
  CollaborationCompactionController,
  DEFAULT_COLLABORATION_COMPACTION_LIMITS,
  type CollaborationCompactionLimits,
  type CollaborationCompactionSnapshot,
} from './compactionController.js';
import {
  DEFAULT_COLLABORATION_DOCUMENT_LIMITS,
  type CollaborationDocumentLimits,
} from './documentAdmission.js';
import type { CollaborationPersistence } from './persistence.js';
import {
  CollaborationProcessPersistenceQueue,
  DEFAULT_COLLABORATION_PERSISTENCE_QUEUE_LIMITS,
  type CollaborationPersistenceQueueLimits,
  type CollaborationPersistenceQueueSnapshot,
} from './persistenceQueue.js';
import { CollaborationRoom, loadCollaborationRoom } from './room.js';

/** Default durable update-tail count that schedules room compaction. */
export const DEFAULT_COMPACTION_UPDATE_THRESHOLD = 100;
const COLLABORATION_MESSAGE_WINDOW_MS = 10_000;
/** Per-connection message allowance within one admission window. */
export const MAX_COLLABORATION_MESSAGES_PER_WINDOW = 600;
const MAX_COLLABORATION_BYTES_PER_WINDOW = 4 * 1_024 * 1_024;
/** Maximum frames buffered while a room is loading or authorizing. */
export const MAX_QUEUED_COLLABORATION_MESSAGES = 256;
const MAX_QUEUED_COLLABORATION_BYTES = 1 * 1_024 * 1_024;

function rawDataBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

interface CollaborationRoomSlot {
  retirement: Promise<void> | null;
  room: Promise<CollaborationRoom>;
}

interface CollaborationHubOptions {
  compactionLimits?: CollaborationCompactionLimits;
  compactionUpdateThreshold?: number;
  documentLimits?: CollaborationDocumentLimits;
  metrics?: OperationalMetrics;
  onOperationalError?(event: string, error: unknown): void;
  persistence?: CollaborationPersistence | undefined;
  persistenceQueueLimits?: CollaborationPersistenceQueueLimits;
}

/**
 * Ensures there is at most one loading, active, or retiring room per board.
 * Connection messages are bounded while load is pending and transferred to the
 * room only after that exact slot is still current.
 */
export class CollaborationHub {
  private readonly compactionController: CollaborationCompactionController;
  private readonly compactionUpdateThreshold: number;
  private readonly documentLimits: CollaborationDocumentLimits;
  private destroying = false;
  private readonly metrics: OperationalMetrics;
  private readonly onOperationalError: (event: string, error: unknown) => void;
  private readonly persistence: CollaborationPersistence | undefined;
  private readonly persistenceQueueLimits: CollaborationPersistenceQueueLimits;
  private readonly processPersistenceQueue: CollaborationProcessPersistenceQueue;
  private readonly rooms = new Map<string, CollaborationRoomSlot>();

  constructor(options: CollaborationHubOptions = {}) {
    const {
      compactionLimits = DEFAULT_COLLABORATION_COMPACTION_LIMITS,
      compactionUpdateThreshold = DEFAULT_COMPACTION_UPDATE_THRESHOLD,
      documentLimits = DEFAULT_COLLABORATION_DOCUMENT_LIMITS,
      metrics = new OperationalMetrics(),
      onOperationalError = () => undefined,
      persistence,
      persistenceQueueLimits = DEFAULT_COLLABORATION_PERSISTENCE_QUEUE_LIMITS,
    } = options;
    this.compactionUpdateThreshold = compactionUpdateThreshold;
    this.documentLimits = documentLimits;
    this.metrics = metrics;
    this.onOperationalError = onOperationalError;
    this.persistence = persistence;
    this.persistenceQueueLimits = persistenceQueueLimits;
    this.compactionController = new CollaborationCompactionController(
      compactionLimits,
    );
    this.processPersistenceQueue = new CollaborationProcessPersistenceQueue(
      persistenceQueueLimits,
    );
  }

  get activeRoomCount(): number {
    return this.rooms.size;
  }

  get compactionSnapshot(): CollaborationCompactionSnapshot {
    return this.compactionController.snapshot();
  }

  get persistenceQueueSnapshot(): CollaborationPersistenceQueueSnapshot {
    return this.processPersistenceQueue.snapshot();
  }

  private createRoom(
    boardId: string,
    documentByteLimit?: number,
  ): CollaborationRoomSlot {
    const documentLimits =
      documentByteLimit === undefined
        ? this.documentLimits
        : {
            ...this.documentLimits,
            documentBytes: Math.min(
              this.documentLimits.documentBytes,
              documentByteLimit,
            ),
            loadedBytes: Math.min(
              this.documentLimits.loadedBytes,
              documentByteLimit,
            ),
            updateBytes: Math.min(
              this.documentLimits.updateBytes,
              documentByteLimit,
            ),
          };
    const slot: CollaborationRoomSlot = {
      retirement: null,
      room: loadCollaborationRoom({
        boardId,
        compactionController: this.compactionController,
        compactionUpdateThreshold: this.compactionUpdateThreshold,
        documentLimits,
        metrics: this.metrics,
        onOperationalError: this.onOperationalError,
        persistence: this.persistence,
        persistenceQueueLimits: this.persistenceQueueLimits,
        processPersistenceQueue: this.processPersistenceQueue,
      }),
    };
    this.rooms.set(boardId, slot);
    void slot.room.catch((error: unknown) => {
      this.onOperationalError('collaboration.room-load', error);
      if (this.rooms.get(boardId) === slot && slot.retirement === null) {
        this.rooms.delete(boardId);
      }
    });
    return slot;
  }

  /** Retirement stays in the map until its final compaction finishes. */
  private retireIfEmpty(
    boardId: string,
    slot: CollaborationRoomSlot,
    room: CollaborationRoom,
  ): void {
    if (
      room.connections.size > 0 ||
      slot.retirement !== null ||
      this.rooms.get(boardId) !== slot
    ) {
      return;
    }
    const retirement = room.destroy().catch((error: unknown) => {
      this.onOperationalError('collaboration.room-retirement', error);
      // Retire the failed room after recording its bounded diagnostic.
    });
    slot.retirement = retirement;
    void retirement.finally(() => {
      if (this.rooms.get(boardId) === slot) this.rooms.delete(boardId);
    });
  }

  async connect(
    boardId: string,
    socket: WebSocket,
    canEdit: boolean | (() => boolean) = true,
    admitUpdate: () => boolean = () => true,
    documentByteLimit?: number,
  ): Promise<void> {
    if (this.destroying) {
      socket.close(1012, 'Server is restarting');
      return;
    }

    // The gateway can deliver traffic before PostgreSQL reconstructs the room.
    // Keep that interval bounded independently from the active message window.
    const queuedMessages: Uint8Array[] = [];
    let queuedMessageBytes = 0;
    let closed = socket.readyState !== socket.OPEN;
    let messageWindowStartedAt = Date.now();
    let messageWindowBytes = 0;
    let messageWindowCount = 0;
    let connectedRoom: CollaborationRoom | null = null;
    let connectedSlot: CollaborationRoomSlot | null = null;
    let receiveMessage: ((data: RawData, isBinary: boolean) => void) | null =
      null;
    const acceptMessage = (byteLength: number): boolean => {
      if (closed) return false;
      const now = Date.now();
      if (now - messageWindowStartedAt >= COLLABORATION_MESSAGE_WINDOW_MS) {
        messageWindowStartedAt = now;
        messageWindowBytes = 0;
        messageWindowCount = 0;
      }
      messageWindowBytes += byteLength;
      messageWindowCount += 1;
      if (
        messageWindowBytes <= MAX_COLLABORATION_BYTES_PER_WINDOW &&
        messageWindowCount <= MAX_COLLABORATION_MESSAGES_PER_WINDOW
      ) {
        return true;
      }
      closed = true;
      this.metrics.recordCollaborationPolicyRejection();
      socket.close(1008, 'Collaboration message rate exceeded');
      return false;
    };
    const queueMessage = (data: RawData, isBinary: boolean) => {
      if (closed) return;
      if (!isBinary) {
        closed = true;
        this.metrics.recordCollaborationPolicyRejection();
        socket.close(1003, 'Binary collaboration messages are required');
        return;
      }
      const message = rawDataBytes(data);
      if (!acceptMessage(message.byteLength)) return;
      if (
        queuedMessages.length >= MAX_QUEUED_COLLABORATION_MESSAGES ||
        queuedMessageBytes + message.byteLength > MAX_QUEUED_COLLABORATION_BYTES
      ) {
        closed = true;
        queuedMessages.length = 0;
        queuedMessageBytes = 0;
        this.metrics.recordCollaborationPolicyRejection();
        socket.close(1008, 'Collaboration load queue exceeded');
        return;
      }
      queuedMessages.push(new Uint8Array(message));
      queuedMessageBytes += message.byteLength;
    };
    const handleClose = () => {
      closed = true;
      queuedMessages.length = 0;
      queuedMessageBytes = 0;
      socket.off('message', queueMessage);
      if (receiveMessage !== null) socket.off('message', receiveMessage);
      if (connectedRoom !== null && connectedSlot !== null) {
        connectedRoom.disconnect(socket);
        this.retireIfEmpty(boardId, connectedSlot, connectedRoom);
      }
    };
    socket.on('message', queueMessage);
    socket.once('close', handleClose);

    try {
      while (!closed && !this.destroying) {
        const slot =
          this.rooms.get(boardId) ??
          this.createRoom(boardId, documentByteLimit);
        if (slot.retirement !== null) {
          await slot.retirement;
          if (this.rooms.get(boardId) === slot) this.rooms.delete(boardId);
          continue;
        }

        const room = await slot.room;
        if (slot.retirement !== null) {
          await slot.retirement;
          if (this.rooms.get(boardId) === slot) this.rooms.delete(boardId);
          continue;
        }
        if (closed || socket.readyState !== socket.OPEN || this.destroying) {
          this.retireIfEmpty(boardId, slot, room);
          return;
        }

        socket.off('message', queueMessage);
        try {
          room.connect(socket, queuedMessages, canEdit, admitUpdate);
          queuedMessages.length = 0;
          queuedMessageBytes = 0;
        } catch {
          this.metrics.recordCollaborationPolicyRejection();
          socket.close(1003, 'Invalid collaboration message');
          room.disconnect(socket);
          this.retireIfEmpty(boardId, slot, room);
          return;
        }
        connectedRoom = room;
        connectedSlot = slot;
        const handleRoomMessage = (data: RawData, isBinary: boolean) => {
          if (!isBinary) {
            closed = true;
            socket.off('message', handleRoomMessage);
            this.metrics.recordCollaborationPolicyRejection();
            socket.close(1003, 'Binary collaboration messages are required');
            return;
          }
          const message = rawDataBytes(data);
          if (!acceptMessage(message.byteLength)) return;
          try {
            room.receive(socket, message);
          } catch {
            closed = true;
            socket.off('message', handleRoomMessage);
            this.metrics.recordCollaborationPolicyRejection();
            socket.close(1003, 'Invalid collaboration message');
          }
        };
        receiveMessage = handleRoomMessage;
        socket.on('message', handleRoomMessage);
        return;
      }
    } finally {
      socket.off('message', queueMessage);
    }
  }

  /** Prevents new connections, then drains every room exactly once. */
  async destroy(): Promise<void> {
    if (this.destroying) return;
    this.destroying = true;
    const slots = [...this.rooms.values()];
    await Promise.all(
      slots.map(async (slot) => {
        if (slot.retirement !== null) {
          await slot.retirement;
          return;
        }
        const room = await slot.room.catch(() => null);
        await room?.destroy().catch((error: unknown) => {
          this.onOperationalError('collaboration.room-drain', error);
          // Continue draining independent rooms after recording the failure.
        });
      }),
    );
    this.rooms.clear();
  }
}
