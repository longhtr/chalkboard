/**
 * Owns one board's in-memory Yjs document, connected clients, Awareness state,
 * persistence queue, durable acknowledgements, compaction, and retirement.
 * Every accepted mutation is serialized through this single room lifetime.
 */
import {
  COLLABORATION_MESSAGE_ACKNOWLEDGEMENT,
  COLLABORATION_MESSAGE_AWARENESS,
  COLLABORATION_MESSAGE_SYNC,
} from '@chalkboard/shared';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import type { WebSocket } from 'ws';
import * as Y from 'yjs';

import { OperationalMetrics } from '../operations/metrics.js';
import {
  CollaborationAwarenessAdmission,
  CollaborationAwarenessAdmissionError,
} from './awarenessAdmission.js';
import {
  CollaborationCompactionController,
  CollaborationCompactionOverloadError,
} from './compactionController.js';
import {
  CollaborationDocumentAdmission,
  CollaborationDocumentLimitError,
  validatePersistedYjsRoom,
  type CollaborationDocumentLimits,
} from './documentAdmission.js';
import type { CollaborationPersistence } from './persistence.js';
import {
  CollaborationRoomPersistenceQueue,
  type CollaborationProcessPersistenceQueue,
  type CollaborationPersistenceQueueLimits,
} from './persistenceQueue.js';

interface CollaborationRoomOptions {
  boardId: string;
  compactionController: CollaborationCompactionController;
  compactionUpdateThreshold: number;
  document: Y.Doc;
  documentAdmission: CollaborationDocumentAdmission;
  lastCompactedSequence: number;
  lastSequence: number;
  metrics: OperationalMetrics;
  persistence: CollaborationPersistence | undefined;
  persistenceQueueLimits: CollaborationPersistenceQueueLimits;
  processPersistenceQueue: CollaborationProcessPersistenceQueue;
  updatesSinceCompaction: number;
}

interface LoadCollaborationRoomOptions {
  boardId: string;
  compactionController: CollaborationCompactionController;
  compactionUpdateThreshold: number;
  documentLimits: CollaborationDocumentLimits;
  metrics: OperationalMetrics;
  persistence: CollaborationPersistence | undefined;
  persistenceQueueLimits: CollaborationPersistenceQueueLimits;
  processPersistenceQueue: CollaborationProcessPersistenceQueue;
}

function send(socket: WebSocket, message: Uint8Array): void {
  if (socket.readyState === socket.OPEN) socket.send(message);
}

function syncMessage(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

function acknowledgementMessage(sequence: number): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_ACKNOWLEDGEMENT);
  encoding.writeVarUint(encoder, sequence);
  return encoding.toUint8Array(encoder);
}

/** Owns one materialized Yjs document, its peers, and ordered persistence lifetime. */
export class CollaborationRoom {
  readonly awareness: awarenessProtocol.Awareness;
  private readonly awarenessAdmission =
    new CollaborationAwarenessAdmission<WebSocket>();
  readonly boardId: string;
  private readonly compactionController: CollaborationCompactionController;
  private readonly compactionUpdateThreshold: number;
  readonly connections = new Map<
    WebSocket,
    { awarenessClients: Set<number>; canEdit(): boolean }
  >();
  private destruction: Promise<void> | null = null;
  readonly document: Y.Doc;
  private readonly documentAdmission: CollaborationDocumentAdmission;
  private lastCompactedSequence: number;
  private lastSequence: number;
  private readonly metrics: OperationalMetrics;
  private readonly pendingPersistence: CollaborationRoomPersistenceQueue;
  private readonly persistence: CollaborationPersistence | undefined;
  private persistenceChain: Promise<void> = Promise.resolve();
  private persistenceFailure: unknown = null;
  private updatesSinceCompaction: number;

  constructor(options: CollaborationRoomOptions) {
    this.boardId = options.boardId;
    this.compactionController = options.compactionController;
    this.compactionUpdateThreshold = options.compactionUpdateThreshold;
    this.document = options.document;
    this.documentAdmission = options.documentAdmission;
    this.lastCompactedSequence = options.lastCompactedSequence;
    this.lastSequence = options.lastSequence;
    this.metrics = options.metrics;
    this.persistence = options.persistence;
    this.updatesSinceCompaction = options.updatesSinceCompaction;
    this.pendingPersistence = new CollaborationRoomPersistenceQueue(
      options.processPersistenceQueue,
      options.persistenceQueueLimits,
      () => {
        this.metrics.recordCollaborationPersistenceOverload();
        for (const socket of this.connections.keys()) {
          socket.close(1013, 'Collaboration persistence is delayed');
        }
      },
    );
    this.awareness = new awarenessProtocol.Awareness(this.document);
    this.awareness.setLocalState(null);
    // Admission occurs in the synchronous Yjs update callback, before relay.
    // Persistence then chains from the same accepted update so sequence order,
    // acknowledgement order, and compaction boundaries cannot diverge.
    this.document.on('update', (update: Uint8Array, origin: unknown) => {
      const source = this.connections.has(origin as WebSocket)
        ? (origin as WebSocket)
        : null;
      let compactionCheckpoint: number;
      try {
        compactionCheckpoint = this.documentAdmission.admit(update.byteLength);
      } catch (error) {
        this.metrics.recordCollaborationDocumentLimitRejection();
        this.persistenceFailure = error;
        for (const socket of this.connections.keys()) {
          socket.close(1009, 'Collaboration document limit exceeded');
        }
        return;
      }
      const queueLease =
        this.persistence === undefined
          ? null
          : this.pendingPersistence.admit(update.byteLength);
      if (this.persistence !== undefined && queueLease === null) {
        this.metrics.recordCollaborationPersistenceOverload();
        this.persistenceFailure = new Error(
          'Collaboration persistence admission invariant failed',
        );
        for (const socket of this.connections.keys()) {
          socket.close(1013, 'Collaboration persistence queue is full');
        }
        return;
      }
      let compactionSnapshot: Uint8Array | null = null;
      if (this.persistence !== undefined) {
        this.updatesSinceCompaction += 1;
        if (this.updatesSinceCompaction >= this.compactionUpdateThreshold) {
          compactionSnapshot = Y.encodeStateAsUpdate(this.document);
          if (
            !this.documentAdmission.canCompact(compactionSnapshot.byteLength)
          ) {
            queueLease?.release();
            this.metrics.recordCollaborationDocumentLimitRejection();
            this.persistenceFailure = new CollaborationDocumentLimitError(
              'Yjs snapshot exceeds the document byte limit',
            );
            for (const socket of this.connections.keys()) {
              socket.close(1009, 'Collaboration document limit exceeded');
            }
            return;
          }
          this.updatesSinceCompaction = 0;
        }
      }
      this.metrics.recordYjsUpdate();
      const message = syncMessage(update);
      for (const socket of this.connections.keys()) {
        if (socket !== origin) send(socket, message);
      }
      const persistence = this.persistence;
      if (persistence === undefined || queueLease === null) {
        if (source !== null) send(source, acknowledgementMessage(0));
        return;
      }
      this.persistenceChain = this.persistenceChain
        .then(async () => {
          this.lastSequence = await persistence.appendUpdate(
            this.boardId,
            update,
          );
          this.metrics.recordAppend();
          if (source !== null && this.connections.has(source)) {
            send(source, acknowledgementMessage(this.lastSequence));
          }
          if (compactionSnapshot !== null) {
            const snapshot = compactionSnapshot;
            await this.compactPersistedDocument(snapshot, this.lastSequence);
            this.documentAdmission.compact(
              snapshot.byteLength,
              compactionCheckpoint,
            );
            this.metrics.recordCompaction();
            this.lastCompactedSequence = this.lastSequence;
          }
        })
        .catch((error: unknown) => {
          if (error instanceof CollaborationCompactionOverloadError) {
            this.metrics.recordCollaborationCompactionOverload();
          } else {
            this.metrics.recordStorageFailure();
          }
          this.persistenceFailure = error;
          for (const socket of this.connections.keys()) {
            socket.close(
              error instanceof CollaborationCompactionOverloadError
                ? 1013
                : 1011,
              error instanceof CollaborationCompactionOverloadError
                ? 'Collaboration compaction queue is full'
                : 'Collaboration persistence failed',
            );
          }
        })
        .finally(() => queueLease.release());
    });
    // Awareness is ephemeral and connection-owned. The admission plan is
    // committed only after Yjs accepts the update, then relayed to every peer.
    this.awareness.on(
      'update',
      (
        changes: { added: number[]; removed: number[]; updated: number[] },
        origin: unknown,
      ) => {
        const controlled = this.connections.get(origin as WebSocket);
        if (controlled !== undefined) {
          for (const client of [...changes.added, ...changes.updated]) {
            controlled.awarenessClients.add(client);
          }
          for (const client of changes.removed) {
            controlled.awarenessClients.delete(client);
          }
        }
        this.awarenessAdmission.remove(changes.removed);
        const changed = [
          ...changes.added,
          ...changes.updated,
          ...changes.removed,
        ];
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
        );
        const message = encoding.toUint8Array(encoder);
        for (const socket of this.connections.keys()) send(socket, message);
      },
    );
  }

  /**
   * Publishes the current document and presence before replaying messages that
   * arrived while the room was loading. Viewers receive state without entering
   * the writable Yjs handshake.
   */
  connect(
    socket: WebSocket,
    queuedMessages: Uint8Array[],
    canEdit: boolean | (() => boolean),
  ): void {
    const canEditNow = typeof canEdit === 'function' ? canEdit : () => canEdit;
    this.connections.set(socket, {
      awarenessClients: new Set(),
      canEdit: canEditNow,
    });
    if (canEditNow()) {
      const syncEncoder = encoding.createEncoder();
      encoding.writeVarUint(syncEncoder, COLLABORATION_MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(syncEncoder, this.document);
      send(socket, encoding.toUint8Array(syncEncoder));
    } else {
      send(socket, syncMessage(Y.encodeStateAsUpdate(this.document)));
    }
    const awarenessClients = [...this.awareness.getStates().keys()];
    if (awarenessClients.length > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, COLLABORATION_MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(
          this.awareness,
          awarenessClients,
        ),
      );
      send(socket, encoding.toUint8Array(awarenessEncoder));
    }
    for (const message of queuedMessages) this.receive(socket, message);
  }

  /** Validates policy and capacity before allowing Yjs to mutate room state. */
  receive(socket: WebSocket, message: Uint8Array): void {
    const decoder = decoding.createDecoder(message);
    const type = decoding.readVarUint(decoder);
    if (type === COLLABORATION_MESSAGE_SYNC) {
      const connection = this.connections.get(socket);
      const updateDecoder = decoding.clone(decoder);
      const syncType = decoding.readVarUint(updateDecoder);
      if (
        connection?.canEdit() === false &&
        syncType !== syncProtocol.messageYjsSyncStep1
      ) {
        this.metrics.recordCollaborationPolicyRejection();
        socket.close(1008, 'Viewer connections are read-only');
        return;
      }
      if (
        syncType === syncProtocol.messageYjsSyncStep2 ||
        syncType === syncProtocol.messageYjsUpdate
      ) {
        const update = decoding.readVarUint8Array(updateDecoder);
        if (!this.documentAdmission.canAdmit(update.byteLength)) {
          this.metrics.recordCollaborationDocumentLimitRejection();
          socket.close(1009, 'Collaboration document limit exceeded');
          return;
        }
        if (
          this.persistence !== undefined &&
          !this.pendingPersistence.canAdmit(update.byteLength)
        ) {
          this.metrics.recordCollaborationPersistenceOverload();
          socket.close(1013, 'Collaboration persistence queue is full');
          return;
        }
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, this.document, socket);
      if (encoding.length(encoder) > 1) {
        send(socket, encoding.toUint8Array(encoder));
      }
    } else if (type === COLLABORATION_MESSAGE_AWARENESS) {
      const controlled = this.connections.get(socket);
      if (controlled === undefined) {
        socket.close(1008, 'Collaboration connection is not active');
        return;
      }
      const update = decoding.readVarUint8Array(decoder);
      const owners = new Map<number, WebSocket>();
      for (const [connection, state] of this.connections) {
        for (const clientId of state.awarenessClients) {
          owners.set(clientId, connection);
        }
      }
      try {
        const plan = this.awarenessAdmission.inspect(
          update,
          controlled.awarenessClients,
          owners,
          socket,
          this.awareness,
        );
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, socket);
        this.awarenessAdmission.commit(plan, this.awareness);
      } catch (error) {
        if (!(error instanceof CollaborationAwarenessAdmissionError)) {
          throw error;
        }
        this.metrics.recordCollaborationAwarenessRejection();
        socket.close(
          error.kind === 'size' ? 1009 : 1008,
          error.kind === 'size'
            ? 'Collaboration awareness limit exceeded'
            : 'Collaboration awareness policy rejected',
        );
      }
    } else {
      throw new Error('Unknown collaboration message type');
    }
  }

  disconnect(socket: WebSocket): void {
    const controlled = this.connections.get(socket);
    this.connections.delete(socket);
    if (controlled !== undefined && controlled.awarenessClients.size > 0) {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        [...controlled.awarenessClients],
        socket,
      );
    }
  }

  destroy(): Promise<void> {
    if (this.destruction !== null) return this.destruction;
    this.destruction = this.destroyNow();
    return this.destruction;
  }

  private async compactPersistedDocument(
    snapshot: Uint8Array,
    sequence: number,
  ): Promise<void> {
    const persistence = this.persistence;
    if (persistence === undefined) {
      throw new Error('Cannot compact without collaboration persistence');
    }
    await this.compactionController.run(() =>
      persistence.compact(this.boardId, snapshot, sequence),
    );
  }

  /**
   * Drains every accepted append and writes a final snapshot before destroying
   * the document. Failure remains visible to the hub even after clients close.
   */
  private async destroyNow(): Promise<void> {
    this.awareness.destroy();
    try {
      await this.persistenceChain;
      this.pendingPersistence.dispose();
      if (this.persistenceFailure !== null) throw this.persistenceFailure;
      if (
        this.persistence !== undefined &&
        this.lastSequence > this.lastCompactedSequence
      ) {
        const snapshot = Y.encodeStateAsUpdate(this.document);
        // Read with the snapshot, never after the await: the checkpoint must
        // name the update bytes this snapshot actually absorbed, and a late
        // admission would otherwise be recorded as already compacted.
        const checkpoint = this.documentAdmission.checkpoint;
        if (!this.documentAdmission.canCompact(snapshot.byteLength)) {
          this.metrics.recordCollaborationDocumentLimitRejection();
          throw new CollaborationDocumentLimitError(
            'Yjs snapshot exceeds the document byte limit',
          );
        }
        try {
          await this.compactPersistedDocument(snapshot, this.lastSequence);
          this.documentAdmission.compact(snapshot.byteLength, checkpoint);
          this.metrics.recordCompaction();
        } catch (error) {
          if (error instanceof CollaborationCompactionOverloadError) {
            this.metrics.recordCollaborationCompactionOverload();
          } else {
            this.metrics.recordStorageFailure();
          }
          throw error;
        }
      }
    } finally {
      this.pendingPersistence.dispose();
      this.document.destroy();
    }
  }
}

/** Reconstructs one bounded, internally consistent snapshot-and-tail view. */
export async function loadCollaborationRoom(
  options: LoadCollaborationRoomOptions,
): Promise<CollaborationRoom> {
  const {
    boardId,
    compactionController,
    compactionUpdateThreshold,
    documentLimits,
    metrics,
    persistence,
    persistenceQueueLimits,
    processPersistenceQueue,
  } = options;
  const document = new Y.Doc();
  let loadedSequence = 0;
  let snapshotSequence = 0;
  let updatesSinceCompaction = 0;
  try {
    if (persistence !== undefined) {
      const stored = await persistence.loadRoom(boardId);
      validatePersistedYjsRoom(stored, documentLimits);
      snapshotSequence = stored.snapshotSequence;
      updatesSinceCompaction = stored.updates.length;
      if (stored.snapshot !== null) Y.applyUpdate(document, stored.snapshot);
      for (const entry of stored.updates) {
        Y.applyUpdate(document, entry.update);
        loadedSequence = Math.max(loadedSequence, entry.sequence);
      }
      loadedSequence = Math.max(loadedSequence, stored.snapshotSequence);
    }
    const encodedDocumentBytes = Y.encodeStateAsUpdate(document).byteLength;
    if (encodedDocumentBytes > documentLimits.documentBytes) {
      throw new CollaborationDocumentLimitError(
        'Stored Yjs document exceeds the document byte limit',
      );
    }
    return new CollaborationRoom({
      boardId,
      compactionController,
      compactionUpdateThreshold,
      document,
      documentAdmission: new CollaborationDocumentAdmission(
        encodedDocumentBytes,
        documentLimits,
      ),
      lastCompactedSequence: snapshotSequence,
      lastSequence: loadedSequence,
      metrics,
      persistence,
      persistenceQueueLimits,
      processPersistenceQueue,
      updatesSinceCompaction,
    });
  } catch (error) {
    if (error instanceof CollaborationDocumentLimitError) {
      metrics.recordCollaborationDocumentLimitRejection();
    } else {
      metrics.recordStorageFailure();
    }
    document.destroy();
    throw error;
  }
}
