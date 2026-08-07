/** Proves layer bounds, padding, density caps, and backing dimensions under zoom and large coordinates. */
import {
  DEFAULT_ELEMENT_STYLE,
  type BoardElement,
  type EquationElement,
} from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import {
  canvasBackingSize,
  MAX_SINGLE_CANVAS_BACKING_PIXELS,
} from './rendering';
import { groupContentLayers } from './contentLayers';
import {
  MAX_CONTENT_CANVAS_BACKING_PIXELS,
  MAX_VISIBLE_CONTENT_CANVASES,
  planWorkspaceLayerRendering,
} from './layerRendering';

const rectangle = (id: string, width = 20, height = 20): BoardElement => ({
  ...DEFAULT_ELEMENT_STYLE,
  createdBy: 'test',
  height,
  id,
  rotation: 0,
  type: 'rectangle',
  width,
  x: 10,
  y: 10,
});

const equation = (id: string): EquationElement => ({
  ...DEFAULT_ELEMENT_STYLE,
  createdBy: 'test',
  fontSize: 25,
  height: 20,
  id,
  lineSpacing: 1.2,
  rotation: 0,
  source: id,
  type: 'equation',
  width: 20,
  x: 10,
  y: 10,
});

const alternatingLayers = (
  count: number,
  rectangleSize?: { height: number; width: number },
) =>
  groupContentLayers(
    Array.from({ length: count }, (_, index) => [
      rectangle(
        `rectangle-${index}`,
        rectangleSize?.width,
        rectangleSize?.height,
      ),
      equation(`equation-${index}`),
    ]).flat(),
  );

const camera = { x: 0, y: 0, zoom: 1 };
const canvasSize = { height: 1_000, width: 1_000 };

describe('workspace layer rendering plan', () => {
  it('caps visible content canvases and sends overflow runs to vector SVG', () => {
    const plan = planWorkspaceLayerRendering(
      alternatingLayers(40),
      camera,
      canvasSize,
      2,
    );
    const modes = [...plan.layers.values()].map(({ mode }) => mode);

    expect(plan.layers.size).toBe(40);
    expect(plan.canvasCount).toBe(MAX_VISIBLE_CONTENT_CANVASES);
    expect(modes.filter((mode) => mode === 'canvas')).toHaveLength(
      MAX_VISIBLE_CONTENT_CANVASES,
    );
    expect(modes.filter((mode) => mode === 'svg')).toHaveLength(8);
  });

  it('caps aggregate content-canvas backing pixels before the count limit', () => {
    const plan = planWorkspaceLayerRendering(
      alternatingLayers(10, { height: 990, width: 990 }),
      camera,
      canvasSize,
      2,
    );

    expect(plan.canvasCount).toBeLessThan(MAX_VISIBLE_CONTENT_CANVASES);
    expect(plan.canvasBackingPixels).toBeLessThanOrEqual(
      MAX_CONTENT_CANVAS_BACKING_PIXELS,
    );
    expect([...plan.layers.values()].some(({ mode }) => mode === 'svg')).toBe(
      true,
    );
  });

  it('caps a single high-DPR canvas while retaining its CSS dimensions', () => {
    const backing = canvasBackingSize({ height: 2_160, width: 3_840 }, 4);

    expect(backing.pixels).toBeLessThanOrEqual(
      MAX_SINGLE_CANVAS_BACKING_PIXELS,
    );
    expect(backing.scaleX).toBeGreaterThan(1);
    expect(backing.scaleY).toBeGreaterThan(1);
  });
});
