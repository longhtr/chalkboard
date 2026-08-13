/** Chooses the selected shape or Bézier line allowed to expose direct manipulation handles. */
import type {
  BoardElement,
  LineElement,
  ShapeElement,
} from '@chalkboard/shared';

import type { Tool } from './toolModel';

interface EditableHandleTargets {
  elementsForManipulation: BoardElement[];
  trapezoidHandlePreview: ShapeElement | undefined;
}

/** Resolves the one selected or just-created element eligible for direct handles. */
export function editableHandleTargets(options: {
  activeTool: Tool;
  recentlyCreated: BoardElement | undefined;
  selectedCount: number;
  selectedElements: readonly BoardElement[];
  splinePreview: LineElement | undefined;
}): EditableHandleTargets {
  const {
    activeTool,
    recentlyCreated,
    selectedCount,
    selectedElements,
    splinePreview,
  } = options;
  const trapezoidHandlePreview =
    activeTool === 'shape' &&
    selectedCount === 0 &&
    recentlyCreated?.type === 'shape' &&
    recentlyCreated.shapeKind === 'trapezoid'
      ? recentlyCreated
      : undefined;
  let elementsForManipulation: BoardElement[] = [];
  if (selectedElements.length > 0) {
    elementsForManipulation = [...selectedElements];
  } else if (trapezoidHandlePreview !== undefined) {
    elementsForManipulation = [trapezoidHandlePreview];
  } else if (splinePreview !== undefined) {
    elementsForManipulation = [splinePreview];
  }
  return { elementsForManipulation, trapezoidHandlePreview };
}
