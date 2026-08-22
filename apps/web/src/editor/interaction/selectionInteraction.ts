/**
 * Pure multi-selection transformations: ordered move, resize, reorder, and drop.
 * One call returns one complete candidate document for a semantic commit.
 */
import {
  elementRotationCenter,
  isImageElement,
  rotatePoint,
  translateElement,
  type BoardElement,
  type Bounds,
  type LineElement,
  type Point,
  type ShapeElement,
} from '@chalkboard/shared';

import {
  moveBezierHandle,
  moveTrapezoidHandle,
  resizeElements,
  resizedBounds,
  type BezierHandle,
  type ResizeHandle,
  type SelectionFrame,
  type TrapezoidHandle,
} from './interactionGeometry';

const SELECTION_DRAG_THRESHOLD_PX = 4;

/** Relative or absolute movement through bottom-to-top render order. */
export type SelectionOrderCommand =
  'backward' | 'forward' | 'to-back' | 'to-front';

function unchangedOrder(
  previous: BoardElement[],
  next: readonly BoardElement[],
): BoardElement[] {
  return previous.every((element, index) => next[index] === element)
    ? previous
    : [...next];
}

/** Board order is bottom-to-top: later elements render and hit-test above earlier ones. */
export function reorderSelectedElements(
  elements: BoardElement[],
  selectedIds: ReadonlySet<string>,
  command: SelectionOrderCommand,
): BoardElement[] {
  if (selectedIds.size === 0 || elements.length < 2) return elements;

  if (command === 'to-front' || command === 'to-back') {
    const selected = elements.filter(({ id }) => selectedIds.has(id));
    if (selected.length === 0 || selected.length === elements.length) {
      return elements;
    }
    const unselected = elements.filter(({ id }) => !selectedIds.has(id));
    return unchangedOrder(
      elements,
      command === 'to-front'
        ? [...unselected, ...selected]
        : [...selected, ...unselected],
    );
  }

  const reordered = [...elements];
  if (command === 'forward') {
    for (let index = reordered.length - 2; index >= 0; index -= 1) {
      const current = reordered[index];
      const above = reordered[index + 1];
      if (
        current !== undefined &&
        above !== undefined &&
        selectedIds.has(current.id) &&
        !selectedIds.has(above.id)
      ) {
        reordered[index] = above;
        reordered[index + 1] = current;
      }
    }
  } else {
    for (let index = 1; index < reordered.length; index += 1) {
      const current = reordered[index];
      const below = reordered[index - 1];
      if (
        current !== undefined &&
        below !== undefined &&
        selectedIds.has(current.id) &&
        !selectedIds.has(below.id)
      ) {
        reordered[index] = below;
        reordered[index - 1] = current;
      }
    }
  }
  return unchangedOrder(elements, reordered);
}

/** Translates every selected object by one shared board-space delta. */
export function translateSelectedElements(
  elements: BoardElement[],
  selectedIds: ReadonlySet<string>,
  delta: Point,
): BoardElement[] {
  if (selectedIds.size === 0 || (delta.x === 0 && delta.y === 0)) {
    return elements;
  }
  let changed = false;
  const translated = elements.map((element) => {
    if (!selectedIds.has(element.id)) return element;
    changed = true;
    return translateElement(element, delta);
  });
  return changed ? translated : elements;
}

/** Moves selected elements beside a navigator target while preserving group order. */
export function moveSelectedElementsTo(
  elements: BoardElement[],
  selectedIds: ReadonlySet<string>,
  targetId: string,
  placement: 'after' | 'before',
): BoardElement[] {
  if (selectedIds.size === 0 || selectedIds.has(targetId)) return elements;

  // The navigator displays the reverse of storage/render order.
  const displayed = [...elements].reverse();
  const moving = displayed.filter(({ id }) => selectedIds.has(id));
  if (moving.length === 0) return elements;
  const remaining = displayed.filter(({ id }) => !selectedIds.has(id));
  const targetIndex = remaining.findIndex(({ id }) => id === targetId);
  if (targetIndex < 0) return elements;
  const insertionIndex = targetIndex + (placement === 'after' ? 1 : 0);
  const nextDisplayed = [
    ...remaining.slice(0, insertionIndex),
    ...moving,
    ...remaining.slice(insertionIndex),
  ];
  return unchangedOrder(elements, nextDisplayed.reverse());
}

/** Pointer-lifetime state for dragging one Bézier handle. */
export interface BezierHandleInteraction {
  baseElement: LineElement;
  baseElements: BoardElement[];
  changed: boolean;
  handle: BezierHandle;
  kind: 'bezier-handle';
  latestElements: BoardElement[];
  pointerId: number;
  start: Point;
}

/** Pointer-lifetime state for dragging one trapezoid top corner. */
export interface TrapezoidHandleInteraction {
  baseElement: ShapeElement;
  baseElements: BoardElement[];
  changed: boolean;
  handle: TrapezoidHandle;
  kind: 'trapezoid-handle';
  latestElements: BoardElement[];
  pointerId: number;
  start: Point;
}

/** Pointer-lifetime state for translating the current selection. */
export interface DraggingInteraction {
  baseElements: BoardElement[];
  baseSelectedElements: BoardElement[];
  changed: boolean;
  kind: 'dragging';
  latestElements: BoardElement[];
  pointerId: number;
  start: Point;
}

/** Pointer-lifetime state for scaling the current selection. */
export interface ResizingInteraction {
  /** The frame as it stood when the drag began, including its angle. */
  startFrame: SelectionFrame;
  baseElements: BoardElement[];
  baseSelectedElements: BoardElement[];
  changed: boolean;
  handle: ResizeHandle;
  kind: 'resizing';
  latestElements: BoardElement[];
  pointerId: number;
  selectedIds: Set<string>;
  start: Point;
  startBounds: Bounds;
}

/** Pointer-lifetime state for turning the current selection. */
export interface RotatingInteraction {
  baseElements: BoardElement[];
  baseSelectedElements: BoardElement[];
  center: Point;
  changed: boolean;
  kind: 'rotating';
  latestElements: BoardElement[];
  pointerId: number;
  startAngle: number;
}

/** Angle in degrees from a centre to a point, measured clockwise from north. */
function angleFromCenter(center: Point, point: Point): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

/** Rotation steps the caret snaps to while a modifier is held, in degrees. */
const ROTATION_SNAP_DEGREES = 15;

/**
 * Advances a rotation preview.
 *
 * The angle is taken from where the pointer is now against where it started,
 * so grabbing the handle never makes the selection jump: the first move of a
 * drag is a rotation of nearly zero. Every selected element turns by the same
 * amount around one shared centre, which is what keeps a group's arrangement
 * intact instead of spinning each piece where it stands.
 */
export function updateRotatingInteraction(
  interaction: RotatingInteraction,
  point: Point,
  { snap }: { snap: boolean },
): BoardElement[] | null {
  const delta =
    angleFromCenter(interaction.center, point) - interaction.startAngle;
  const preview = interaction.baseSelectedElements.map((element) => {
    const next = element.rotation + delta;
    const snapped = snap
      ? Math.round(next / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES
      : next;
    // Keep the stored angle inside one turn so it cannot grow without bound
    // across many drags, while still reading the same on screen.
    const wrapped = ((snapped % 360) + 360) % 360;
    const turned = { ...element, rotation: wrapped };
    // Each element also has to travel around the shared centre, or a group
    // would spin every piece where it stands and fly apart instead of turning
    // as one arrangement. A single selection turns about itself, so its centre
    // is the shared centre and this moves it nowhere.
    const before = elementRotationCenter(element);
    const after = rotatePoint(
      before,
      interaction.center,
      snapped - element.rotation,
    );
    return translateElement(turned, {
      x: after.x - before.x,
      y: after.y - before.y,
    });
  });
  interaction.changed = true;
  interaction.latestElements = preview;
  return preview;
}

/** Materializes sparse pointer changes only when one semantic commit finishes. */
export function applyElementChanges(
  baseElements: BoardElement[],
  changedElements: readonly BoardElement[],
): BoardElement[] {
  if (changedElements.length === 0) return baseElements;
  const changedById = new Map(
    changedElements.map((element) => [element.id, element]),
  );
  const materialized = baseElements.map((element) => {
    const changed = changedById.get(element.id);
    changedById.delete(element.id);
    return changed ?? element;
  });
  materialized.push(...changedById.values());
  return materialized;
}

/** Advances a Bézier-handle preview after the drag threshold. */
/**
 * A world point brought back into an element's upright coordinates.
 *
 * A handle's stored position never turns, so a drag has to be measured in the
 * same upright space the handle lives in. Skip this and dragging a node on a
 * turned curve pulls it off at the angle of the turn.
 */
function inElementFrame(point: Point, element: BoardElement): Point {
  return element.rotation === 0
    ? point
    : rotatePoint(point, elementRotationCenter(element), -element.rotation);
}

export function updateBezierHandleInteraction(
  interaction: BezierHandleInteraction,
  point: Point,
  zoom: number,
): BoardElement[] | null {
  const moved =
    Math.hypot(point.x - interaction.start.x, point.y - interaction.start.y) *
      zoom >=
    1;
  if (!moved) return null;
  const updated = moveBezierHandle(
    interaction.baseElement,
    interaction.handle,
    inElementFrame(point, interaction.baseElement),
  );
  const preview = [updated];
  interaction.changed = true;
  interaction.latestElements = preview;
  return preview;
}

/** Advances a trapezoid-handle preview after the drag threshold. */
export function updateTrapezoidHandleInteraction(
  interaction: TrapezoidHandleInteraction,
  point: Point,
  zoom: number,
): BoardElement[] | null {
  // The handle only travels along the shape's own top edge, so the threshold
  // has to be measured along that edge too. Measuring it across the screen
  // would ignore the whole drag on a shape turned a quarter turn, whose top
  // edge runs up and down the screen.
  const local = inElementFrame(point, interaction.baseElement);
  const start = inElementFrame(interaction.start, interaction.baseElement);
  const moved = Math.abs(local.x - start.x) * zoom >= 1;
  if (!moved) return null;
  const updated = moveTrapezoidHandle(
    interaction.baseElement,
    interaction.handle,
    local,
  );
  const preview = [updated];
  interaction.changed = true;
  interaction.latestElements = preview;
  return preview;
}

/** Advances a selection translation preview after the drag threshold. */
export function updateDraggingInteraction(
  interaction: DraggingInteraction,
  point: Point,
  zoom: number,
): BoardElement[] | null {
  const delta = {
    x: point.x - interaction.start.x,
    y: point.y - interaction.start.y,
  };
  if (Math.hypot(delta.x, delta.y) * zoom < SELECTION_DRAG_THRESHOLD_PX) {
    const shouldRestorePreview = interaction.changed;
    interaction.changed = false;
    interaction.latestElements = [];
    return shouldRestorePreview ? [] : null;
  }
  const preview = interaction.baseSelectedElements.map((element) =>
    translateElement(element, delta),
  );
  interaction.changed = true;
  interaction.latestElements = preview;
  return preview;
}

/** Advances a selection resize preview after the drag threshold. */
/**
 * The corner or edge midpoint a resize keeps still, in upright coordinates.
 *
 * Dragging the east edge holds the west one, dragging a corner holds the
 * opposite corner, and dragging a single edge holds the midpoint of the one
 * across from it. Each of those points is unchanged by the resize itself, which
 * is what makes it usable as an anchor.
 */
function resizeAnchor(bounds: Bounds, handle: ResizeHandle): Point {
  const west = handle.endsWith('west');
  const east = handle.endsWith('east');
  const north = handle.startsWith('north');
  const south = handle.startsWith('south');
  return {
    x: east
      ? bounds.x
      : west
        ? bounds.x + bounds.width
        : bounds.x + bounds.width / 2,
    y: south
      ? bounds.y
      : north
        ? bounds.y + bounds.height
        : bounds.y + bounds.height / 2,
  };
}

/** Shifts resized bounds so the anchor stays where it was on screen. */
function anchorPreservingBounds(
  bounds: Bounds,
  startBounds: Bounds,
  handle: ResizeHandle,
  frame: SelectionFrame,
): Bounds {
  if (frame.rotation === 0) return bounds;
  const center = (value: Bounds): Point => ({
    x: value.x + value.width / 2,
    y: value.y + value.height / 2,
  });
  const held = rotatePoint(
    resizeAnchor(startBounds, handle),
    frame.center,
    frame.rotation,
  );
  const drifted = rotatePoint(
    resizeAnchor(bounds, handle),
    center(bounds),
    frame.rotation,
  );
  return {
    ...bounds,
    x: bounds.x + (held.x - drifted.x),
    y: bounds.y + (held.y - drifted.y),
  };
}

export function updateResizingInteraction(
  interaction: ResizingInteraction,
  point: Point,
  zoom: number,
  { preserveAspectRatio }: { preserveAspectRatio: boolean },
): BoardElement[] | null {
  const delta = {
    x: point.x - interaction.start.x,
    y: point.y - interaction.start.y,
  };
  if (Math.hypot(delta.x, delta.y) * zoom < SELECTION_DRAG_THRESHOLD_PX) {
    const shouldRestorePreview = interaction.changed;
    interaction.changed = false;
    interaction.latestElements = [];
    return shouldRestorePreview ? [] : null;
  }
  const frame = interaction.startFrame;
  // A turned selection is resized in its own upright coordinates: undo the turn
  // on the pointer, do the ordinary arithmetic, then put the result back. The
  // alternative -- resizing along the screen axes -- makes a dragged corner move
  // sideways to what the reader is holding.
  const local = rotatePoint(point, frame.center, -frame.rotation);
  const bounds = resizedBounds(interaction.startBounds, {
    handle: interaction.handle,
    minimumSize: 8 / zoom,
    point: local,
    preserveAspectRatio:
      preserveAspectRatio ||
      (interaction.selectedIds.size === 1 &&
        interaction.baseSelectedElements.some(isImageElement)),
  });
  // Scaling moves the centre, and the shape turns about its centre, so the edge
  // the reader is *not* dragging would drift across the canvas. Shifting the
  // result by however far its anchor moved pins that edge where it was.
  const anchored = anchorPreservingBounds(
    bounds,
    interaction.startBounds,
    interaction.handle,
    frame,
  );
  const preview = resizeElements(
    interaction.baseSelectedElements,
    interaction.selectedIds,
    interaction.startBounds,
    anchored,
  );
  interaction.changed = true;
  interaction.latestElements = preview;
  return preview;
}
