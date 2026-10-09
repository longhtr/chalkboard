/** Cut preserves its captured objects before any asynchronous clipboard prompt. */
import { DEFAULT_ELEMENT_STYLE, type BoardElement } from '@chalkboard/shared';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { copyTextToClipboard } from '../../clipboard';
import type { Tool } from '../interaction/toolModel';
import { useObjectClipboard } from './useObjectClipboard';

vi.mock('../../clipboard', () => ({ copyTextToClipboard: vi.fn() }));

const rectangle = (id: string, x: number): BoardElement => ({
  ...DEFAULT_ELEMENT_STYLE,
  createdBy: 'local',
  height: 80,
  id,
  rotation: 0,
  type: 'rectangle',
  width: 120,
  x,
  y: 10,
});

const options = (elements: BoardElement[]) => ({
  activeToolRef: { current: 'selection' as Tool },
  commitElements: vi.fn(() => true),
  elements,
  rejectBoardElementLimit: vi.fn(),
  reportOperationLimit: vi.fn(),
  selectedIdSet: new Set(['a']),
  setActiveTool: vi.fn(),
  setRecentlyCreatedId: vi.fn(),
  setSelectedIds: vi.fn(),
});

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
});

describe('object cut', () => {
  it('cuts immediately, retains its undo target, and cannot delete a later edit when permission resolves', async () => {
    let finishCopy!: () => void;
    vi.mocked(copyTextToClipboard).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCopy = resolve;
        }),
    );
    const a = rectangle('a', 10);
    const b = rectangle('b', 200);
    const initial = options([a, b]);
    const { result, rerender } = renderHook(useObjectClipboard, {
      initialProps: initial,
    });
    act(() => {
      expect(result.current.cutSelectedObjects()).toBe(true);
    });
    expect(initial.commitElements).toHaveBeenCalledExactlyOnceWith([b]);
    expect(initial.setSelectedIds).toHaveBeenCalledWith(['a']);
    expect(copyTextToClipboard).toHaveBeenCalledOnce();
    const editedB = { ...b, x: 999 };
    rerender({
      ...initial,
      elements: [editedB],
      selectedIdSet: new Set(['b']),
    });
    await act(async () => {
      finishCopy();
      await Promise.resolve();
    });
    expect(initial.commitElements).toHaveBeenCalledTimes(1);
    act(() => {
      expect(result.current.pasteCopiedObjects()).toBe(true);
    });
    expect(initial.commitElements).toHaveBeenLastCalledWith([
      editedB,
      { ...a, id: expect.any(String), x: 30, y: 30 },
    ]);
  });

  it('keeps cut objects pasteable when system clipboard access fails', async () => {
    vi.mocked(copyTextToClipboard).mockRejectedValue(new Error('Denied'));
    const a = rectangle('a', 10);
    const initial = options([a]);
    const { result, rerender } = renderHook(useObjectClipboard, {
      initialProps: initial,
    });
    await act(async () => {
      expect(result.current.cutSelectedObjects()).toBe(true);
    });
    rerender({ ...initial, elements: [] });
    act(() => {
      expect(result.current.pasteCopiedObjects()).toBe(true);
    });
    expect(initial.commitElements).toHaveBeenLastCalledWith([
      { ...a, id: expect.any(String), x: 30, y: 30 },
    ]);
  });
});
