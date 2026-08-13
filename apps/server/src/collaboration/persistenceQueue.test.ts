/**
 * Uses controlled promises and timers to prove process leases and per-room
 * persistence jobs preserve FIFO order, bounds, failure, drain, and teardown.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requiredTestValue } from '../test/assertions.js';
import {
  CollaborationProcessPersistenceQueue,
  CollaborationRoomPersistenceQueue,
  type CollaborationPersistenceQueueLimits,
} from './persistenceQueue.js';

const limits: CollaborationPersistenceQueueLimits = {
  maximumAgeMilliseconds: 100,
  processBytes: 15,
  processUpdates: 3,
  roomBytes: 10,
  roomUpdates: 2,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('collaboration persistence queue admission', () => {
  it('bounds room and aggregate process counts and bytes', () => {
    const processQueue = new CollaborationProcessPersistenceQueue(limits);
    const firstRoom = new CollaborationRoomPersistenceQueue(
      processQueue,
      limits,
      () => undefined,
    );
    const secondRoom = new CollaborationRoomPersistenceQueue(
      processQueue,
      limits,
      () => undefined,
    );

    const first = requiredTestValue(
      firstRoom.admit(6, 1_000),
      'first room persistence lease',
    );
    const second = requiredTestValue(
      firstRoom.admit(4, 1_010),
      'second room persistence lease',
    );
    expect(firstRoom.admit(0, 1_020)).toBeNull();
    expect(firstRoom.admit(1, 1_020)).toBeNull();

    const third = requiredTestValue(
      secondRoom.admit(5, 1_020),
      'third room persistence lease',
    );
    expect(secondRoom.admit(1, 1_030)).toBeNull();
    expect(processQueue.snapshot(1_040)).toEqual({
      oldestAgeMilliseconds: 40,
      pendingBytes: 15,
      pendingUpdates: 3,
    });

    first.release();
    const replacement = requiredTestValue(
      secondRoom.admit(1, 1_050),
      'replacement persistence lease',
    );
    expect(processQueue.snapshot(1_060)).toEqual({
      oldestAgeMilliseconds: 50,
      pendingBytes: 10,
      pendingUpdates: 3,
    });

    second.release();
    third.release();
    replacement.release();
    firstRoom.dispose();
    secondRoom.dispose();
    expect(processQueue.snapshot(1_100)).toEqual({
      oldestAgeMilliseconds: 0,
      pendingBytes: 0,
      pendingUpdates: 0,
    });
  });

  it('accepts exact byte boundaries and rejects the next byte', () => {
    const byteLimits = {
      ...limits,
      processUpdates: 10,
      roomUpdates: 10,
    };
    const processQueue = new CollaborationProcessPersistenceQueue(byteLimits);
    const firstRoom = new CollaborationRoomPersistenceQueue(
      processQueue,
      byteLimits,
      () => undefined,
    );
    const secondRoom = new CollaborationRoomPersistenceQueue(
      processQueue,
      byteLimits,
      () => undefined,
    );

    const roomBoundary = requiredTestValue(
      firstRoom.admit(byteLimits.roomBytes),
      'room-boundary persistence lease',
    );
    expect(firstRoom.admit(1)).toBeNull();
    const processBoundary = requiredTestValue(
      secondRoom.admit(byteLimits.processBytes - byteLimits.roomBytes),
      'process-boundary persistence lease',
    );
    expect(secondRoom.admit(1)).toBeNull();

    roomBoundary.release();
    processBoundary.release();
    firstRoom.dispose();
    secondRoom.dispose();
  });

  it('expires a stalled room after the exact age boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    const expired = vi.fn();
    const processQueue = new CollaborationProcessPersistenceQueue(limits);
    const room = new CollaborationRoomPersistenceQueue(
      processQueue,
      limits,
      expired,
    );
    const lease = requiredTestValue(
      room.admit(5),
      'stalled-room persistence lease',
    );

    vi.advanceTimersByTime(limits.maximumAgeMilliseconds);
    expect(expired).not.toHaveBeenCalled();
    expect(room.canAdmit(1)).toBe(true);

    vi.advanceTimersByTime(1);
    expect(expired).toHaveBeenCalledOnce();
    expect(room.canAdmit(1)).toBe(false);
    expect(processQueue.snapshot()).toEqual({
      oldestAgeMilliseconds: 101,
      pendingBytes: 5,
      pendingUpdates: 1,
    });

    lease.release();
    room.dispose();
    expect(processQueue.snapshot()).toEqual({
      oldestAgeMilliseconds: 0,
      pendingBytes: 0,
      pendingUpdates: 0,
    });
  });
});
