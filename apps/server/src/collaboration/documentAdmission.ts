/**
 * Validates the materialized Yjs document, not merely the incoming frame. This
 * catches small updates that expand into excessive elements, nesting, text, or
 * encoded state before the room accepts or persists them.
 */
import type { PersistedYjsRoom } from './persistence.js';

/** Byte and update-count limits for incoming and stored Yjs room state. */
export interface CollaborationDocumentLimits {
  documentBytes: number;
  loadedBytes: number;
  loadedUpdates: number;
  updateBytes: number;
}

/** Conservative limits for updates, snapshots, and loaded update tails. */
export const DEFAULT_COLLABORATION_DOCUMENT_LIMITS: CollaborationDocumentLimits =
  {
    documentBytes: 16 * 1_024 * 1_024,
    loadedBytes: 32 * 1_024 * 1_024,
    loadedUpdates: 1_000,
    updateBytes: 900_000,
  };

/** Signals that an update, snapshot, or loaded room exceeds document policy. */
export class CollaborationDocumentLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CollaborationDocumentLimitError';
  }
}

/** Rejects oversized persisted snapshots or update tails before materialization. */
export function validatePersistedYjsRoom(
  stored: PersistedYjsRoom,
  limits: CollaborationDocumentLimits,
): void {
  const snapshotBytes = stored.snapshot?.byteLength ?? 0;
  if (
    snapshotBytes > limits.documentBytes ||
    snapshotBytes > limits.loadedBytes
  ) {
    throw new CollaborationDocumentLimitError(
      'Stored Yjs snapshot exceeds the document byte limit',
    );
  }
  if (stored.updates.length > limits.loadedUpdates) {
    throw new CollaborationDocumentLimitError(
      'Stored Yjs update count exceeds the room-load limit',
    );
  }
  let loadedBytes = snapshotBytes;
  for (const entry of stored.updates) {
    if (entry.update.byteLength > limits.updateBytes) {
      throw new CollaborationDocumentLimitError(
        'Stored Yjs update exceeds the update byte limit',
      );
    }
    loadedBytes += entry.update.byteLength;
    if (loadedBytes > limits.loadedBytes) {
      throw new CollaborationDocumentLimitError(
        'Stored Yjs room exceeds the room-load byte limit',
      );
    }
  }
}

/** Tracks a conservative encoded-size upper bound between room compactions. */
export class CollaborationDocumentAdmission {
  private compactedThroughBytes = 0;
  private cumulativeUpdateBytes = 0;

  constructor(
    private compactedDocumentBytes: number,
    private readonly limits: CollaborationDocumentLimits,
  ) {
    if (compactedDocumentBytes > limits.documentBytes) {
      throw new CollaborationDocumentLimitError(
        'Yjs document exceeds the document byte limit',
      );
    }
  }

  get checkpoint(): number {
    return this.cumulativeUpdateBytes;
  }

  get upperBoundBytes(): number {
    return (
      this.compactedDocumentBytes +
      this.cumulativeUpdateBytes -
      this.compactedThroughBytes
    );
  }

  canAdmit(updateBytes: number): boolean {
    return (
      updateBytes >= 0 &&
      updateBytes <= this.limits.updateBytes &&
      this.upperBoundBytes + updateBytes <= this.limits.documentBytes
    );
  }

  admit(updateBytes: number): number {
    if (!this.canAdmit(updateBytes)) {
      throw new CollaborationDocumentLimitError(
        'Yjs update exceeds the update or document byte limit',
      );
    }
    this.cumulativeUpdateBytes += updateBytes;
    return this.cumulativeUpdateBytes;
  }

  canCompact(snapshotBytes: number): boolean {
    return snapshotBytes >= 0 && snapshotBytes <= this.limits.documentBytes;
  }

  compact(snapshotBytes: number, throughUpdateBytes: number): void {
    if (!this.canCompact(snapshotBytes)) {
      throw new CollaborationDocumentLimitError(
        'Yjs snapshot exceeds the document byte limit',
      );
    }
    if (
      throughUpdateBytes < this.compactedThroughBytes ||
      throughUpdateBytes > this.cumulativeUpdateBytes
    ) {
      throw new Error('Invalid Yjs document compaction checkpoint');
    }
    this.compactedDocumentBytes = snapshotBytes;
    this.compactedThroughBytes = throughUpdateBytes;
  }
}
