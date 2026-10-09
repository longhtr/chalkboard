/**
 * Stable editor tool identities, labels, and path submodes. Persisted toolbar
 * order stores these identifiers, so removals require compatibility handling.
 */
import type { PathKind, ShapeKind } from '@chalkboard/shared';

import type { IconName } from '../../components/Icon';

/** Stable top-level editor tool identifier. */
export type Tool = 'selection' | 'hand' | 'shape' | 'line' | 'equation';
/** Path drawing submode, including freehand strokes outside the line schema. */
export type PathToolKind = PathKind | 'freehand';

const TOOL_DEFINITIONS: {
  icon: IconName;
  label: string;
  tool: Tool;
}[] = [
  { icon: 'selection', label: 'Selection', tool: 'selection' },
  { icon: 'hand', label: 'Drag canvas', tool: 'hand' },
  { icon: 'rectangle', label: 'Shape', tool: 'shape' },
  { icon: 'line', label: 'Line / curve', tool: 'line' },
  { icon: 'text', label: 'Mixed text block', tool: 'equation' },
];

/** Canonical toolbar order used for new and repaired preferences. */
export const DEFAULT_TOOL_ORDER = TOOL_DEFINITIONS.map(({ tool }) => tool);
/** Icon and accessible label for every top-level tool. */
export const TOOL_DETAILS = Object.fromEntries(
  TOOL_DEFINITIONS.map((tool) => [tool.tool, tool]),
) as Record<Tool, (typeof TOOL_DEFINITIONS)[number]>;

/** Icon mapping for every persisted shape kind. */
export const SHAPE_ICONS: Record<ShapeKind, IconName> = {
  diamond: 'diamond',
  ellipse: 'ellipse',
  hexagon: 'hexagon',
  parallelogram: 'parallelogram',
  pentagon: 'pentagon',
  rectangle: 'rectangle',
  star: 'star',
  trapezoid: 'trapezoid',
  triangle: 'triangle',
};

/** Icon mapping for every line/freehand drawing submode. */
export const PATH_ICONS: Record<PathToolKind, IconName> = {
  bezier: 'curve',
  freehand: 'draw',
  orthogonal: 'orthogonal',
  straight: 'line',
};
