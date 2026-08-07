/**
 * Owns grid and interaction canvases plus animation-frame repaint scheduling.
 * Rendering consumes refs for pointer-frequency previews without React renders.
 */
import type {
  BoardElement,
  Bounds,
  Camera,
  LineElement,
  ShapeElement,
} from '@chalkboard/shared';
import { useEffect, useRef, type RefObject } from 'react';

import {
  drawGrid,
  drawOverlay,
  type CanvasSize,
} from '../interaction/rendering';

/** Refs and presentation state required to draw grid and interaction overlay. */
export interface CanvasRendererOptions {
  bezierHandlePreview: LineElement | undefined;
  boxSelection: Bounds | null;
  camera: Camera;
  canvasSize: CanvasSize;
  gridDotSize: number;
  gridSpacing: number;
  selectedElements: readonly BoardElement[];
  showGrid: boolean;
  trapezoidHandlePreview: ShapeElement | undefined;
}

interface CanvasRefs {
  gridCanvasRef: RefObject<HTMLCanvasElement | null>;
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
}

/** Schedules grid/overlay rendering from the shared camera and derived view. */
export function useCanvasRenderer({
  bezierHandlePreview,
  boxSelection,
  camera,
  canvasSize,
  gridDotSize,
  gridSpacing,
  selectedElements,
  showGrid,
  trapezoidHandlePreview,
}: CanvasRendererOptions): CanvasRefs {
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = gridCanvasRef.current;
    if (canvas !== null) {
      drawGrid(canvas, {
        camera,
        dotSize: gridDotSize,
        size: canvasSize,
        spacing: gridSpacing,
        visible: showGrid,
      });
    }
  }, [camera, canvasSize, gridDotSize, gridSpacing, showGrid]);

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (canvas !== null) {
      drawOverlay(canvas, {
        bezierHandlePreview,
        boxSelection,
        camera,
        selectedElements,
        size: canvasSize,
        trapezoidHandlePreview,
      });
    }
  }, [
    bezierHandlePreview,
    boxSelection,
    camera,
    canvasSize,
    selectedElements,
    trapezoidHandlePreview,
  ]);

  return { gridCanvasRef, overlayCanvasRef };
}
