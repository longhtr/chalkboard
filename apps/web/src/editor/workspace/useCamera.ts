/**
 * Owns bounded pan/zoom state and the viewport element. Wheel, pinch, controls,
 * and resize all update the camera transform shared by every visual layer.
 */
import {
  screenToWorld,
  type Bounds,
  type Camera,
  type Point,
} from '@chalkboard/shared';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SetStateAction,
} from 'react';

import type { CanvasSize } from '../interaction/rendering';

const PINCH_PIXEL_LIMIT = 40;

/** Converts wheel/pinch delta units into a bounded multiplicative zoom factor. */
export function pinchZoomFactor(deltaY: number, deltaMode: number): number {
  const pixels =
    deltaY *
    (deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? 800
        : 1);
  const boundedPixels = Math.max(
    -PINCH_PIXEL_LIMIT,
    Math.min(PINCH_PIXEL_LIMIT, pixels),
  );
  return Math.exp(-boundedPixels * 0.01);
}

/** Owns viewport size and the single camera used by every editor layer. */
export function useCamera() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const centeredRef = useRef(false);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const pendingCameraRef = useRef<Camera | null>(null);
  const cameraFrameRef = useRef<number | null>(null);
  const [camera, setPublishedCamera] = useState<Camera>({
    x: 0,
    y: 0,
    zoom: 1,
  });
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({
    height: 1,
    width: 1,
  });
  const [viewportReady, setViewportReady] = useState(false);

  const setCamera = useCallback((action: SetStateAction<Camera>) => {
    const current = pendingCameraRef.current ?? cameraRef.current;
    pendingCameraRef.current =
      typeof action === 'function' ? action(current) : action;
    if (cameraFrameRef.current !== null) return;
    cameraFrameRef.current = window.requestAnimationFrame(() => {
      cameraFrameRef.current = null;
      const next = pendingCameraRef.current;
      pendingCameraRef.current = null;
      if (next === null) return;
      cameraRef.current = next;
      setPublishedCamera(next);
    });
  }, []);

  useEffect(
    () => () => {
      if (cameraFrameRef.current !== null) {
        window.cancelAnimationFrame(cameraFrameRef.current);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setCanvasSize({ width, height });
      if (width > 1 && height > 1) {
        setViewportReady(true);
        if (!centeredRef.current) {
          centeredRef.current = true;
          const centered = { x: width / 2, y: height / 2, zoom: 1 };
          cameraRef.current = centered;
          setPublishedCamera(centered);
        }
      }
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const updateZoom = useCallback(
    (nextZoom: (current: number) => number, anchor: Point) => {
      setCamera((current) => {
        const worldAnchor = screenToWorld(anchor, current);
        const zoom = Math.min(4, Math.max(0.1, nextZoom(current.zoom)));
        return {
          x: anchor.x - worldAnchor.x * zoom,
          y: anchor.y - worldAnchor.y * zoom,
          zoom,
        };
      });
    },
    [setCamera],
  );

  const zoomBy = useCallback(
    (amount: number, anchor: Point) => {
      updateZoom((current) => current + amount, anchor);
    },
    [updateZoom],
  );

  const zoomByFactor = useCallback(
    (factor: number, anchor: Point) => {
      updateZoom((current) => current * factor, anchor);
    },
    [updateZoom],
  );

  const resetCamera = useCallback(() => {
    setCamera({ x: canvasSize.width / 2, y: canvasSize.height / 2, zoom: 1 });
  }, [canvasSize, setCamera]);

  const centerAtVerticalStart = useCallback(
    (bounds: Bounds) => {
      setCamera((current) => ({
        ...current,
        x: canvasSize.width / 2 - (bounds.x + bounds.width / 2) * current.zoom,
        y: canvasSize.height / 2 - bounds.y * current.zoom,
      }));
    },
    [canvasSize, setCamera],
  );

  const panBy = useCallback(
    (deltaX: number, deltaY: number) => {
      setCamera((current) => ({
        ...current,
        x: current.x - deltaX,
        y: current.y - deltaY,
      }));
    },
    [setCamera],
  );

  return {
    camera,
    canvasSize,
    centerAtVerticalStart,
    panBy,
    resetCamera,
    setCamera,
    viewportReady,
    viewportRef,
    zoomBy,
    zoomByFactor,
  };
}
