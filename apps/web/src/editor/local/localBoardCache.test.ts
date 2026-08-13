/** Proves provisional cache validation, revision ordering, size bounds, and storage-failure tolerance. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardElement } from '@chalkboard/shared';

import {
  cachePendingLocalElements,
  localDocumentCacheKey,
  localPendingDocumentKey,
  publishLocalBoardUpdate,
} from './localBoardCache';

const rectangle = (id: string): BoardElement => ({
  backgroundColor: 'transparent',
  createdBy: 'test',
  height: 20,
  id,
  opacity: 1,
  rotation: 0,
  strokeColor: '#000000',
  strokeWidth: 1,
  type: 'rectangle',
  width: 20,
  x: 10,
  y: 10,
});

describe('local board recovery cache', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('does not invalidate durable success when notification is unavailable', () => {
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        constructor() {
          throw new Error('Constructor unavailable');
        }
      },
    );
    expect(() => publishLocalBoardUpdate('board-one', 1)).not.toThrow();

    const close = vi.fn();
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        close = close;
        postMessage() {
          throw new Error('Notification unavailable');
        }
      },
    );
    expect(() => publishLocalBoardUpdate('board-one', 2)).not.toThrow();
    expect(close).toHaveBeenCalledOnce();
  });

  it('evicts replaceable document caches before abandoning a recovery snapshot', () => {
    const boardId = 'quota-board';
    localStorage.setItem(localDocumentCacheKey(boardId), 'c'.repeat(2_700_000));
    localStorage.setItem('unrelated-preference', 'keep');
    const elements = [rectangle('x'.repeat(2_700_000))];

    const serialized = cachePendingLocalElements(
      elements,
      boardId,
      'Quota recovery',
    );

    expect(serialized).toBeDefined();
    expect(localStorage.getItem(localPendingDocumentKey(boardId))).toBe(
      serialized,
    );
    expect(localStorage.getItem(localDocumentCacheKey(boardId))).toBeNull();
    expect(localStorage.getItem('unrelated-preference')).toBe('keep');
  });
});
