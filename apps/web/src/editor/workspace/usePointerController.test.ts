/**
 * Drives synthetic pointer events through selection, read-only behavior, draw,
 * drag, resize, handles, frame batching, completion, and cancellation.
 */
import { DEFAULT_ELEMENT_STYLE, type ShapeElement } from '@chalkboard/shared';
import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requiredTestValue } from '../../test/assertions';
import type { Tool } from '../interaction/toolModel';
import {
  usePointerController,
  type PointerControllerOptions,
} from './usePointerController';

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
let animationFrameCallbacks: FrameRequestCallback[] = [];
let requestAnimationFrameMock = vi.fn();
let cancelAnimationFrameMock = vi.fn();

const flushAnimationFrame = () => {
  const callback = animationFrameCallbacks.shift();
  if (callback === undefined) throw new Error('Animation frame is absent');
  act(() => callback(0));
};

const activeToolRef = (tool: Tool): RefObject<Tool> => ({ current: tool });

const options = (tool: Tool): PointerControllerOptions => ({
  activeTool: tool,
  activeToolRef: activeToolRef(tool),
  availableActiveTool: tool,
  bezierFit: { accuracy: 1, continuity: 'c1', maxSegments: 8 },
  camera: { x: 0, y: 0, zoom: 1 },
  canAddElement: vi.fn(() => true),
  cornerRadius: 0,
  defaultLineSpacing: 1.2,
  defaultTextSize: 25,
  dispatchDocument: vi.fn(),
  editingEquation: null,
  elementStyle: { ...DEFAULT_ELEMENT_STYLE },
  ellipseEndAngle: 360,
  ellipseStartAngle: 0,
  elements: [],
  elementsForManipulation: [],
  interactiveElements: [],
  lineArrowheads: 'none',
  lineSpacing: 1.2,
  pathKind: 'straight',
  readOnly: false,
  selectedIdSet: new Set(),
  selectedIds: [],
  shapeFillSpacing: 8,
  shapeFillStyle: 'solid',
  shapeKind: 'rectangle',
  sourceTextSize: 22,
  textCursorVerticalOffsetEm: 0.68,
  textSize: 25,
  commitElements: vi.fn(() => true),
  onBeginEquationEdit: vi.fn(),
  onMoveEmptyEquation: vi.fn(),
  setBezierHandlePreviewId: vi.fn(),
  setCamera: vi.fn(),
  setMenuOpen: vi.fn(),
  setRecentlyCreatedId: vi.fn(),
  setSelectedIds: vi.fn(),
});

const pointerEvent = (
  type: 'down' | 'move' | 'up',
  x: number,
  y: number,
  {
    pointerId = 7,
    pointerType = 'mouse',
    shiftKey = false,
  }: { pointerId?: number; pointerType?: string; shiftKey?: boolean } = {},
) => {
  const target = {
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    hasPointerCapture: vi.fn(() => type === 'up'),
    releasePointerCapture: vi.fn(),
    setPointerCapture: vi.fn(),
  };
  return {
    button: 0,
    buttons: type === 'up' ? 0 : 1,
    clientX: x,
    clientY: y,
    currentTarget: target,
    nativeEvent: {
      clientX: x,
      clientY: y,
      getCoalescedEvents: () => [],
    },
    pointerId,
    pointerType,
    preventDefault: vi.fn(),
    shiftKey,
  } as unknown as ReactPointerEvent<HTMLCanvasElement>;
};

describe('usePointerController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    animationFrameCallbacks = [];
    requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      animationFrameCallbacks.push(callback);
      return animationFrameCallbacks.length;
    });
    cancelAnimationFrameMock = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.stubGlobal('requestAnimationFrame', originalRequestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', originalCancelAnimationFrame);
  });

  it('owns the complete panning lifecycle and pointer capture', () => {
    const initial = options('hand');
    const { result } = renderHook(() => usePointerController(initial));
    const down = pointerEvent('down', 100, 120);
    act(() => result.current.onPointerDown(down));
    expect(result.current.isPanning).toBe(true);
    expect(down.currentTarget.setPointerCapture).toHaveBeenCalledWith(7);

    act(() => result.current.onPointerMove(pointerEvent('move', 160, 155)));
    expect(initial.setCamera).toHaveBeenCalledWith({ x: 60, y: 35, zoom: 1 });

    const up = pointerEvent('up', 160, 155);
    act(() => result.current.onPointerUp(up));
    expect(result.current.isPanning).toBe(false);
    expect(up.currentTarget.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('pinch-zooms and continues panning with the remaining touch', () => {
    const initial = options('selection');
    const { result } = renderHook(() => usePointerController(initial));

    act(() =>
      result.current.onPointerDown(
        pointerEvent('down', 100, 100, { pointerType: 'touch' }),
      ),
    );
    expect(result.current.boxSelection).not.toBeNull();
    act(() =>
      result.current.onPointerDown(
        pointerEvent('down', 200, 100, {
          pointerId: 8,
          pointerType: 'touch',
        }),
      ),
    );
    expect(result.current.boxSelection).toBeNull();
    expect(result.current.isPanning).toBe(true);

    act(() =>
      result.current.onPointerMove(
        pointerEvent('move', 300, 100, {
          pointerId: 8,
          pointerType: 'touch',
        }),
      ),
    );
    expect(initial.setCamera).toHaveBeenLastCalledWith({
      x: -100,
      y: -100,
      zoom: 2,
    });

    act(() =>
      result.current.onPointerMove(
        pointerEvent('move', 150, 100, {
          pointerId: 8,
          pointerType: 'touch',
        }),
      ),
    );
    expect(initial.setCamera).toHaveBeenLastCalledWith({
      x: 50,
      y: 50,
      zoom: 0.5,
    });

    act(() =>
      result.current.onPointerUp(
        pointerEvent('up', 150, 100, {
          pointerId: 8,
          pointerType: 'touch',
        }),
      ),
    );
    act(() =>
      result.current.onPointerMove(
        pointerEvent('move', 120, 100, { pointerType: 'touch' }),
      ),
    );
    expect(initial.setCamera).toHaveBeenLastCalledWith({
      x: 70,
      y: 50,
      zoom: 0.5,
    });

    act(() =>
      result.current.onPointerUp(
        pointerEvent('up', 120, 100, { pointerType: 'touch' }),
      ),
    );
    expect(result.current.isPanning).toBe(false);
    expect(initial.commitElements).not.toHaveBeenCalled();
  });

  it('commits the latest coalesced box selection before pointer release', () => {
    const target: ShapeElement = {
      ...DEFAULT_ELEMENT_STYLE,
      cornerRadius: 0,
      createdBy: 'local',
      height: 20,
      id: 'box-target',
      rotation: 0,
      shapeKind: 'rectangle',
      type: 'shape',
      width: 20,
      x: 100,
      y: 100,
    };
    const initial = {
      ...options('selection'),
      elements: [target],
      interactiveElements: [target],
    };
    const { result } = renderHook(() => usePointerController(initial));
    act(() => result.current.onPointerDown(pointerEvent('down', 0, 0)));
    vi.mocked(initial.setSelectedIds).mockClear();

    act(() => {
      for (let index = 1; index <= 100; index += 1) {
        result.current.onPointerMove(
          pointerEvent('move', index * 1.5, index * 1.5),
        );
      }
    });

    expect(requestAnimationFrameMock).toHaveBeenCalledOnce();
    expect(initial.setSelectedIds).not.toHaveBeenCalled();
    act(() => result.current.onPointerUp(pointerEvent('up', 150, 150)));
    expect(initial.setSelectedIds).toHaveBeenCalledWith(['box-target']);
    expect(result.current.boxSelection).toBeNull();
  });

  it('previews, finalizes, and resets drawing interactions', () => {
    const stable: ShapeElement = {
      ...DEFAULT_ELEMENT_STYLE,
      cornerRadius: 0,
      createdBy: 'local',
      height: 20,
      id: 'stable',
      rotation: 0,
      shapeKind: 'rectangle',
      type: 'shape',
      width: 20,
      x: 1_000,
      y: 1_000,
    };
    const baseElements = Array.from({ length: 9_999 }, (_, index) => ({
      ...stable,
      id: `stable-${index}`,
    }));
    const initial = { ...options('shape'), elements: baseElements };
    const { result } = renderHook(() => usePointerController(initial));
    act(() => result.current.onPointerDown(pointerEvent('down', 20, 30)));
    flushAnimationFrame();
    expect(initial.dispatchDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        elements: [expect.any(Object)],
        type: 'preview',
      }),
    );

    act(() => result.current.onPointerMove(pointerEvent('move', 120, 90)));
    flushAnimationFrame();
    const previews = vi
      .mocked(initial.dispatchDocument)
      .mock.calls.map(([action]) => action)
      .filter((action) => action.type === 'preview');
    expect(previews.every(({ elements }) => elements.length === 1)).toBe(true);
    act(() => result.current.onPointerUp(pointerEvent('up', 120, 90)));
    const committed = requiredTestValue(
      vi.mocked(initial.commitElements).mock.calls[0]?.[0],
      'committed maximum board',
    );
    expect(committed).toHaveLength(10_000);
    expect(committed[0]).toBe(baseElements[0]);
    expect(committed.at(-1)).toMatchObject({
      height: 60,
      type: 'shape',
      width: 100,
    });

    act(() => result.current.resetInteractions());
    expect(result.current.boxSelection).toBeNull();
    expect(result.current.canvasHoverTarget).toBeNull();
    expect(result.current.isMovingSelection).toBe(false);
  });

  it('carries the configured ellipse arc into a new shape', () => {
    const initial = {
      ...options('shape'),
      ellipseEndAngle: 180,
      ellipseStartAngle: 30,
      shapeKind: 'ellipse' as const,
    };
    const { result } = renderHook(() => usePointerController(initial));

    act(() => result.current.onPointerDown(pointerEvent('down', 20, 30)));
    flushAnimationFrame();
    act(() => result.current.onPointerMove(pointerEvent('move', 120, 90)));
    flushAnimationFrame();
    act(() => result.current.onPointerUp(pointerEvent('up', 120, 90)));

    expect(
      vi.mocked(initial.commitElements).mock.calls[0]?.[0]?.[0],
    ).toMatchObject({
      ellipseEndAngle: 180,
      ellipseStartAngle: 30,
      shapeKind: 'ellipse',
    });
  });

  it('locks Straight endpoints into one connected path', () => {
    const initial = options('line');
    const { result } = renderHook(() => usePointerController(initial));

    act(() => result.current.onPointerDown(pointerEvent('down', 0, 0)));
    flushAnimationFrame();
    act(() => result.current.onPointerMove(pointerEvent('move', 100, 0)));
    flushAnimationFrame();
    expect(result.current.addStraightPoint()).toBe(true);
    act(() => result.current.onPointerMove(pointerEvent('move', 100, 80)));
    flushAnimationFrame();
    act(() => result.current.onPointerUp(pointerEvent('up', 100, 80)));

    const committed = requiredTestValue(
      vi.mocked(initial.commitElements).mock.calls[0]?.[0]?.[0],
      'connected Straight path',
    );
    expect(committed).toMatchObject({
      height: 80,
      pathKind: 'straight',
      type: 'line',
      width: 100,
    });
    if (committed.type !== 'line') throw new Error('Expected line');
    expect(committed.segments).toHaveLength(2);
    expect(committed.segments.map(({ end }) => end)).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ]);
  });

  it('uses a secondary touch tap as Space during Straight drawing', () => {
    const initial = options('line');
    const { result } = renderHook(() => usePointerController(initial));

    act(() =>
      result.current.onPointerDown(
        pointerEvent('down', 0, 0, { pointerType: 'touch' }),
      ),
    );
    flushAnimationFrame();
    act(() =>
      result.current.onPointerMove(
        pointerEvent('move', 100, 0, { pointerType: 'touch' }),
      ),
    );
    flushAnimationFrame();

    act(() =>
      result.current.onPointerDown(
        pointerEvent('down', 20, 160, {
          pointerId: 8,
          pointerType: 'touch',
        }),
      ),
    );
    act(() =>
      result.current.onPointerUp(
        pointerEvent('up', 20, 160, {
          pointerId: 8,
          pointerType: 'touch',
        }),
      ),
    );

    act(() =>
      result.current.onPointerMove(
        pointerEvent('move', 100, 80, { pointerType: 'touch' }),
      ),
    );
    flushAnimationFrame();
    act(() =>
      result.current.onPointerUp(
        pointerEvent('up', 100, 80, { pointerType: 'touch' }),
      ),
    );

    const committed = requiredTestValue(
      vi.mocked(initial.commitElements).mock.calls[0]?.[0]?.[0],
      'touch-connected Straight path',
    );
    if (committed.type !== 'line') throw new Error('Expected line');
    expect(committed.segments.map(({ end }) => end)).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ]);
  });

  it('uses a held secondary touch as Shift during drawing', () => {
    const initial = options('shape');
    const { result } = renderHook(() => usePointerController(initial));

    act(() =>
      result.current.onPointerDown(
        pointerEvent('down', 0, 0, { pointerType: 'touch' }),
      ),
    );
    flushAnimationFrame();
    act(() =>
      result.current.onPointerMove(
        pointerEvent('move', 120, 60, { pointerType: 'touch' }),
      ),
    );
    flushAnimationFrame();

    act(() =>
      result.current.onPointerDown(
        pointerEvent('down', 20, 180, {
          pointerId: 8,
          pointerType: 'touch',
        }),
      ),
    );
    flushAnimationFrame();
    act(() =>
      result.current.onPointerUp(
        pointerEvent('up', 120, 60, { pointerType: 'touch' }),
      ),
    );

    const committed = requiredTestValue(
      vi.mocked(initial.commitElements).mock.calls[0]?.[0]?.[0],
      'touch-constrained shape',
    );
    expect(committed).toMatchObject({ height: 120, width: 120 });
  });

  it('uses a held secondary touch as Shift during resize', () => {
    const shape: ShapeElement = {
      ...DEFAULT_ELEMENT_STYLE,
      cornerRadius: 0,
      createdBy: 'local',
      height: 50,
      id: 'resize-target',
      rotation: 0,
      shapeKind: 'rectangle',
      type: 'shape',
      width: 100,
      x: 10,
      y: 20,
    };
    const initial = {
      ...options('selection'),
      elements: [shape],
      elementsForManipulation: [shape],
      interactiveElements: [shape],
      selectedIdSet: new Set([shape.id]),
      selectedIds: [shape.id],
    };
    const { result } = renderHook(() => usePointerController(initial));

    act(() =>
      result.current.onPointerDown(
        pointerEvent('down', 110, 70, { pointerType: 'touch' }),
      ),
    );
    expect(result.current.activeResizeHandle).toBe('south-east');
    act(() =>
      result.current.onPointerMove(
        pointerEvent('move', 210, 200, { pointerType: 'touch' }),
      ),
    );
    flushAnimationFrame();
    act(() =>
      result.current.onPointerDown(
        pointerEvent('down', 20, 260, {
          pointerId: 8,
          pointerType: 'touch',
        }),
      ),
    );
    flushAnimationFrame();
    act(() =>
      result.current.onPointerUp(
        pointerEvent('up', 210, 200, { pointerType: 'touch' }),
      ),
    );

    const committed = requiredTestValue(
      vi.mocked(initial.commitElements).mock.calls[0]?.[0]?.[0],
      'touch-constrained resize',
    );
    expect(committed.width / committed.height).toBeCloseTo(2, 5);
  });

  it('uses a held secondary touch as Shift during rotation', () => {
    const shape: ShapeElement = {
      ...DEFAULT_ELEMENT_STYLE,
      cornerRadius: 0,
      createdBy: 'local',
      height: 50,
      id: 'rotation-target',
      rotation: 0,
      shapeKind: 'rectangle',
      type: 'shape',
      width: 100,
      x: 10,
      y: 20,
    };
    const initial = {
      ...options('selection'),
      elements: [shape],
      elementsForManipulation: [shape],
      interactiveElements: [shape],
      selectedIdSet: new Set([shape.id]),
      selectedIds: [shape.id],
    };
    const { result } = renderHook(() => usePointerController(initial));

    act(() =>
      result.current.onPointerDown(
        pointerEvent('down', 60, -6, { pointerType: 'touch' }),
      ),
    );
    act(() =>
      result.current.onPointerMove(
        pointerEvent('move', 154, 79, { pointerType: 'touch' }),
      ),
    );
    flushAnimationFrame();
    act(() =>
      result.current.onPointerDown(
        pointerEvent('down', 20, 260, {
          pointerId: 8,
          pointerType: 'touch',
        }),
      ),
    );
    flushAnimationFrame();
    act(() =>
      result.current.onPointerUp(
        pointerEvent('up', 154, 79, { pointerType: 'touch' }),
      ),
    );

    const committed = requiredTestValue(
      vi.mocked(initial.commitElements).mock.calls[0]?.[0]?.[0],
      'touch-snapped rotation',
    );
    expect(committed.rotation % 15).toBe(0);
  });

  it('distinguishes a held Straight modifier from a segment tap', async () => {
    const initial = options('line');
    const { result } = renderHook(() => usePointerController(initial));

    act(() =>
      result.current.onPointerDown(
        pointerEvent('down', 0, 0, { pointerType: 'touch' }),
      ),
    );
    flushAnimationFrame();
    act(() =>
      result.current.onPointerMove(
        pointerEvent('move', 100, 30, { pointerType: 'touch' }),
      ),
    );
    flushAnimationFrame();
    act(() =>
      result.current.onPointerDown(
        pointerEvent('down', 20, 180, {
          pointerId: 8,
          pointerType: 'touch',
        }),
      ),
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    });
    flushAnimationFrame();
    act(() =>
      result.current.onPointerUp(
        pointerEvent('up', 100, 30, { pointerType: 'touch' }),
      ),
    );

    const committed = requiredTestValue(
      vi.mocked(initial.commitElements).mock.calls[0]?.[0]?.[0],
      'touch-constrained Straight path',
    );
    expect(committed).toMatchObject({ height: 0, pathKind: 'straight' });
    if (committed.type !== 'line') throw new Error('Expected line');
    expect(committed.segments).toHaveLength(1);
  });

  it('keeps maximum-board drag previews sparse until the semantic commit', () => {
    const target: ShapeElement = {
      ...DEFAULT_ELEMENT_STYLE,
      cornerRadius: 0,
      createdBy: 'local',
      height: 50,
      id: 'target',
      rotation: 0,
      shapeKind: 'rectangle',
      type: 'shape',
      width: 100,
      x: 10,
      y: 20,
    };
    const elements = [
      target,
      ...Array.from({ length: 9_999 }, (_, index) => ({
        ...target,
        id: `stable-${index}`,
        x: 1_000 + index * 2,
      })),
    ];
    const initial = {
      ...options('selection'),
      elements,
      elementsForManipulation: [target],
      interactiveElements: [target],
      selectedIds: [target.id],
      selectedIdSet: new Set([target.id]),
    };
    const { result } = renderHook(() => usePointerController(initial));

    act(() => result.current.onPointerDown(pointerEvent('down', 20, 30)));
    act(() => {
      for (let index = 1; index <= 100; index += 1) {
        result.current.onPointerMove(
          pointerEvent('move', 20 + index * 0.4, 30 + index * 0.2),
        );
      }
    });

    expect(requestAnimationFrameMock).toHaveBeenCalledOnce();
    expect(initial.dispatchDocument).not.toHaveBeenCalled();
    flushAnimationFrame();
    const previews = vi
      .mocked(initial.dispatchDocument)
      .mock.calls.map(([action]) => action)
      .filter((action) => action.type === 'preview');
    expect(previews).toHaveLength(1);
    const preview = requiredTestValue(previews[0], 'batched drag preview');
    expect(preview.elements).toHaveLength(1);
    expect(preview.elements[0]).toMatchObject({ x: 50, y: 40 });

    act(() => result.current.onPointerUp(pointerEvent('up', 60, 50)));
    expect(initial.commitElements).toHaveBeenCalledOnce();
    const committed = requiredTestValue(
      vi.mocked(initial.commitElements).mock.calls[0]?.[0],
      'committed drag document',
    );
    expect(committed).toHaveLength(10_000);
    expect(committed[0]).toMatchObject({ x: 50, y: 40 });
    expect(committed[1]).toBe(elements[1]);
  });

  it('cancels queued pointer publication during teardown', () => {
    const initial = options('shape');
    const { result, unmount } = renderHook(() => usePointerController(initial));
    act(() => result.current.onPointerDown(pointerEvent('down', 20, 30)));

    unmount();

    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(1);
    expect(initial.dispatchDocument).not.toHaveBeenCalled();
  });

  it('rejects a new drawing before allocating a preview at board capacity', () => {
    const initial = options('shape');
    initial.canAddElement = vi.fn(() => false);
    const { result } = renderHook(() => usePointerController(initial));
    const down = pointerEvent('down', 20, 30);

    act(() => result.current.onPointerDown(down));

    expect(initial.canAddElement).toHaveBeenCalledOnce();
    expect(initial.dispatchDocument).not.toHaveBeenCalled();
    expect(down.currentTarget.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('starts a new block with the source view three smaller', () => {
    // The two views hold independent sizes, set the same distance apart for
    // every new block, so which view was active when the block was made does
    // not decide either size.
    const rendered = options('equation');
    const renderedController = renderHook(() => usePointerController(rendered));
    act(() =>
      renderedController.result.current.onPointerDown(
        pointerEvent('down', 20, 30),
      ),
    );
    expect(rendered.onBeginEquationEdit).toHaveBeenCalledWith(
      expect.objectContaining({ fontSize: 25, sourceFontSize: 22 }),
      { caretPoint: { x: 20, y: 30 }, isNew: true },
    );
  });

  it('toggles a hit object without disturbing the selection on Shift-click', () => {
    const shape: ShapeElement = {
      ...DEFAULT_ELEMENT_STYLE,
      cornerRadius: 0,
      createdBy: 'local',
      height: 50,
      id: 'shape',
      rotation: 0,
      shapeKind: 'rectangle',
      type: 'shape',
      width: 100,
      x: 10,
      y: 20,
    };
    const initial = {
      ...options('selection'),
      elements: [shape],
      elementsForManipulation: [shape],
      interactiveElements: [shape],
    };
    const { result } = renderHook(() => usePointerController(initial));

    act(() =>
      result.current.onPointerDown(
        pointerEvent('down', 20, 30, { pointerId: 7, shiftKey: true }),
      ),
    );

    expect(initial.setSelectedIds).toHaveBeenCalledOnce();
    const updateSelection = requiredTestValue(
      vi.mocked(initial.setSelectedIds).mock.calls[0],
      'selection update call',
    )[0];
    if (typeof updateSelection !== 'function') {
      throw new Error('Expected a selection updater callback');
    }
    expect(updateSelection(['other'])).toEqual(['other', 'shape']);
    expect(updateSelection(['other', 'shape'])).toEqual(['other']);
    expect(result.current.isMovingSelection).toBe(false);
  });
});
