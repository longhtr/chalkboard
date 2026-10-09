/** Uses recording canvases and animation frames to prove backing-store sizing, repaint triggers, and cleanup. */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { drawGrid, drawOverlay } from '../interaction/rendering';
import {
  useCanvasRenderer,
  type CanvasRendererOptions,
} from './useCanvasRenderer';

vi.mock('../interaction/rendering', () => ({
  drawGrid: vi.fn(),
  drawOverlay: vi.fn(),
}));

const options = (): CanvasRendererOptions => ({
  bezierHandlePreview: undefined,
  boxSelection: null,
  camera: { x: 400, y: 300, zoom: 1 },
  canvasSize: { height: 600, width: 800 },
  gridDotSize: 1,
  gridLineOpacity: 0.3,
  gridSpacing: 20,
  gridStyle: 'dots',
  selectedElements: [],
  showGrid: true,
  theme: 'light' as const,
  trapezoidHandlePreview: undefined,
});

const canvas = () => ({}) as HTMLCanvasElement;

describe('useCanvasRenderer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('owns grid and overlay canvas redraws', () => {
    const initial = options();
    const { result, rerender } = renderHook(
      (value: CanvasRendererOptions) => useCanvasRenderer(value),
      { initialProps: initial },
    );
    const grid = canvas();
    const overlay = canvas();
    act(() => {
      result.current.gridCanvasRef.current = grid;
      result.current.overlayCanvasRef.current = overlay;
    });

    const camera = { ...initial.camera, x: 420 };
    rerender({ ...initial, camera });

    expect(drawGrid).toHaveBeenCalledWith(grid, {
      camera,
      dotSize: 1,
      lineOpacity: 0.3,
      size: initial.canvasSize,
      spacing: 20,
      style: 'dots',
      visible: true,
    });
    expect(drawOverlay).toHaveBeenCalledWith(overlay, {
      bezierHandlePreview: undefined,
      boxSelection: null,
      camera,
      selectedElements: initial.selectedElements,
      size: initial.canvasSize,
      trapezoidHandlePreview: undefined,
    });
  });

  it('redraws only the grid when a grid setting changes', () => {
    const initial = options();
    const { result, rerender } = renderHook(
      (value: CanvasRendererOptions) => useCanvasRenderer(value),
      { initialProps: initial },
    );
    act(() => {
      result.current.gridCanvasRef.current = canvas();
      result.current.overlayCanvasRef.current = canvas();
    });
    vi.clearAllMocks();

    rerender({
      ...initial,
      gridLineOpacity: 0.5,
      gridSpacing: 40,
      gridStyle: 'lines',
    });

    expect(drawGrid).toHaveBeenCalledOnce();
    expect(drawOverlay).not.toHaveBeenCalled();
  });
});
