/** Proves hydration, save ordering, coalescing, recovery, cross-tab replacement, and storage error transitions. */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardElement } from '@chalkboard/shared';

import { requiredTestValue } from '../../test/assertions';
import { localPendingBoardPatchKey } from './localBoardPatchRecovery';
import {
  localDocumentCacheKey,
  localPendingDocumentKey,
} from './localBoardCache';
import { useBoardPersistence } from './useBoardPersistence';

const rectangle: BoardElement = {
  backgroundColor: 'transparent',
  createdBy: 'test',
  cornerRadius: 0,
  height: 20,
  id: 'rectangle',
  opacity: 1,
  rotation: 0,
  shapeKind: 'rectangle',
  strokeColor: '#000000',
  strokeWidth: 1,
  type: 'shape',
  width: 20,
  x: 10,
  y: 10,
};

const repository = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn().mockResolvedValue({ committed: true }),
}));

vi.mock('./localBoardRepository', () => ({
  localBoardRepository: repository,
}));

class TestBroadcastChannel {
  static instances: TestBroadcastChannel[] = [];
  private listeners = new Set<(event: MessageEvent<unknown>) => void>();

  constructor() {
    TestBroadcastChannel.instances.push(this);
  }

  addEventListener(
    _type: string,
    listener: (event: MessageEvent<unknown>) => void,
  ) {
    this.listeners.add(listener);
  }

  close() {}

  dispatch(data: unknown) {
    for (const listener of this.listeners)
      listener(new MessageEvent('message', { data }));
  }

  removeEventListener(
    _type: string,
    listener: (event: MessageEvent<unknown>) => void,
  ) {
    this.listeners.delete(listener);
  }
}

describe('useBoardPersistence', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    TestBroadcastChannel.instances = [];
  });

  it('reuses an explicit equation commit instead of queuing it again after render', async () => {
    repository.read.mockResolvedValue({ id: 'existing' });
    const onStorageError = vi.fn();
    const onStorageRecovered = vi.fn();
    const { result, rerender } = renderHook(
      ({ elements, title }: { elements: BoardElement[]; title: string }) =>
        useBoardPersistence({
          elements,
          forceInitialSave: false,
          hydrateFromIndexedDb: false,
          localBoardId: 'board-one',
          onExternalBoard: vi.fn(),
          onStorageError,
          onStorageRecovered,
          title,
        }),
      { initialProps: { elements: [rectangle], title: 'Board one' } },
    );
    await waitFor(() => expect(onStorageRecovered).toHaveBeenCalledOnce());

    const nextElements = [{ ...rectangle, x: 40 }];
    act(() => result.current.persistBoard(nextElements));
    rerender({ elements: nextElements, title: 'Board one' });

    await waitFor(() => expect(repository.write).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onStorageRecovered).toHaveBeenCalledTimes(2));
    expect(repository.write).toHaveBeenCalledWith(
      'board-one',
      expect.objectContaining({ elements: nextElements, title: 'Board one' }),
    );
    expect(
      requiredTestValue(repository.write.mock.calls[0], 'first board write')[1],
    ).not.toHaveProperty('serializedElementsForCaches');
    expect(
      localStorage.getItem(localPendingBoardPatchKey('board-one')),
    ).not.toBeNull();
    expect(
      localStorage.getItem(localPendingDocumentKey('board-one')),
    ).toBeNull();
    expect(onStorageError).not.toHaveBeenCalled();
  });

  it('reconciles a stale local write to the newer durable revision', async () => {
    const durable = {
      createdAt: 1,
      elements: [{ ...rectangle, x: 90 }],
      mixedContentByElementId: {},
      title: 'Durable winner',
      updatedAt: 20,
    };
    repository.write.mockResolvedValueOnce({
      committed: false,
      current: durable,
    });
    const onExternalBoard = vi.fn();
    const onStorageError = vi.fn();
    const onStorageRecovered = vi.fn();
    renderHook(() =>
      useBoardPersistence({
        elements: [rectangle],
        forceInitialSave: true,
        hydrateFromIndexedDb: false,
        localBoardId: 'stale-board',
        onExternalBoard,
        onStorageError,
        onStorageRecovered,
        title: 'Stale editor',
      }),
    );

    await waitFor(() => expect(onExternalBoard).toHaveBeenCalledWith(durable));
    expect(onStorageRecovered).toHaveBeenCalledOnce();
    expect(onStorageError).not.toHaveBeenCalled();
  });

  it('does not suppress a newer title after an explicit element commit', async () => {
    repository.read.mockResolvedValue({ id: 'existing' });
    const { result, rerender } = renderHook(
      ({ elements, title }: { elements: BoardElement[]; title: string }) =>
        useBoardPersistence({
          elements,
          forceInitialSave: false,
          hydrateFromIndexedDb: false,
          localBoardId: 'board-title',
          onExternalBoard: vi.fn(),
          onStorageError: vi.fn(),
          onStorageRecovered: vi.fn(),
          title,
        }),
      { initialProps: { elements: [] as BoardElement[], title: 'Before' } },
    );
    await waitFor(() => expect(repository.read).toHaveBeenCalled());

    const nextElements = [rectangle];
    act(() => result.current.persistBoard(nextElements));
    rerender({ elements: nextElements, title: 'After' });

    await waitFor(() => expect(repository.write).toHaveBeenCalledTimes(2));
    expect(
      requiredTestValue(
        repository.write.mock.calls[1],
        'second board write',
      )[1],
    ).toEqual(
      expect.objectContaining({ elements: [rectangle], title: 'After' }),
    );
  });

  it('treats compatibility storage events only as durable refresh notifications', async () => {
    const durable = {
      createdAt: 1,
      elements: [{ ...rectangle, x: 80 }],
      mixedContentByElementId: {},
      title: 'Durable title',
      updatedAt: 10,
    };
    repository.read.mockResolvedValue(durable);
    const onExternalBoard = vi.fn();
    renderHook(() =>
      useBoardPersistence({
        elements: [],
        forceInitialSave: false,
        hydrateFromIndexedDb: false,
        localBoardId: 'board-one',
        onExternalBoard,
        onStorageError: vi.fn(),
        onStorageRecovered: vi.fn(),
        title: 'Before',
      }),
    );
    await waitFor(() => expect(repository.read).toHaveBeenCalledOnce());

    const cacheKey = localDocumentCacheKey('board-one');
    localStorage.setItem(cacheKey, JSON.stringify([{ ...rectangle, x: 999 }]));
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: cacheKey,
          newValue: localStorage.getItem(cacheKey),
        }),
      );
    });

    await waitFor(() => expect(onExternalBoard).toHaveBeenCalledWith(durable));
    expect(localStorage.getItem(cacheKey)).toBe(
      JSON.stringify(durable.elements),
    );
    expect(onExternalBoard).not.toHaveBeenCalledWith(
      expect.objectContaining({
        elements: [expect.objectContaining({ x: 999 })],
      }),
    );

    repository.read.mockResolvedValue({ ...durable, updatedAt: 9 });
    const readsBeforeStaleEvent = repository.read.mock.calls.length;
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: cacheKey,
          newValue: JSON.stringify([{ ...rectangle, x: 1_000 }]),
        }),
      );
    });
    await waitFor(() =>
      expect(repository.read.mock.calls.length).toBeGreaterThan(
        readsBeforeStaleEvent,
      ),
    );
    expect(onExternalBoard).toHaveBeenCalledOnce();
  });

  it('reports when another tab trashes or permanently deletes the open board', async () => {
    vi.stubGlobal('BroadcastChannel', TestBroadcastChannel);
    repository.read.mockResolvedValue(null);
    const onExternalBoardUnavailable = vi.fn();
    renderHook(() =>
      useBoardPersistence({
        elements: [],
        forceInitialSave: true,
        hydrateFromIndexedDb: false,
        localBoardId: 'board-one',
        onExternalBoard: vi.fn(),
        onExternalBoardUnavailable,
        onStorageError: vi.fn(),
        onStorageRecovered: vi.fn(),
        title: 'Board one',
      }),
    );

    act(() => {
      requiredTestValue(
        TestBroadcastChannel.instances[0],
        'board deletion broadcast channel',
      ).dispatch({
        boardId: 'board-one',
        updatedAt: Number.MAX_SAFE_INTEGER,
      });
    });

    await waitFor(() =>
      expect(onExternalBoardUnavailable).toHaveBeenCalledOnce(),
    );
  });

  it('reports a failed cross-tab IndexedDB refresh', async () => {
    vi.stubGlobal('BroadcastChannel', TestBroadcastChannel);
    const failure = new Error('IndexedDB refresh failed');
    repository.read.mockRejectedValueOnce(failure);
    const onStorageError = vi.fn();
    const { unmount } = renderHook(() =>
      useBoardPersistence({
        elements: [],
        forceInitialSave: true,
        hydrateFromIndexedDb: false,
        localBoardId: 'board-one',
        onExternalBoard: vi.fn(),
        onStorageError,
        onStorageRecovered: vi.fn(),
        title: 'Board one',
      }),
    );

    expect(TestBroadcastChannel.instances).toHaveLength(1);
    act(() => {
      requiredTestValue(
        TestBroadcastChannel.instances[0],
        'board refresh broadcast channel',
      ).dispatch({
        boardId: 'board-one',
        updatedAt: Number.MAX_SAFE_INTEGER,
      });
    });

    await waitFor(() => expect(onStorageError).toHaveBeenCalledWith(failure));
    unmount();
  });
});
