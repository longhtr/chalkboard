/**
 * Canonical persisted board-element schema. Coordinates and dimensions are
 * world-space values; camera pixels, selection, drafts, and other UI state do
 * not belong in these records.
 */
/** Persisted discriminator for every board element representation. */
export type ElementType =
  'rectangle' | 'shape' | 'line' | 'arrow' | 'freehand' | 'equation' | 'image';

/** Geometric outline represented by a modern shape element. */
export type ShapeKind =
  | 'rectangle'
  | 'triangle'
  | 'ellipse'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'parallelogram'
  | 'trapezoid'
  | 'star';
/** Visible dash pattern applied to an element outline. */
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
/** Geometry model used by a line element. */
export type PathKind = 'straight' | 'bezier' | 'orthogonal';
/** Positional, tangent, or curvature continuity requested between Bézier segments. */
export type SplineContinuity = 'c0' | 'c1' | 'c2';
/** Arrowhead placement on a line path. */
export type LineArrowheads = 'none' | 'end' | 'both';
/** How a shape's fill colour occupies its interior. */
export type FillStyle = 'cross-hatch' | 'hachure' | 'solid';
/**
 * Largest encoded image the application accepts, in bytes. Server admission,
 * browser import, and the end-to-end fixtures all read this one value: it has
 * drifted between them before, and a mismatch shows up as a confusing decode
 * error instead of an honest size refusal.
 */
export const MAX_ASSET_BYTES = 10_000_000;

/** Hard bound that keeps persisted freehand records and rendering work finite. */
export const MAX_FREEHAND_POINTS = 4_096;
/** Unitless line-height multiplier used when legacy equations omit spacing. */
export const DEFAULT_EQUATION_LINE_SPACING = 1.2;

/** Two-dimensional world-space coordinate or vector. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Visual attributes shared by every persisted element.
 *
 * `strokeColor` and `backgroundColor` hold the LIGHT theme's colors; the
 * optional `*Dark` siblings hold the dark theme's. Absent dark values are
 * derived at read time rather than written, so existing boards keep loading
 * unchanged. Resolve them through `resolveStrokeColor`/`resolveBackgroundColor`
 * in `themeColors.ts` instead of reading these fields directly for rendering.
 */
export interface ElementStyle {
  backgroundColor: string;
  /** Dark-theme fill; absent means derive from `backgroundColor`. */
  backgroundColorDark?: string;
  opacity: number;
  strokeColor: string;
  /** Dark-theme stroke; absent means derive from `strokeColor`. */
  strokeColorDark?: string;
  /** World-space empty run between dots or dashes; absent preserves the legacy default. */
  strokeDashGap?: number;
  strokeStyle?: StrokeStyle;
  strokeWidth: number;
}

/** Identity, world bounds, and visual state shared by persisted elements. */
export interface BaseElement extends ElementStyle {
  createdBy: string;
  height: number;
  id: string;
  rotation: number;
  type: ElementType;
  width: number;
  x: number;
  y: number;
}

/** Legacy rectangle stored by earlier Chalkboard versions. */
export interface RectangleElement extends BaseElement {
  type: 'rectangle';
}

/** Modern parametric shape whose outline is derived from bounds and shape kind. */
export interface ShapeElement extends BaseElement {
  cornerRadius: number;
  /** End of an ellipse arc in clockwise degrees; absent means 360°. */
  ellipseEndAngle?: number;
  /** Start of an ellipse arc in clockwise degrees from the right edge; absent means 0°. */
  ellipseStartAngle?: number;
  /** World-space gap between hatch lines; absent means the default. Solid fills ignore it. */
  fillSpacing?: number;
  /** Interior treatment for `backgroundColor`; absent means solid. */
  fillStyle?: FillStyle;
  shapeKind: ShapeKind;
  /** Normalized horizontal position of the trapezoid's top-left corner. */
  trapezoidTopLeft?: number;
  /** Normalized horizontal position of the trapezoid's top-right corner. */
  trapezoidTopRight?: number;
  type: 'shape';
}

/** Cubic Bézier controls and endpoint relative to the owning line origin. */
export interface BezierSegment {
  control1: Point;
  control2: Point;
  end: Point;
}

/** Straight, orthogonal, or cubic path with optional endpoint decoration. */
export interface LineElement extends BaseElement {
  arrowheads?: LineArrowheads;
  /** World-space rounding applied to orthogonal turns when rendering. */
  cornerRadius?: number;
  pathKind: PathKind;
  segments: BezierSegment[];
  splineContinuity?: SplineContinuity;
  /** True only when a Straight path intentionally uses all Space-created segments. */
  straightSegmented?: true;
  type: 'line';
}

/** Legacy straight arrow retained for persisted-format compatibility. */
export interface ArrowElement extends BaseElement {
  type: 'arrow';
}

/** Sampled freehand stroke whose points are relative to its world origin. */
export interface FreehandElement extends BaseElement {
  /** Endpoint decoration; direction comes from the sampled stroke tangent. */
  arrowheads?: LineArrowheads;
  points: Point[];
  type: 'freehand';
}

/** Raster or sanitized SVG image referenced by data URL or cloud asset URL. */
export interface ImageElement extends BaseElement {
  name: string;
  source: string;
  type: 'image';
}

/** Mixed prose/LaTeX block rendered and edited through MathLive. */
export interface EquationElement extends BaseElement {
  /** Font size used by the rendered MathLive view. */
  fontSize: number;
  /** Unitless multiplier; legacy elements default to 1.2. */
  lineSpacing?: number;
  source: string;
  /** Font size used by Source view; legacy elements derive this from fontSize. */
  sourceFontSize?: number;
  type: 'equation';
}

/** How much smaller the source view starts than the rendered view. */
export const EQUATION_SOURCE_FONT_SIZE_OFFSET = 3;

/**
 * Returns the source view's own size, or its default until it has one.
 *
 * The two views hold independent sizes, starting this far apart. A block keeps
 * answering with the default until the first time it changes view, which is
 * when the value is written down and the two stop moving together.
 */
export function equationSourceFontSize(element: EquationElement): number {
  return (
    element.sourceFontSize ??
    element.fontSize - EQUATION_SOURCE_FONT_SIZE_OFFSET
  );
}

/** Any element represented by a start/end path rather than an area. */
export type LinearElement = LineElement | ArrowElement;

/** Closed union accepted by storage, rendering, collaboration, and export. */
export type BoardElement =
  | RectangleElement
  | ShapeElement
  | LineElement
  | ArrowElement
  | FreehandElement
  | EquationElement
  | ImageElement;

/** Initial visual state for newly created elements, in both themes. */
export const DEFAULT_ELEMENT_STYLE: ElementStyle = {
  backgroundColor: 'transparent',
  opacity: 1,
  strokeColor: '#1f2937',
  strokeColorDark: '#e6e6ea',
  strokeStyle: 'solid',
  strokeWidth: 2,
};

/** Narrows any board element to a legacy or modern bounded shape. */
export function isShapeElement(
  element: BoardElement,
): element is RectangleElement | ShapeElement {
  return element.type === 'rectangle' || element.type === 'shape';
}

/** Narrows any board element to a line or legacy arrow. */
export function isLinearElement(
  element: BoardElement,
): element is LinearElement {
  return element.type === 'line' || element.type === 'arrow';
}

/** Narrows any board element to a sampled freehand stroke. */
export function isFreehandElement(
  element: BoardElement,
): element is FreehandElement {
  return element.type === 'freehand';
}

/** Narrows any board element to an image. */
export function isImageElement(element: BoardElement): element is ImageElement {
  return element.type === 'image';
}

/** Narrows any board element to a mixed prose/LaTeX block. */
export function isEquationElement(
  element: BoardElement,
): element is EquationElement {
  return element.type === 'equation';
}
