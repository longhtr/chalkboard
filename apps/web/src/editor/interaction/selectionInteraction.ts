/**
 * Pure multi-selection transformations: ordered move, resize, reorder, and drop.
 * One call returns one complete candidate document for a semantic commit.
 */
import {
  isImageElement,
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
    point,
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
  const moved = Math.abs(point.x - interaction.start.x) * zoom >= 1;
  if (!moved) return null;
  const updated = moveTrapezoidHandle(
    interaction.baseElement,
    interaction.handle,
    point,
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
  const bounds = resizedBounds(interaction.startBounds, {
    handle: interaction.handle,
    minimumSize: 8 / zoom,
    point,
    preserveAspectRatio:
      preserveAspectRatio ||
      (interaction.selectedIds.size === 1 &&
        interaction.baseSelectedElements.some(isImageElement)),
  });
  const preview = resizeElements(
    interaction.baseSelectedElements,
    interaction.selectedIds,
    interaction.startBounds,
    bounds,
  );
  interaction.changed = true;
  interaction.latestElements = preview;
  return preview;
}
