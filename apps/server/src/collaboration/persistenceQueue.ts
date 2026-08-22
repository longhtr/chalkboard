/**
 * Provides two levels of persistence serialization: a process-wide lease
 * bounds total queued bytes/operations, and a room queue preserves append and
 * compaction order for one board. Closing waits for accepted work to drain.
 */
export interface CollaborationPersistenceQueueLimits {
  maximumAgeMilliseconds: number;
  processBytes: number;
  processUpdates: number;
  roomBytes: number;
  roomUpdates: number;
}

/** Process, room, byte, count, and age defaults for accepted persistence work. */
export const DEFAULT_COLLABORATION_PERSISTENCE_QUEUE_LIMITS: CollaborationPersistenceQueueLimits =
  {
    maximumAgeMilliseconds: 30_000,
    processBytes: 64 * 1_024 * 1_024,
    processUpdates: 4_096,
    roomBytes: 8 * 1_024 * 1_024,
    roomUpdates: 256,
  };

/** Current process-wide queued work and oldest accepted-work age. */
export interface CollaborationPersistenceQueueSnapshot {
  oldestAgeMilliseconds: number;
  pendingBytes: number;
  pendingUpdates: number;
}

interface ProcessLease {
  release(): void;
}

interface RoomLease {
  bytes: number;
  enqueuedAt: number;
  processLease: ProcessLease;
  released: boolean;
}

/** Leases process-wide byte and update capacity to individual rooms. */
export class CollaborationProcessPersistenceQueue {
  private readonly pending = new Set<RoomLease>();
  private pendingBytes = 0;

  constructor(private readonly limits: CollaborationPersistenceQueueLimits) {}

  canAdmit(bytes: number): boolean {
    return (
      bytes >= 0 &&
      this.pending.size < this.limits.processUpdates &&
      this.pendingBytes + bytes <= this.limits.processBytes
    );
  }

  admit(record: RoomLease): ProcessLease | null {
    if (!this.canAdmit(record.bytes)) return null;
    this.pending.add(record);
    this.pendingBytes += record.bytes;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        if (!this.pending.delete(record)) return;
        this.pendingBytes = Math.max(0, this.pendingBytes - record.bytes);
      },
    };
  }

  snapshot(now = Date.now()): CollaborationPersistenceQueueSnapshot {
    let oldestEnqueuedAt = now;
    for (const record of this.pending) {
      oldestEnqueuedAt = Math.min(oldestEnqueuedAt, record.enqueuedAt);
    }
    return {
      oldestAgeMilliseconds:
        this.pending.size === 0 ? 0 : Math.max(0, now - oldestEnqueuedAt),
      pendingBytes: this.pendingBytes,
      pendingUpdates: this.pending.size,
    };
  }
}

/** Preserves one room's persistence order and expires over-age work. */
export class CollaborationRoomPersistenceQueue {
  private ageTimer: ReturnType<typeof setTimeout> | null = null;
  private expired = false;
  private readonly pending: RoomLease[] = [];
  private pendingBytes = 0;

  constructor(
    private readonly processQueue: CollaborationProcessPersistenceQueue,
    private readonly limits: CollaborationPersistenceQueueLimits,
    private readonly onExpired: () => void,
  ) {}

  canAdmit(bytes: number): boolean {
    return (
      !this.expired &&
      bytes >= 0 &&
      this.pending.length < this.limits.roomUpdates &&
      this.pendingBytes + bytes <= this.limits.roomBytes &&
      this.processQueue.canAdmit(bytes)
    );
  }

  admit(bytes: number, now = Date.now()): { release(): void } | null {
    if (!this.canAdmit(bytes)) return null;
    const record: RoomLease = {
      bytes,
      enqueuedAt: now,
      processLease: { release: () => undefined },
      released: false,
    };
    const processLease = this.processQueue.admit(record);
    if (processLease === null) return null;
    record.processLease = processLease;
    this.pending.push(record);
    this.pendingBytes += bytes;
    this.scheduleAgeTimer(now);
    return {
      release: () => this.release(record),
    };
  }

  dispose(): void {
    if (this.ageTimer !== null) clearTimeout(this.ageTimer);
    this.ageTimer = null;
  }

  private release(record: RoomLease): void {
    if (record.released) return;
    record.released = true;
    const index = this.pending.indexOf(record);
    if (index !== -1) this.pending.splice(index, 1);
    this.pendingBytes = Math.max(0, this.pendingBytes - record.bytes);
    record.processLease.release();
    this.scheduleAgeTimer();
  }

  private scheduleAgeTimer(now = Date.now()): void {
    if (this.ageTimer !== null) clearTimeout(this.ageTimer);
    this.ageTimer = null;
    const oldest = this.pending[0];
    if (this.expired || oldest === undefined) return;
    const elapsed = Math.max(0, now - oldest.enqueuedAt);
    const delay = Math.max(1, this.limits.maximumAgeMilliseconds - elapsed + 1);
    this.ageTimer = setTimeout(() => {
      this.ageTimer = null;
      const currentOldest = this.pending[0];
      if (currentOldest === undefined || this.expired) return;
      if (
        Date.now() - currentOldest.enqueuedAt <=
        this.limits.maximumAgeMilliseconds
      ) {
        this.scheduleAgeTimer();
        return;
      }
      this.expired = true;
      this.onExpired();
    }, delay);
    this.ageTimer.unref?.();
  }
}
