/** Uses a recording canvas context to prove paths, styles, arrows, transforms, grid, and selection drawing. */
import { DEFAULT_ELEMENT_STYLE, type ShapeElement } from '@chalkboard/shared';
import { describe, expect, it, vi } from 'vitest';

import { drawElements, drawGrid } from './rendering';

function gridCanvas(points: { x: number; y: number }[], radii: number[] = []) {
  const context = {
    arc: vi.fn((x: number, y: number, radius: number) => {
      points.push({ x, y });
      radii.push(radius);
    }),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
    setTransform: vi.fn(),
  };
  const canvas = {
    getContext: vi.fn(() => context),
    height: 0,
    width: 0,
  };
  return canvas as unknown as HTMLCanvasElement;
}

describe('grid rendering', () => {
  it('uses the configured world-space spacing', () => {
    const points: { x: number; y: number }[] = [];
    drawGrid(gridCanvas(points), {
      camera: { x: 0, y: 0, zoom: 1 },
      size: { height: 100, width: 100 },
      spacing: 40,
      visible: true,
    });

    expect([...new Set(points.map(({ x }) => x))]).toEqual([0, 40, 80]);
    expect([...new Set(points.map(({ y }) => y))]).toEqual([0, 40, 80]);
  });

  it('applies the configured dot size', () => {
    const radii: number[] = [];
    drawGrid(gridCanvas([], radii), {
      camera: { x: 0, y: 0, zoom: 1 },
      dotSize: 2.25,
      size: { height: 30, width: 30 },
      spacing: 20,
      visible: true,
    });

    expect(new Set(radii)).toEqual(new Set([2.25]));
  });

  it('draws continuous vertical and horizontal lines when selected', () => {
    const runs: Array<{
      from: { x: number; y: number };
      to: { x: number; y: number };
    }> = [];
    let pen = { x: 0, y: 0 };
    const context = {
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      globalAlpha: 1,
      lineTo: vi.fn((x: number, y: number) => {
        runs.push({ from: pen, to: { x, y } });
      }),
      lineWidth: 0,
      moveTo: vi.fn((x: number, y: number) => {
        pen = { x, y };
      }),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: '',
    };
    const canvas = {
      getContext: vi.fn(() => context),
      height: 0,
      width: 0,
    } as unknown as HTMLCanvasElement;

    drawGrid(canvas, {
      camera: { x: 0, y: 0, zoom: 1 },
      size: { height: 30, width: 30 },
      spacing: 20,
      style: 'lines',
      visible: true,
    });

    expect(runs).toEqual([
      { from: { x: 0, y: 0 }, to: { x: 0, y: 30 } },
      { from: { x: 20, y: 0 }, to: { x: 20, y: 30 } },
      { from: { x: 0, y: 0 }, to: { x: 30, y: 0 } },
      { from: { x: 0, y: 20 }, to: { x: 30, y: 20 } },
    ]);
    expect(context.stroke).toHaveBeenCalledOnce();
    expect(context.globalAlpha).toBe(0.3);
  });

  it('scales spacing with zoom while avoiding unusably dense dots', () => {
    const points: { x: number; y: number }[] = [];
    drawGrid(gridCanvas(points), {
      camera: { x: 0, y: 0, zoom: 0.1 },
      size: { height: 30, width: 30 },
      spacing: 40,
      visible: true,
    });

    expect([...new Set(points.map(({ x }) => x))]).toEqual([0, 8, 16, 24]);
  });
});

/** Records every straight run the renderer strokes, ignoring curved outlines. */
function segmentRecordingCanvas(runs: { x: number; y: number }[]) {
  let pen: { x: number; y: number } | null = null;
  const context = {
    arc: vi.fn(),
    beginPath: vi.fn(() => {
      pen = null;
    }),
    bezierCurveTo: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
    globalAlpha: 1,
    lineCap: '',
    lineJoin: '',
    lineTo: vi.fn((x: number, y: number) => {
      // Only a move followed by a line is a hatch run; outline tracing emits
      // curves between its straight edges.
      if (pen !== null) runs.push(pen, { x, y });
      pen = null;
    }),
    lineWidth: 1,
    moveTo: vi.fn((x: number, y: number) => {
      pen = { x, y };
    }),
    quadraticCurveTo: vi.fn(() => {
      pen = null;
    }),
    restore: vi.fn(),
    roundRect: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    strokeStyle: '',
    translate: vi.fn(),
  };
  const canvas = {
    getContext: vi.fn(() => context),
    height: 0,
    width: 0,
  };
  return canvas as unknown as HTMLCanvasElement;
}

describe('shape fill rendering', () => {
  it('draws partial ellipses as open arcs with the configured dash gap', () => {
    const arc: ShapeElement = {
      ...DEFAULT_ELEMENT_STYLE,
      backgroundColor: '#a5d8ff',
      cornerRadius: 0,
      createdBy: 'test',
      ellipseEndAngle: 60,
      ellipseStartAngle: 300,
      height: 80,
      id: 'arc',
      opacity: 1,
      rotation: 0,
      shapeKind: 'ellipse',
      strokeDashGap: 17,
      strokeStyle: 'dashed',
      type: 'shape',
      width: 100,
      x: 10,
      y: 20,
    };
    const canvas = segmentRecordingCanvas([]);
    const context = canvas.getContext('2d');

    drawElements(canvas, {
      camera: { x: 0, y: 0, zoom: 1 },
      elements: [arc],
      size: { height: 200, width: 200 },
    });

    expect(context?.setLineDash).toHaveBeenCalledWith([8, 17]);
    expect(context?.ellipse).toHaveBeenCalledWith(
      60,
      60,
      50,
      40,
      0,
      (300 * Math.PI) / 180,
      (420 * Math.PI) / 180,
    );
    // Fill extends its un-stroked chord beneath the round endpoint caps, then
    // the renderer re-traces the open arc before applying the outline.
    expect(context?.fill).toHaveBeenCalledOnce();
    expect(context?.ellipse).toHaveBeenCalledTimes(2);
    expect(context?.lineTo).toHaveBeenCalledTimes(2);
    expect(context?.closePath).toHaveBeenCalledOnce();

    drawElements(canvas, {
      camera: { x: 0, y: 0, zoom: 1 },
      elements: [{ ...arc, backgroundColor: 'transparent' }],
      size: { height: 200, width: 200 },
    });
    // A transparent arc remains open and receives no second fill or closure.
    expect(context?.fill).toHaveBeenCalledOnce();
    expect(context?.ellipse).toHaveBeenCalledTimes(3);
    expect(context?.lineTo).toHaveBeenCalledTimes(2);
    expect(context?.closePath).toHaveBeenCalledOnce();
  });

  it('keeps canvas hatching inside a rounded outline', () => {
    // Half-side rounding turns the square into a circle, so a hatch point
    // beyond the radius is ink the outline never encloses.
    const rounded: ShapeElement = {
      ...DEFAULT_ELEMENT_STYLE,
      backgroundColor: '#a5d8ff',
      cornerRadius: 100,
      createdBy: 'test',
      fillStyle: 'cross-hatch',
      height: 200,
      id: 'rounded',
      opacity: 1,
      rotation: 0,
      shapeKind: 'rectangle',
      type: 'shape',
      width: 200,
      x: 0,
      y: 0,
    };
    const runs: { x: number; y: number }[] = [];
    drawElements(segmentRecordingCanvas(runs), {
      camera: { x: 0, y: 0, zoom: 1 },
      elements: [rounded],
      size: { height: 400, width: 400 },
    });

    expect(runs.length).toBeGreaterThan(0);
    for (const point of runs) {
      expect(Math.hypot(point.x - 100, point.y - 100)).toBeLessThanOrEqual(
        100 + 1e-6,
      );
    }
  });
});
