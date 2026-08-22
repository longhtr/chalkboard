/**
 * Canvas rendering for grid, board elements, selection, and manipulation
 * previews. It consumes canonical geometry and never mutates element records.
 */
import { canvasChromeColors } from './canvasChrome';
import {
  elementBounds,
  elementRotationCenter,
  ellipseArcFillPoints,
  ellipseArcSweep,
  isFreehandElement,
  isFullEllipseArc,
  isLinearElement,
  isShapeElement,
  linePathGeometry,
  linePathVertices,
  normalizedEllipseArc,
  roundedPolygonCorners,
  roundedPolylineCorners,
  shapeFillPolygon,
  shapeFillSegments,
  shapeHatchStrokeWidth,
  shapePolygonPoints,
  strokeDashPattern,
  strokeEndDirection,
  trapezoidPoints,
  worldToScreen,
  type BoardElement,
  type Bounds,
  type Camera,
  type LineElement,
  type Point,
  type ShapeElement,
  type ShapeKind,
} from '@chalkboard/shared';

import {
  selectionCanRotate,
  selectionFrame,
  type SelectionFrame,
} from './interactionGeometry';
import { elementIntersectsViewport } from './viewportCulling';

// The canvas renderer owns pixel preparation and drawing, never document state
// or camera policy. Inputs arrive in their final board order.
/** CSS-pixel viewport dimensions shared by camera and render layers. */
export interface CanvasSize {
  height: number;
  width: number;
}

export type GridStyle = 'dots' | 'lines';

interface GridRenderOptions {
  camera: Camera;
  dotSize?: number;
  lineOpacity?: number;
  size: CanvasSize;
  spacing?: number;
  style?: GridStyle;
  visible: boolean;
}

interface ElementRenderOptions {
  camera: Camera;
  elements: readonly BoardElement[];
  requestedPixelRatio?: number | undefined;
  size: CanvasSize;
}

interface OverlayRenderOptions {
  bezierHandlePreview?: LineElement | undefined;
  boxSelection: Bounds | null;
  camera: Camera;
  selectedElements: readonly BoardElement[];
  size: CanvasSize;
  trapezoidHandlePreview?: ShapeElement | undefined;
}

/** Device-pixel ceiling for any one canvas backing store. */
export const MAX_SINGLE_CANVAS_BACKING_PIXELS = 16_777_216;

const CONTENT_CULL_MARGIN_PX = 32;
const DEFAULT_GRID_SPACING_WORLD_UNITS = 20;
const MAX_GRID_DOT_SEPARATION_PX = 120;
const MIN_GRID_DOT_SEPARATION_PX = 6;

interface CanvasBackingSize {
  height: number;
  pixels: number;
  scaleX: number;
  scaleY: number;
  width: number;
}

/**
 * Converts CSS dimensions to a device-pixel backing store while enforcing the
 * per-canvas allocation ceiling. Scaling down is preferable to an unbounded
 * allocation or a browser-specific canvas failure.
 */
export function canvasBackingSize(
  size: CanvasSize,
  requestedPixelRatio = window.devicePixelRatio || 1,
): CanvasBackingSize {
  const cssPixels = Math.max(1, size.width * size.height);
  const normalizedPixelRatio =
    Number.isFinite(requestedPixelRatio) && requestedPixelRatio > 0
      ? requestedPixelRatio
      : 1;
  const pixelRatio = Math.min(
    normalizedPixelRatio,
    Math.sqrt(MAX_SINGLE_CANVAS_BACKING_PIXELS / cssPixels),
  );
  const width = Math.max(1, Math.floor(size.width * pixelRatio));
  const height = Math.max(1, Math.floor(size.height * pixelRatio));
  return {
    height,
    pixels: width * height,
    scaleX: width / Math.max(1, size.width),
    scaleY: height / Math.max(1, size.height),
    width,
  };
}

function prepareCanvas(
  canvas: HTMLCanvasElement,
  size: CanvasSize,
  requestedPixelRatio?: number,
): CanvasRenderingContext2D | null {
  const backing = canvasBackingSize(size, requestedPixelRatio);

  if (canvas.width !== backing.width || canvas.height !== backing.height) {
    canvas.width = backing.width;
    canvas.height = backing.height;
  }

  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.setTransform(backing.scaleX, 0, 0, backing.scaleY, 0, 0);
  context.clearRect(0, 0, size.width, size.height);
  return context;
}

// Grid and content canvases share camera phase so panning cannot make the board
// appear to slide over an independently rounded background.
export function drawGrid(
  canvas: HTMLCanvasElement,
  options: GridRenderOptions,
): void {
  const {
    camera,
    dotSize = 1,
    lineOpacity = 0.3,
    size,
    spacing = DEFAULT_GRID_SPACING_WORLD_UNITS,
    style = 'dots',
    visible,
  } = options;
  const context = prepareCanvas(canvas, size);
  if (context === null || !visible) return;

  let gridSize = spacing * camera.zoom;
  while (gridSize < MIN_GRID_DOT_SEPARATION_PX) gridSize *= 2;
  while (gridSize > MAX_GRID_DOT_SEPARATION_PX) gridSize /= 2;

  const offsetX = ((camera.x % gridSize) + gridSize) % gridSize;
  const offsetY = ((camera.y % gridSize) + gridSize) % gridSize;
  context.globalAlpha = 1;
  const gridColor = canvasChromeColors().grid;

  if (style === 'lines') {
    // Continuous coverage reads much stronger than isolated dots even at the
    // same color. Reduce only line opacity so both styles keep one theme hue.
    context.globalAlpha = Math.min(1, Math.max(0.1, lineOpacity));
    context.beginPath();
    context.lineWidth = 1;
    context.strokeStyle = gridColor;
    for (let x = offsetX; x <= size.width; x += gridSize) {
      context.moveTo(x, 0);
      context.lineTo(x, size.height);
    }
    for (let y = offsetY; y <= size.height; y += gridSize) {
      context.moveTo(0, y);
      context.lineTo(size.width, y);
    }
    context.stroke();
    return;
  }

  context.fillStyle = gridColor;
  for (let x = offsetX; x <= size.width; x += gridSize) {
    for (let y = offsetY; y <= size.height; y += gridSize) {
      context.beginPath();
      context.arc(x, y, dotSize, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function applyElementStyle(
  context: CanvasRenderingContext2D,
  element: BoardElement,
): void {
  context.globalAlpha = element.opacity;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = element.strokeWidth;
  context.strokeStyle = element.strokeColor;
  context.fillStyle = element.backgroundColor;
  context.setLineDash([...strokeDashPattern(element)]);
}

/**
 * Continues an already-started path through an open polyline, rounding each
 * interior turn. The caller has moved to the first vertex, so this only emits
 * the runs and their arcs.
 */
function traceRoundedPolyline(
  context: CanvasRenderingContext2D,
  points: readonly Point[],
  radius: number,
): void {
  const corners = roundedPolylineCorners(points, radius);
  for (let index = 1; index < corners.length; index += 1) {
    const corner = corners[index];
    if (corner === undefined) continue;
    context.lineTo(corner.entry.x, corner.entry.y);
    if (index < corners.length - 1) {
      context.quadraticCurveTo(
        corner.vertex.x,
        corner.vertex.y,
        corner.exit.x,
        corner.exit.y,
      );
    }
  }
}

function tracePolygon(
  context: CanvasRenderingContext2D,
  points: readonly Point[],
  cornerRadius = 0,
): void {
  const first = points[0];
  if (first === undefined) return;
  if (cornerRadius <= 0 || points.length < 3) {
    context.moveTo(first.x, first.y);
    for (const point of points.slice(1)) context.lineTo(point.x, point.y);
    context.closePath();
    return;
  }

  const corners = roundedPolygonCorners(points, cornerRadius);
  const firstCorner = corners[0];
  if (firstCorner === undefined) return;
  context.moveTo(firstCorner.exit.x, firstCorner.exit.y);
  for (let offset = 1; offset <= corners.length; offset += 1) {
    const corner = corners[offset % corners.length];
    if (corner === undefined) continue;
    context.lineTo(corner.entry.x, corner.entry.y);
    context.quadraticCurveTo(
      corner.vertex.x,
      corner.vertex.y,
      corner.exit.x,
      corner.exit.y,
    );
  }
  context.closePath();
}

function traceShape(
  context: CanvasRenderingContext2D,
  element: Extract<BoardElement, { type: 'rectangle' | 'shape' }>,
  bounds: Bounds,
  shapeKind: ShapeKind,
  cornerRadius: number,
): void {
  context.beginPath();
  if (shapeKind === 'ellipse') {
    const range = normalizedEllipseArc(
      element.type === 'shape' ? element.ellipseStartAngle : undefined,
      element.type === 'shape' ? element.ellipseEndAngle : undefined,
    );
    const center = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    if (isFullEllipseArc(range)) {
      context.ellipse(
        center.x,
        center.y,
        bounds.width / 2,
        bounds.height / 2,
        0,
        0,
        Math.PI * 2,
      );
      return;
    }
    context.ellipse(
      center.x,
      center.y,
      bounds.width / 2,
      bounds.height / 2,
      0,
      (range.startAngle * Math.PI) / 180,
      ((range.startAngle + ellipseArcSweep(range)) * Math.PI) / 180,
    );
    return;
  }
  const polygon = shapePolygonPoints(shapeKind, bounds, {
    trapezoidTopLeft:
      element.type === 'shape' ? element.trapezoidTopLeft : undefined,
    trapezoidTopRight:
      element.type === 'shape' ? element.trapezoidTopRight : undefined,
  });
  if (polygon !== null) {
    tracePolygon(context, polygon, cornerRadius);
    return;
  }
  const radius = Math.min(
    Math.max(0, cornerRadius),
    bounds.width / 2,
    bounds.height / 2,
  );
  context.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, radius);
}

function drawShape(
  context: CanvasRenderingContext2D,
  element: Extract<BoardElement, { type: 'rectangle' | 'shape' }>,
): void {
  const bounds = elementBounds(element);
  const shapeKind = element.type === 'shape' ? element.shapeKind : 'rectangle';
  const cornerRadius = element.type === 'shape' ? element.cornerRadius : 0;
  const fillStyle =
    element.type === 'shape' ? (element.fillStyle ?? 'solid') : 'solid';
  const filled = element.backgroundColor !== 'transparent';

  if (filled && fillStyle !== 'solid') {
    // Hatch lines carry the fill colour and must not inherit the outline's
    // weight or dash pattern, so they run on their own saved state.
    context.save();
    context.strokeStyle = element.backgroundColor;
    context.lineWidth = shapeHatchStrokeWidth(element.strokeWidth);
    context.setLineDash([]);
    context.beginPath();
    for (const [start, end] of shapeFillSegments(
      shapeFillPolygon(shapeKind, bounds, {
        cornerRadius,
        ellipseEndAngle:
          element.type === 'shape' ? element.ellipseEndAngle : undefined,
        ellipseStartAngle:
          element.type === 'shape' ? element.ellipseStartAngle : undefined,
        strokeWidth: element.strokeWidth,
        trapezoidTopLeft:
          element.type === 'shape' ? element.trapezoidTopLeft : undefined,
        trapezoidTopRight:
          element.type === 'shape' ? element.trapezoidTopRight : undefined,
      }),
      fillStyle,
      element.type === 'shape' ? element.fillSpacing : undefined,
    )) {
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
    }
    context.stroke();
    context.restore();
  }

  const partialEllipseRange =
    shapeKind === 'ellipse' && element.type === 'shape'
      ? normalizedEllipseArc(element.ellipseStartAngle, element.ellipseEndAngle)
      : null;
  const partialEllipse =
    partialEllipseRange !== null && !isFullEllipseArc(partialEllipseRange);

  traceShape(context, element, bounds, shapeKind, cornerRadius);
  if (filled && fillStyle === 'solid') {
    if (partialEllipse && partialEllipseRange !== null) {
      const fillPoints = ellipseArcFillPoints(
        bounds,
        partialEllipseRange,
        element.strokeWidth / 2,
      );
      const shiftedEnd = fillPoints.at(-2);
      const shiftedStart = fillPoints.at(-1);
      if (shiftedEnd !== undefined && shiftedStart !== undefined) {
        context.lineTo(shiftedEnd.x, shiftedEnd.y);
        context.lineTo(shiftedStart.x, shiftedStart.y);
        context.closePath();
      }
    }
    context.fill();
    // Filling used a slightly extended closed chord beneath the round caps.
    // Re-trace before stroking so that chord itself remains invisible.
    if (partialEllipse) {
      traceShape(context, element, bounds, shapeKind, cornerRadius);
    }
  }
  context.stroke();
}

function drawArrowhead(
  context: CanvasRenderingContext2D,
  element: BoardElement,
  end: Point,
  direction: Point,
): void {
  const angle = Math.atan2(direction.y, direction.x);
  const length = Math.max(10, element.strokeWidth * 5);

  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(
    end.x - length * Math.cos(angle - Math.PI / 6),
    end.y - length * Math.sin(angle - Math.PI / 6),
  );
  context.moveTo(end.x, end.y);
  context.lineTo(
    end.x - length * Math.cos(angle + Math.PI / 6),
    end.y - length * Math.sin(angle + Math.PI / 6),
  );
  context.stroke();
}

/** Draws vector elements in their supplied bottom-to-top document order. */
export function drawElements(
  canvas: HTMLCanvasElement,
  options: ElementRenderOptions,
): void {
  const { camera, elements, requestedPixelRatio, size } = options;
  const context = prepareCanvas(canvas, size, requestedPixelRatio);
  if (context === null) return;

  context.save();
  context.translate(camera.x, camera.y);
  context.scale(camera.zoom, camera.zoom);

  for (const element of elements) {
    if (
      !elementIntersectsViewport(element, camera, size, CONTENT_CULL_MARGIN_PX)
    ) {
      continue;
    }
    context.save();
    // Rotation turns the canvas rather than the stored geometry, so every
    // shape below keeps drawing itself in its own unrotated coordinates.
    // `hitTestElement` undoes the same turn, which is what keeps what is drawn
    // and what answers a click in agreement.
    if (element.rotation !== 0) {
      const center = elementRotationCenter(element);
      context.translate(center.x, center.y);
      context.rotate((element.rotation * Math.PI) / 180);
      context.translate(-center.x, -center.y);
    }
    applyElementStyle(context, element);

    if (isShapeElement(element)) {
      drawShape(context, element);
    } else if (element.type === 'line') {
      const path = linePathGeometry(element);
      context.beginPath();
      context.moveTo(path.start.x, path.start.y);
      const orthogonalRadius =
        element.pathKind === 'orthogonal' ? (element.cornerRadius ?? 0) : 0;
      if (orthogonalRadius > 0) {
        traceRoundedPolyline(
          context,
          linePathVertices(element),
          orthogonalRadius,
        );
      } else if (path.kind === 'bezier') {
        for (const segment of path.segments) {
          context.bezierCurveTo(
            segment.control1.x,
            segment.control1.y,
            segment.control2.x,
            segment.control2.y,
            segment.end.x,
            segment.end.y,
          );
        }
      } else if (path.kind === 'polyline') {
        for (const point of path.points.slice(1)) {
          context.lineTo(point.x, point.y);
        }
      } else {
        context.lineTo(path.end.x, path.end.y);
      }
      context.stroke();
      const hasStartArrow = element.arrowheads === 'both';
      const hasEndArrow =
        element.arrowheads === 'end' || element.arrowheads === 'both';
      if (path.kind === 'straight') {
        if (hasStartArrow) {
          drawArrowhead(context, element, path.start, {
            x: path.start.x - path.end.x,
            y: path.start.y - path.end.y,
          });
        }
        if (hasEndArrow) {
          drawArrowhead(context, element, path.end, {
            x: path.end.x - path.start.x,
            y: path.end.y - path.start.y,
          });
        }
      } else if (path.kind === 'polyline') {
        const firstEnd = path.points[1];
        const finalEnd = path.points.at(-1);
        const finalStart = path.points.at(-2);
        if (hasStartArrow && firstEnd !== undefined) {
          drawArrowhead(context, element, path.start, {
            x: path.start.x - firstEnd.x,
            y: path.start.y - firstEnd.y,
          });
        }
        if (hasEndArrow && finalEnd !== undefined && finalStart !== undefined) {
          drawArrowhead(context, element, finalEnd, {
            x: finalEnd.x - finalStart.x,
            y: finalEnd.y - finalStart.y,
          });
        }
      } else {
        const firstSegment = path.segments[0];
        if (hasStartArrow && firstSegment !== undefined) {
          const controlDirection = {
            x: firstSegment.start.x - firstSegment.control1.x,
            y: firstSegment.start.y - firstSegment.control1.y,
          };
          const direction =
            Math.hypot(controlDirection.x, controlDirection.y) > 1e-6
              ? controlDirection
              : {
                  x: firstSegment.start.x - firstSegment.end.x,
                  y: firstSegment.start.y - firstSegment.end.y,
                };
          drawArrowhead(context, element, firstSegment.start, direction);
        }
        const finalSegment = path.segments.at(-1);
        if (hasEndArrow && finalSegment !== undefined) {
          const controlDirection = {
            x: finalSegment.end.x - finalSegment.control2.x,
            y: finalSegment.end.y - finalSegment.control2.y,
          };
          const direction =
            Math.hypot(controlDirection.x, controlDirection.y) > 1e-6
              ? controlDirection
              : {
                  x: finalSegment.end.x - finalSegment.start.x,
                  y: finalSegment.end.y - finalSegment.start.y,
                };
          drawArrowhead(context, element, finalSegment.end, direction);
        }
      }
    } else if (isLinearElement(element)) {
      context.beginPath();
      context.moveTo(element.x, element.y);
      context.lineTo(element.x + element.width, element.y + element.height);
      context.stroke();
      if (element.type === 'arrow') {
        drawArrowhead(
          context,
          element,
          { x: element.x + element.width, y: element.y + element.height },
          { x: element.width, y: element.height },
        );
      }
    } else if (isFreehandElement(element) && element.points.length > 0) {
      const first = element.points[0];
      if (first !== undefined) {
        context.beginPath();
        context.moveTo(element.x + first.x, element.y + first.y);
        for (const point of element.points.slice(1)) {
          context.lineTo(element.x + point.x, element.y + point.y);
        }
        context.stroke();
      }
      const last = element.points.at(-1);
      if (element.arrowheads === 'both' && first !== undefined) {
        const direction = strokeEndDirection(element.points, false);
        if (direction !== null) {
          drawArrowhead(
            context,
            element,
            { x: element.x + first.x, y: element.y + first.y },
            direction,
          );
        }
      }
      if (
        (element.arrowheads === 'end' || element.arrowheads === 'both') &&
        last !== undefined
      ) {
        const direction = strokeEndDirection(element.points, true);
        if (direction !== null) {
          drawArrowhead(
            context,
            element,
            { x: element.x + last.x, y: element.y + last.y },
            direction,
          );
        }
      }
    }

    context.restore();
  }

  context.restore();
}

/**
 * Draws the selection box, its eight resize handles and the rotation handle.
 *
 * The whole thing is drawn upright and then turned about the frame's centre,
 * exactly as an element is. That is what keeps the chrome on the shape: drawing
 * it from the stored upright bounds left the box beside a turned shape rather
 * than around it.
 */
function drawSelectionBounds(
  context: CanvasRenderingContext2D,
  frame: SelectionFrame,
  camera: Camera,
  canRotate: boolean,
): void {
  const bounds = frame.bounds;
  context.save();
  if (frame.rotation !== 0) {
    const center = worldToScreen(frame.center, camera);
    context.translate(center.x, center.y);
    context.rotate((frame.rotation * Math.PI) / 180);
    context.translate(-center.x, -center.y);
  }
  const topLeft = worldToScreen({ x: bounds.x, y: bounds.y }, camera);
  const width = bounds.width * camera.zoom;
  const height = bounds.height * camera.zoom;

  context.strokeStyle = canvasChromeColors().accent;
  context.lineWidth = 1.5;
  context.setLineDash([]);
  context.strokeRect(topLeft.x - 4, topLeft.y - 4, width + 8, height + 8);

  if (bounds.width < 3 || bounds.height < 3) {
    context.restore();
    return;
  }
  const handles = [
    [topLeft.x - 4, topLeft.y - 4],
    [topLeft.x + width / 2, topLeft.y - 4],
    [topLeft.x + width + 4, topLeft.y - 4],
    [topLeft.x + width + 4, topLeft.y + height / 2],
    [topLeft.x + width + 4, topLeft.y + height + 4],
    [topLeft.x + width / 2, topLeft.y + height + 4],
    [topLeft.x - 4, topLeft.y + height + 4],
    [topLeft.x - 4, topLeft.y + height / 2],
  ];
  context.fillStyle = canvasChromeColors().handle;
  for (const handle of handles) {
    const [x, y] = handle;
    if (x === undefined || y === undefined) continue;
    context.fillRect(x - 3.5, y - 3.5, 7, 7);
    context.strokeRect(x - 3.5, y - 3.5, 7, 7);
  }

  // The rotation handle is a circle above the top edge, on a short stalk. It is
  // round where the resize handles are square, and set apart from them, so the
  // two cannot be mistaken for one another either by eye or by the pointer.
  // A selection that cannot turn is drawn without it, so nothing offers a grab
  // the hit test would refuse.
  if (!canRotate) {
    context.restore();
    return;
  }
  const rotation = { x: topLeft.x + width / 2, y: topLeft.y - 4 - 22 };
  context.beginPath();
  context.moveTo(rotation.x, topLeft.y - 4);
  context.lineTo(rotation.x, rotation.y + 4);
  context.stroke();
  context.beginPath();
  context.arc(rotation.x, rotation.y, 4.5, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

function drawTrapezoidHandles(
  context: CanvasRenderingContext2D,
  element: Extract<BoardElement, { type: 'shape' }>,
  camera: Camera,
): void {
  // Handles are stored upright, so the canvas is turned exactly as it is for
  // the element itself. That keeps every handle sitting on the shape it edits.
  context.save();
  if (element.rotation !== 0) {
    const pivot = worldToScreen(elementRotationCenter(element), camera);
    context.translate(pivot.x, pivot.y);
    context.rotate((element.rotation * Math.PI) / 180);
    context.translate(-pivot.x, -pivot.y);
  }
  if (element.shapeKind !== 'trapezoid') return;
  const handles = trapezoidPoints(
    element,
    element.trapezoidTopLeft,
    element.trapezoidTopRight,
  )
    .slice(0, 2)
    .map((point) => worldToScreen(point, camera));
  context.save();
  const trapezoidChrome = canvasChromeColors();
  context.strokeStyle = trapezoidChrome.accent;
  context.fillStyle = trapezoidChrome.handle;
  context.lineWidth = 1.5;
  context.setLineDash([]);
  for (const point of handles) {
    context.beginPath();
    context.arc(point.x, point.y, 5, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  context.restore();
  context.restore();
}

function drawBezierHandles(
  context: CanvasRenderingContext2D,
  element: LineElement,
  camera: Camera,
): void {
  const editableStraight = element.pathKind === 'straight';
  if (
    element.pathKind !== 'bezier' &&
    element.pathKind !== 'orthogonal' &&
    !editableStraight
  ) {
    return;
  }
  // Handles are stored upright, so the canvas is turned exactly as it is for
  // the element itself. That keeps every handle sitting on the shape it edits.
  context.save();
  if (element.rotation !== 0) {
    const pivot = worldToScreen(elementRotationCenter(element), camera);
    context.translate(pivot.x, pivot.y);
    context.rotate((element.rotation * Math.PI) / 180);
    context.translate(-pivot.x, -pivot.y);
  }
  const path = linePathGeometry(element);
  const controls: Point[] = [];
  const nodes = linePathVertices(element).map((point) =>
    worldToScreen(point, camera),
  );
  const end = element.segments.at(-1)?.end;
  // Straight and orthogonal nodes are draggable but have no editable cubic
  // controls, so control dots and dashed tethers stay hidden for those kinds.
  const controlsLocked =
    element.pathKind !== 'bezier' ||
    (element.splineContinuity === 'c2' &&
      end !== undefined &&
      Math.hypot(end.x, end.y) <= 1e-6);

  context.save();
  context.strokeStyle = 'rgb(105 101 219 / 62%)';
  context.lineWidth = 1;
  context.setLineDash([4, 4]);
  context.beginPath();
  if (path.kind === 'bezier') {
    for (const segment of path.segments) {
      const start = worldToScreen(segment.start, camera);
      const control1 = worldToScreen(segment.control1, camera);
      const control2 = worldToScreen(segment.control2, camera);
      const end = worldToScreen(segment.end, camera);
      if (!controlsLocked) {
        context.moveTo(start.x, start.y);
        context.lineTo(control1.x, control1.y);
        context.moveTo(end.x, end.y);
        context.lineTo(control2.x, control2.y);
        controls.push(control1, control2);
      }
    }
  }
  context.stroke();
  context.setLineDash([]);

  const bezierChrome = canvasChromeColors();
  context.strokeStyle = bezierChrome.accent;
  context.lineWidth = 1.5;
  for (const point of controls) {
    context.beginPath();
    context.arc(point.x, point.y, 4, 0, Math.PI * 2);
    context.fillStyle = bezierChrome.handle;
    context.fill();
    context.stroke();
  }
  for (const point of nodes) {
    context.beginPath();
    context.arc(point.x, point.y, 4, 0, Math.PI * 2);
    context.fillStyle = bezierChrome.accent;
    context.fill();
    context.stroke();
  }
  context.restore();
  context.restore();
}

/**
 * Draws transient interaction state after persistent content: selection,
 * handles, collaborators, and the in-progress gesture. Nothing drawn here may
 * become durable without a separate semantic commit.
 */
export function drawOverlay(
  canvas: HTMLCanvasElement,
  options: OverlayRenderOptions,
): void {
  const {
    bezierHandlePreview,
    boxSelection,
    camera,
    selectedElements,
    size,
    trapezoidHandlePreview,
  } = options;
  const context = prepareCanvas(canvas, size);
  if (context === null) return;

  const selectedFrame = selectionFrame(selectedElements);
  if (selectedFrame !== null)
    drawSelectionBounds(
      context,
      selectedFrame,
      camera,
      selectionCanRotate(selectedElements),
    );
  const selectedTrapezoid =
    selectedElements.length === 1 &&
    selectedElements[0]?.type === 'shape' &&
    selectedElements[0].shapeKind === 'trapezoid'
      ? selectedElements[0]
      : undefined;
  const trapezoidWithVisibleHandles =
    selectedTrapezoid ?? trapezoidHandlePreview;
  if (trapezoidWithVisibleHandles !== undefined)
    drawTrapezoidHandles(context, trapezoidWithVisibleHandles, camera);

  const selectedBezier =
    selectedElements.length === 1 && selectedElements[0]?.type === 'line'
      ? selectedElements[0]
      : undefined;
  const bezierWithVisibleHandles = selectedBezier ?? bezierHandlePreview;
  if (bezierWithVisibleHandles !== undefined)
    drawBezierHandles(context, bezierWithVisibleHandles, camera);

  if (boxSelection !== null) {
    const bounds = {
      ...boxSelection,
      width: boxSelection.width * camera.zoom,
      height: boxSelection.height * camera.zoom,
    };
    const topLeft = worldToScreen(boxSelection, camera);
    const marqueeChrome = canvasChromeColors();
    context.save();
    context.fillStyle = marqueeChrome.accent;
    context.strokeStyle = marqueeChrome.accent;
    context.lineWidth = 1;
    context.setLineDash([6, 4]);
    context.globalAlpha = 0.08;
    context.fillRect(topLeft.x, topLeft.y, bounds.width, bounds.height);
    context.globalAlpha = 1;
    context.strokeRect(topLeft.x, topLeft.y, bounds.width, bounds.height);
    context.restore();
  }
}
