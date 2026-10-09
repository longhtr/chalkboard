/** Proves one-frame measurement batching, newest-value replacement, cancellation, and unmount cleanup. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useEquationMeasurementQueue } from './useEquationMeasurementQueue';

afterEach(() => vi.unstubAllGlobals());

describe('equation measurement queue', () => {
  it('publishes the latest measurement for each equation once per frame', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrame;
      nextFrame += 1;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const dispatch = vi.fn();
    const { result } = renderHook(() => useEquationMeasurementQueue(dispatch));

    act(() => {
      result.current('equation-a', 100, 40);
      result.current('equation-a', 120, 50);
      result.current('equation-b', 80, 30);
    });
    expect(frames).toHaveLength(1);
    const frame = frames.get(1);
    frames.delete(1);
    act(() => frame?.(16));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'measure-many',
      measurements: [
        { height: 50, id: 'equation-a', width: 120 },
        { height: 30, id: 'equation-b', width: 80 },
      ],
    });
    expect(frames).toHaveLength(0);
  });

  it('cancels queued publication on teardown', () => {
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', () => 41);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    const { result, unmount } = renderHook(() =>
      useEquationMeasurementQueue(vi.fn()),
    );

    act(() => result.current('equation', 100, 40));
    unmount();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(41);
  });
});
