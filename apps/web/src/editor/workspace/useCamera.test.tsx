/** Proves camera pan/zoom bounds, cursor anchoring, wheel/pinch behavior, reset, and viewport resize. */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pinchZoomFactor, useCamera } from './useCamera';

const originalResizeObserver = globalThis.ResizeObserver;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

afterEach(() => {
  cleanup();
  vi.stubGlobal('ResizeObserver', originalResizeObserver);
  vi.stubGlobal('requestAnimationFrame', originalRequestAnimationFrame);
  vi.stubGlobal('cancelAnimationFrame', originalCancelAnimationFrame);
});

function installAnimationFrames() {
  const callbacks: FrameRequestCallback[] = [];
  const request = vi.fn((callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  const cancel = vi.fn();
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  return {
    cancel,
    flush() {
      const callback = callbacks.shift();
      if (callback === undefined) throw new Error('Animation frame is absent');
      act(() => callback(0));
    },
    request,
  };
}

function CameraHarness() {
  const {
    camera,
    centerAtVerticalStart,
    panBy,
    setCamera,
    viewportReady,
    viewportRef,
    zoomByFactor,
  } = useCamera();
  return (
    <div ref={viewportRef}>
      <output data-testid="camera">
        {JSON.stringify({ camera, viewportReady })}
      </output>
      <button
        type="button"
        onClick={() =>
          centerAtVerticalStart({ height: 60, width: 80, x: 100, y: 200 })
        }
      >
        Center object
      </button>
      <button type="button" onClick={() => zoomByFactor(2, { x: 100, y: 100 })}>
        Pinch in
      </button>
      <button
        type="button"
        onClick={() => {
          for (let index = 1; index <= 100; index += 1) {
            setCamera({ x: index, y: index * 2, zoom: 1 });
          }
        }}
      >
        Camera burst
      </button>
      <button
        type="button"
        onClick={() => {
          for (let index = 0; index < 100; index += 1) panBy(1, 2);
        }}
      >
        Pan burst
      </button>
    </div>
  );
}

describe('useCamera', () => {
  it('publishes readiness only after measuring and centering the viewport', () => {
    const frames = installAnimationFrames();
    let notify: ResizeObserverCallback = () => undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          notify = callback;
        }
        disconnect() {}
        observe() {}
      },
    );
    render(<CameraHarness />);

    expect(screen.getByTestId('camera')).toHaveTextContent(
      JSON.stringify({
        camera: { x: 0, y: 0, zoom: 1 },
        viewportReady: false,
      }),
    );

    act(() => {
      notify(
        [
          {
            contentRect: { height: 600, width: 800 },
          } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    });

    expect(screen.getByTestId('camera')).toHaveTextContent(
      JSON.stringify({
        camera: { x: 400, y: 300, zoom: 1 },
        viewportReady: true,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Center object' }));
    frames.flush();
    expect(screen.getByTestId('camera')).toHaveTextContent(
      JSON.stringify({
        camera: { x: 260, y: 100, zoom: 1 },
        viewportReady: true,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pinch in' }));
    frames.flush();
    expect(screen.getByTestId('camera')).toHaveTextContent(
      JSON.stringify({
        camera: { x: 420, y: 100, zoom: 2 },
        viewportReady: true,
      }),
    );
  });

  it('coalesces a camera event burst into the latest animation frame', () => {
    const frames = installAnimationFrames();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect() {}
        observe() {}
      },
    );
    render(<CameraHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Camera burst' }));

    expect(frames.request).toHaveBeenCalledOnce();
    expect(screen.getByTestId('camera')).toHaveTextContent(
      JSON.stringify({
        camera: { x: 0, y: 0, zoom: 1 },
        viewportReady: false,
      }),
    );
    frames.flush();
    expect(screen.getByTestId('camera')).toHaveTextContent(
      JSON.stringify({
        camera: { x: 100, y: 200, zoom: 1 },
        viewportReady: false,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pan burst' }));
    expect(frames.request).toHaveBeenCalledTimes(2);
    frames.flush();
    expect(screen.getByTestId('camera')).toHaveTextContent(
      JSON.stringify({
        camera: { x: 0, y: 0, zoom: 1 },
        viewportReady: false,
      }),
    );
  });

  it('cancels a queued camera publication during teardown', () => {
    const frames = installAnimationFrames();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect() {}
        observe() {}
      },
    );
    const { unmount } = render(<CameraHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Camera burst' }));

    unmount();

    expect(frames.cancel).toHaveBeenCalledWith(1);
  });

  it('normalizes and bounds browser pinch-wheel deltas', () => {
    expect(pinchZoomFactor(-10, WheelEvent.DOM_DELTA_PIXEL)).toBeCloseTo(
      Math.exp(0.1),
    );
    expect(pinchZoomFactor(1, WheelEvent.DOM_DELTA_LINE)).toBeCloseTo(
      Math.exp(-0.16),
    );
    expect(pinchZoomFactor(-100, WheelEvent.DOM_DELTA_PAGE)).toBeCloseTo(
      Math.exp(0.4),
    );
  });
});
