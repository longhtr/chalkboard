/** Converts viewport pixels into world-space bounds and filters elements by canonical geometry. */
import {
  boundsIntersect,
  elementBounds,
  type BoardElement,
  type Bounds,
  type Camera,
} from '@chalkboard/shared';

/** Current drawable viewport dimensions in CSS pixels. */
export interface ViewportSize {
  height: number;
  width: number;
}

/** Inverts the camera to obtain visible world bounds plus a screen margin. */
export function worldViewportBounds(
  camera: Camera,
  viewport: ViewportSize,
  screenMargin = 0,
): Bounds {
  const zoom = Math.max(camera.zoom, Number.EPSILON);
  return {
    height: (viewport.height + screenMargin * 2) / zoom,
    width: (viewport.width + screenMargin * 2) / zoom,
    x: (-camera.x - screenMargin) / zoom,
    y: (-camera.y - screenMargin) / zoom,
  };
}

/** Reports whether canonical element bounds intersect the expanded viewport. */
export function elementIntersectsViewport(
  element: BoardElement,
  camera: Camera,
  viewport: ViewportSize,
  screenMargin = 0,
): boolean {
  return boundsIntersect(
    elementBounds(element),
    worldViewportBounds(camera, viewport, screenMargin),
  );
}
