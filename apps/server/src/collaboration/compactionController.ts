/**
 * Bounds process-wide Yjs compaction work. A room leases capacity before it
 * materializes a new snapshot and releases that capacity in `finally`, so one
 * large or failed room cannot permanently block every other room.
 */
export interface CollaborationCompactionLimits {
  concurrent: number;
  pending: number;
}

/** Process-wide active and pending snapshot-work defaults. */
export const DEFAULT_COLLABORATION_COMPACTION_LIMITS: CollaborationCompactionLimits =
  {
    concurrent: 4,
    pending: 64,
  };

/** Current active and queued compaction occupancy. */
export interface CollaborationCompactionSnapshot {
  active: number;
  pending: number;
}

/** Signals rejection before snapshot materialization begins. */
export class CollaborationCompactionOverloadError extends Error {
  constructor() {
    super('Collaboration compaction admission is full');
    this.name = 'CollaborationCompactionOverloadError';
  }
}

interface PendingCompaction {
  reject(error: unknown): void;
  resolve(): void;
  task(): Promise<void>;
}

/** Runs snapshot tasks through one bounded first-in, first-out process queue. */
export class CollaborationCompactionController {
  private active = 0;
  private readonly queue: PendingCompaction[] = [];

  constructor(private readonly limits: CollaborationCompactionLimits) {}

  run(task: () => Promise<void>): Promise<void> {
    if (this.active < this.limits.concurrent) {
      return this.start(task);
    }
    if (this.queue.length >= this.limits.pending) {
      return Promise.reject(new CollaborationCompactionOverloadError());
    }
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ reject, resolve, task });
    });
  }

  snapshot(): CollaborationCompactionSnapshot {
    return { active: this.active, pending: this.queue.length };
  }

  private async start(task: () => Promise<void>): Promise<void> {
    this.active += 1;
    try {
      await task();
    } finally {
      this.active -= 1;
      this.startNext();
    }
  }

  private startNext(): void {
    while (this.active < this.limits.concurrent) {
      const next = this.queue.shift();
      if (next === undefined) return;
      void this.start(next.task).then(next.resolve, next.reject);
    }
  }
}
