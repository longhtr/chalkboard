/** Plans bounded world-space layer rectangles and device-pixel backing stores before rendering. */
import {
  rotatedSelectionBounds,
  worldToScreen,
  type BoardElement,
  type Camera,
} from '@chalkboard/shared';

import { canvasBackingSize, type CanvasSize } from './rendering';
import type { WorkspaceContentLayer } from './contentLayers';

const LAYER_MARGIN_PX = 40;
/** Maximum simultaneous canvas-backed content layers before SVG fallback. */
export const MAX_VISIBLE_CONTENT_CANVASES = 32;
/** Aggregate device-pixel budget shared by visible content canvases. */
export const MAX_CONTENT_CANVAS_BACKING_PIXELS = 16_777_216;

/** Screen crop and adjusted camera for one bounded content layer. */
export interface WorkspaceLayerCrop {
  camera: Camera;
  height: number;
  left: number;
  top: number;
  width: number;
}

interface CanvasLayerPlan {
  crop: WorkspaceLayerCrop;
  mode: 'canvas' | 'svg';
  requestedPixelRatio: number;
}

interface LayerRenderingPlan {
  canvasBackingPixels: number;
  canvasCount: number;
  layers: ReadonlyMap<string, CanvasLayerPlan>;
}

function layerCrop(
  elements: readonly BoardElement[],
  camera: Camera,
  canvasSize: CanvasSize,
): WorkspaceLayerCrop | null {
  // The ground the run covers after every turn, not the stored boxes: a crop
  // sized from the stored boxes cuts the corners off anything rotated.
  const bounds = rotatedSelectionBounds(elements);
  if (bounds === null) return null;
  const topLeft = worldToScreen(bounds, camera);
  const left = Math.max(0, Math.floor(topLeft.x - LAYER_MARGIN_PX));
  const top = Math.max(0, Math.floor(topLeft.y - LAYER_MARGIN_PX));
  const right = Math.min(
    canvasSize.width,
    Math.ceil(topLeft.x + bounds.width * camera.zoom + LAYER_MARGIN_PX),
  );
  const bottom = Math.min(
    canvasSize.height,
    Math.ceil(topLeft.y + bounds.height * camera.zoom + LAYER_MARGIN_PX),
  );
  if (right <= left || bottom <= top) return null;
  return {
    camera: { ...camera, x: camera.x - left, y: camera.y - top },
    height: bottom - top,
    left,
    top,
    width: right - left,
  };
}

/** Chooses canvas or SVG per layer without exceeding count or pixel budgets. */
export function planWorkspaceLayerRendering(
  layers: readonly WorkspaceContentLayer[],
  camera: Camera,
  canvasSize: CanvasSize,
  requestedPixelRatio: number,
): LayerRenderingPlan {
  const plans = new Map<string, CanvasLayerPlan>();
  let canvasBackingPixels = 0;
  let canvasCount = 0;

  for (const layer of layers) {
    if (layer.kind !== 'canvas') continue;
    const crop = layerCrop(layer.elements, camera, canvasSize);
    if (crop === null) continue;
    const backing = canvasBackingSize(crop, requestedPixelRatio);
    const useCanvas =
      canvasCount < MAX_VISIBLE_CONTENT_CANVASES &&
      backing.pixels <= MAX_CONTENT_CANVAS_BACKING_PIXELS - canvasBackingPixels;
    if (useCanvas) {
      canvasCount += 1;
      canvasBackingPixels += backing.pixels;
    }
    plans.set(layer.key, {
      crop,
      mode: useCanvas ? 'canvas' : 'svg',
      requestedPixelRatio,
    });
  }

  return { canvasBackingPixels, canvasCount, layers: plans };
}
