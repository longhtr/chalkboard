/**
 * Bounds CPU- and memory-heavy password hashing across the process. Work above
 * the active limit waits in a finite FIFO queue; excess work is rejected before
 * Argon2 or legacy-scrypt computation begins.
 */
export interface PasswordWorkLimits {
  concurrent: number;
  pending: number;
}

/** Conservative process-wide active and queued password-work bounds. */
export const DEFAULT_PASSWORD_WORK_LIMITS: PasswordWorkLimits = {
  concurrent: 4,
  pending: 16,
};

/** Current admission occupancy together with its configured limits. */
export interface PasswordWorkSnapshot extends PasswordWorkLimits {
  active: number;
  queued: number;
}

/** Signals rejection before expensive password work begins. */
export class PasswordWorkOverloadError extends Error {
  constructor() {
    super('Password work admission is full');
    this.name = 'PasswordWorkOverloadError';
  }
}

interface PendingPasswordWork<T = unknown> {
  reject(error: unknown): void;
  resolve(value: T): void;
  task(): Promise<T>;
}

/** Runs password tasks through one bounded first-in, first-out process queue. */
export class PasswordWorkController {
  private active = 0;
  private readonly queue: PendingPasswordWork[] = [];

  constructor(
    private readonly limits: PasswordWorkLimits = DEFAULT_PASSWORD_WORK_LIMITS,
  ) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.limits.concurrent) return this.start(task);
    if (this.queue.length >= this.limits.pending) {
      return Promise.reject(new PasswordWorkOverloadError());
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        reject,
        resolve: resolve as (value: unknown) => void,
        task,
      });
    });
  }

  snapshot(): PasswordWorkSnapshot {
    return {
      active: this.active,
      concurrent: this.limits.concurrent,
      pending: this.limits.pending,
      queued: this.queue.length,
    };
  }

  private async start<T>(task: () => Promise<T>): Promise<T> {
    this.active += 1;
    try {
      return await task();
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
