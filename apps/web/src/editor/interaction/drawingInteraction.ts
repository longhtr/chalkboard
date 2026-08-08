/**
 * Pure drawing-gesture transitions from pointer-down draft through move previews
 * to final admitted element. Device event cadence is normalized by shared fitters.
 */
import {
  bezierAccuracyTargetError,
  sampleBezierPoints,
  screenToWorld,
  type BoardElement,
  type Camera,
  type Point,
  type SplineContinuity,
} from '@chalkboard/shared';
import {
  appendFreehandSamples,
  finalizeDrawing,
  previewFreeDrawnPath,
  updateBezierDrawing,
  updateDrawingElement,
  updateFreehandDrawing,
  updateOrthogonalDrawing,
} from '../model/elementCreation';

const BEZIER_SAMPLE_TOLERANCE_PX = 1;
const MAX_BEZIER_GESTURE_POINTS = 8_192;
const COMPACTED_BEZIER_GESTURE_POINTS = 4_096;
const ORTHOGONAL_FIT_TOLERANCE_PX = 12;

/** User-selected curve complexity, accuracy, and knot continuity policy. */
export interface BezierFitSettings {
  accuracy: number;
  continuity: SplineContinuity;
  maxSegments: number | null;
}

/** Mutable pointer-lifetime state for one not-yet-committed drawing gesture. */
export interface DrawingInteraction {
  baseElements: BoardElement[];
  draft: BoardElement;
  kind: 'drawing';
  pointerId: number;
  points: Point[];
  start: Point;
}

/** Converts coalesced device events plus the current event into world samples. */
export function worldPointerSamples(
  event: PointerEvent,
  bounds: Pick<DOMRect, 'left' | 'top'>,
  camera: Camera,
  current: Point,
): Point[] {
  const coalescedEvents = event.getCoalescedEvents?.() ?? [];
  return [
    ...coalescedEvents.map((sample) =>
      screenToWorld(
        {
          x: sample.clientX - bounds.left,
          y: sample.clientY - bounds.top,
        },
        camera,
      ),
    ),
    current,
  ];
}

/** Advances the draft preview for one pointer move and updates sampled state. */
export function updateDrawingInteraction(
  interaction: DrawingInteraction,
  options: {
    constrain: boolean;
    samples: readonly Point[];
    worldPoint: Point;
    zoom: number;
  },
): BoardElement {
  const { constrain, samples, worldPoint, zoom } = options;
  let draft: BoardElement;
  if (interaction.draft.type === 'freehand') {
    interaction.points = appendFreehandSamples(
      interaction.points,
      samples,
      0.75 / zoom,
    );
    draft = updateFreehandDrawing(interaction.draft, interaction.points);
  } else if (
    interaction.draft.type === 'line' &&
    interaction.draft.pathKind !== 'straight'
  ) {
    for (const sample of samples) {
      const previous = interaction.points.at(-1);
      if (
        previous !== undefined &&
        previous.x === sample.x &&
        previous.y === sample.y
      ) {
        continue;
      }
      interaction.points.push(sample);
    }
    if (
      interaction.draft.pathKind === 'bezier' &&
      interaction.points.length > MAX_BEZIER_GESTURE_POINTS
    ) {
      interaction.points = sampleBezierPoints(
        interaction.points,
        BEZIER_SAMPLE_TOLERANCE_PX / (zoom * 4),
        COMPACTED_BEZIER_GESTURE_POINTS,
      );
    }
    const previewPoints =
      interaction.draft.pathKind === 'bezier'
        ? sampleBezierPoints(
            interaction.points,
            BEZIER_SAMPLE_TOLERANCE_PX / zoom,
          )
        : interaction.points;
    draft = previewFreeDrawnPath(interaction.draft, previewPoints);
  } else {
    draft = updateDrawingElement(interaction.draft, worldPoint, {
      constrainProportions: constrain,
    });
  }
  interaction.draft = draft;
  return draft;
}

/** Incorporates the final point, performs path fitting, and admits the draft. */
export function finalizeDrawingInteraction(
  interaction: DrawingInteraction,
  options: { fit: BezierFitSettings; point: Point; zoom: number },
): BoardElement | null {
  const { fit, point, zoom } = options;
  let draft = interaction.draft;
  if (draft.type === 'freehand') {
    interaction.points = appendFreehandSamples(
      interaction.points,
      [point],
      0.1 / zoom,
    );
    draft = updateFreehandDrawing(draft, interaction.points);
  } else if (draft.type === 'line' && draft.pathKind !== 'straight') {
    const previous = interaction.points.at(-1);
    if (
      previous === undefined ||
      Math.hypot(point.x - previous.x, point.y - previous.y) > 0.1 / zoom
    ) {
      interaction.points.push(point);
    }
    draft =
      draft.pathKind === 'bezier'
        ? updateBezierDrawing(
            draft,
            interaction.points,
            fit.maxSegments === null
              ? {
                  continuity: fit.continuity,
                  maxSegments: null,
                  sampleTolerance: BEZIER_SAMPLE_TOLERANCE_PX / zoom,
                  targetError: bezierAccuracyTargetError(fit.accuracy) / zoom,
                }
              : {
                  continuity: fit.continuity,
                  maxSegments: fit.maxSegments,
                  sampleTolerance: BEZIER_SAMPLE_TOLERANCE_PX / zoom,
                },
          )
        : updateOrthogonalDrawing(
            draft,
            interaction.points,
            ORTHOGONAL_FIT_TOLERANCE_PX / zoom,
          );
  }
  return finalizeDrawing(draft);
}
