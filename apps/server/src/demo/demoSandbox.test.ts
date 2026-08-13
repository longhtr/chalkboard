/** Proves daily demo maintenance runs at UTC rollover, retries, and stops cleanly. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  startDemoSandboxMaintenance,
  type DemoSandboxService,
} from './demoSandbox.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('demo sandbox maintenance scheduler', () => {
  it('catches up at startup and schedules the next UTC day without overlap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T23:59:00.000Z'));
    let resolveFirst!: (value: null) => void;
    const resetIfDue = vi
      .fn<DemoSandboxService['resetIfDue']>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(null);
    const stop = startDemoSandboxMaintenance({
      onError: vi.fn(),
      onReset: vi.fn(),
      service: { resetIfDue, status: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(resetIfDue).toHaveBeenCalledOnce();
    resolveFirst(null);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resetIfDue).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(resetIfDue).toHaveBeenCalledTimes(2);
  });

  it('retries a failed transaction on the bounded retry interval', async () => {
    vi.useFakeTimers();
    const error = new Error('database unavailable');
    const onError = vi.fn();
    const resetIfDue = vi
      .fn<DemoSandboxService['resetIfDue']>()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(null);
    const stop = startDemoSandboxMaintenance({
      onError,
      onReset: vi.fn(),
      retryIntervalMs: 1_000,
      service: { resetIfDue, status: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(error);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(resetIfDue).toHaveBeenCalledTimes(2);
    stop();
  });
});
