/** Produces escaped portable SVG markup for non-equation board elements from canonical geometry. */
import {
  elementBounds,
  isFreehandElement,
  isLinearElement,
  isShapeElement,
  linePathGeometry,
  normalizeBounds,
  roundedPolygonCorners,
  shapeFillPolygon,
  shapeFillSegments,
  shapeHatchStrokeWidth,
  shapePolygonPoints,
  strokeEndDirection,
  type BoardElement,
  type Bounds,
  type Point,
} from '@chalkboard/shared';

/** Escapes text or attribute content before insertion into generated XML. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    if (character === '"') return '&quot;';
    return '&apos;';
  });
}

/** Emits finite SVG numbers with stable precision and a zero fallback. */
export function svgNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function point(value: Point): string {
  return `${svgNumber(value.x)},${svgNumber(value.y)}`;
}

function style(element: BoardElement, fillOverride?: string): string {
  const dash =
    element.strokeStyle === 'dashed'
      ? `${element.strokeWidth * 4} ${element.strokeWidth * 3}`
      : element.strokeStyle === 'dotted'
        ? `1 ${Math.max(4, element.strokeWidth * 2.5)}`
        : 'none';
  return [
    `fill:${fillOverride ?? element.backgroundColor}`,
    `stroke:${element.strokeColor}`,
    `stroke-width:${svgNumber(element.strokeWidth)}`,
    'stroke-linecap:round',
    'stroke-linejoin:round',
    `stroke-dasharray:${dash}`,
    `opacity:${svgNumber(element.opacity)}`,
  ].join(';');
}

function polygonPoints(element: BoardElement, bounds: Bounds): Point[] | null {
  if (!isShapeElement(element)) return null;
  const kind = element.type === 'shape' ? element.shapeKind : 'rectangle';
  return shapePolygonPoints(kind, bounds, {
    trapezoidTopLeft:
      element.type === 'shape' ? element.trapezoidTopLeft : undefined,
    trapezoidTopRight:
      element.type === 'shape' ? element.trapezoidTopRight : undefined,
  });
}

function roundedPolygonPath(points: readonly Point[], radius: number): string {
  const corners = roundedPolygonCorners(points, radius);
  const first = corners[0];
  if (first === undefined) return '';
  let path = `M ${point(first.exit)}`;
  for (let offset = 1; offset <= corners.length; offset += 1) {
    const corner = corners[offset % corners.length];
    if (corner === undefined) continue;
    path += ` L ${point(corner.entry)} Q ${point(corner.vertex)} ${point(corner.exit)}`;
  }
  return `${path} Z`;
}

/** Returns the world-space polygon for one line endpoint decoration. */
export function vectorArrowheadPoints(
  element: BoardElement,
  end: Point,
  direction: Point,
): [Point, Point, Point] {
  const angle = Math.atan2(direction.y, direction.x);
  const length = Math.max(10, element.strokeWidth * 5);
  return [
    {
      x: end.x - length * Math.cos(angle - Math.PI / 6),
      y: end.y - length * Math.sin(angle - Math.PI / 6),
    },
    end,
    {
      x: end.x - length * Math.cos(angle + Math.PI / 6),
      y: end.y - length * Math.sin(angle + Math.PI / 6),
    },
  ];
}

function arrowhead(
  element: BoardElement,
  end: Point,
  direction: Point,
): string {
  const [first, tip, second] = vectorArrowheadPoints(element, end, direction);
  return `<path d="M ${point(first)} L ${point(tip)} L ${point(second)}" style="fill:none;${style(element)}"/>`;
}

/**
 * Emits the hatch lines for a non-solid fill. Their colour, spacing, and weight
 * all come from the same shared geometry the canvas uses, so the two renderers
 * cannot disagree about what the fill looks like.
 */
function shapeFillSvg(element: BoardElement, bounds: Bounds): string {
  if (element.type !== 'shape') return '';
  const fillStyle = element.fillStyle ?? 'solid';
  if (fillStyle === 'solid' || element.backgroundColor === 'transparent') {
    return '';
  }
  const segments = shapeFillSegments(
    shapeFillPolygon(element.shapeKind, bounds, {
      cornerRadius: element.cornerRadius,
      trapezoidTopLeft: element.trapezoidTopLeft,
      trapezoidTopRight: element.trapezoidTopRight,
    }),
    fillStyle,
    element.fillSpacing,
  );
  if (segments.length === 0) return '';
  const path = segments
    .map(([start, end]) => `M ${point(start)} L ${point(end)}`)
    .join(' ');
  return `<path d="${path}" style="fill:none;stroke:${escapeXml(element.backgroundColor)};stroke-width:${svgNumber(shapeHatchStrokeWidth(element.strokeWidth))};opacity:${svgNumber(element.opacity)}"/>`;
}

function shapeSvg(element: BoardElement): string {
  const bounds = normalizeBounds(elementBounds(element));
  const kind = element.type === 'shape' ? element.shapeKind : 'rectangle';
  const hatch = shapeFillSvg(element, bounds);
  // A hatched interior replaces the solid one rather than sitting beneath it.
  const outline = style(element, hatch === '' ? undefined : 'none');
  if (kind === 'ellipse') {
    return `<ellipse cx="${svgNumber(bounds.x + bounds.width / 2)}" cy="${svgNumber(bounds.y + bounds.height / 2)}" rx="${svgNumber(bounds.width / 2)}" ry="${svgNumber(bounds.height / 2)}" style="${outline}"/>${hatch}`;
  }
  const points = polygonPoints(element, bounds);
  const radius = element.type === 'shape' ? element.cornerRadius : 0;
  if (points !== null) {
    return radius > 0
      ? `<path d="${roundedPolygonPath(points, radius)}" style="${outline}"/>${hatch}`
      : `<polygon points="${points.map(point).join(' ')}" style="${outline}"/>${hatch}`;
  }
  const rectangleRadius = Math.min(radius, bounds.width / 2, bounds.height / 2);
  return `<rect x="${svgNumber(bounds.x)}" y="${svgNumber(bounds.y)}" width="${svgNumber(bounds.width)}" height="${svgNumber(bounds.height)}" rx="${svgNumber(rectangleRadius)}" style="${outline}"/>${hatch}`;
}

function linearSvg(element: BoardElement): string {
  if (!isLinearElement(element)) return '';
  if (element.type === 'arrow') {
    const start = { x: element.x, y: element.y };
    const end = { x: element.x + element.width, y: element.y + element.height };
    return `<path d="M ${point(start)} L ${point(end)}" style="fill:none;${style(element)}"/>${arrowhead(element, end, { x: element.width, y: element.height })}`;
  }
  const geometry = linePathGeometry(element);
  let pathData = `M ${point(geometry.start)}`;
  if (geometry.kind === 'straight') pathData += ` L ${point(geometry.end)}`;
  else {
    for (const segment of geometry.segments) {
      pathData += ` C ${point(segment.control1)} ${point(segment.control2)} ${point(segment.end)}`;
    }
  }
  let decorations = '';
  const first = geometry.kind === 'bezier' ? geometry.segments[0] : undefined;
  const last =
    geometry.kind === 'bezier' ? geometry.segments.at(-1) : undefined;
  const end = geometry.kind === 'straight' ? geometry.end : last?.end;
  if (element.arrowheads === 'both') {
    const controlDirection =
      first === undefined
        ? null
        : {
            x: first.start.x - first.control1.x,
            y: first.start.y - first.control1.y,
          };
    const direction =
      controlDirection !== null &&
      Math.hypot(controlDirection.x, controlDirection.y) > 1e-6
        ? controlDirection
        : {
            x: geometry.start.x - (end?.x ?? geometry.start.x),
            y: geometry.start.y - (end?.y ?? geometry.start.y),
          };
    decorations += arrowhead(element, geometry.start, direction);
  }
  if (
    (element.arrowheads === 'end' || element.arrowheads === 'both') &&
    end !== undefined
  ) {
    const controlDirection =
      last === undefined
        ? null
        : { x: last.end.x - last.control2.x, y: last.end.y - last.control2.y };
    const direction =
      controlDirection !== null &&
      Math.hypot(controlDirection.x, controlDirection.y) > 1e-6
        ? controlDirection
        : {
            x:
              last === undefined
                ? end.x - geometry.start.x
                : last.end.x - last.start.x,
            y:
              last === undefined
                ? end.y - geometry.start.y
                : last.end.y - last.start.y,
          };
    decorations += arrowhead(element, end, direction);
  }
  return `<path d="${pathData}" style="fill:none;${style(element)}"/>${decorations}`;
}

function freehandSvg(element: BoardElement): string {
  if (!isFreehandElement(element) || element.points.length === 0) return '';
  const points = element.points.map(({ x, y }) => ({
    x: element.x + x,
    y: element.y + y,
  }));
  const stroke = `<polyline points="${points.map(point).join(' ')}" style="fill:none;${style(element)}"/>`;
  let decorations = '';
  const first = points[0];
  if (element.arrowheads === 'both' && first !== undefined) {
    const direction = strokeEndDirection(points, false);
    if (direction !== null) decorations += arrowhead(element, first, direction);
  }
  const last = points.at(-1);
  if (
    (element.arrowheads === 'end' || element.arrowheads === 'both') &&
    last !== undefined
  ) {
    const direction = strokeEndDirection(points, true);
    if (direction !== null) decorations += arrowhead(element, last, direction);
  }
  return `${stroke}${decorations}`;
}

/** Converts one non-image, non-equation board element to escaped SVG markup. */
export function vectorElementSvgMarkup(element: BoardElement): string {
  if (isShapeElement(element)) return shapeSvg(element);
  if (isLinearElement(element)) return linearSvg(element);
  if (isFreehandElement(element)) return freehandSvg(element);
  return '';
}

/** Converts an ordered vector-element sequence without changing render order. */
export function vectorElementsSvgMarkup(
  elements: readonly BoardElement[],
): string {
  return elements.map(vectorElementSvgMarkup).join('');
}
