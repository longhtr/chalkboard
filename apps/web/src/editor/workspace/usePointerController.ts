/**
 * Exclusive pointer-gesture state machine for selection, drawing, dragging,
 * resizing, direct handles, equation activation, and pan. Pointer-frequency
 * previews are frame-batched; only pointer completion creates a semantic commit.
 */
import {
  boundsIntersect,
  elementBounds,
  hitTestElement,
  isEquationElement,
  normalizeBounds,
  screenToWorld,
  selectionBounds,
  type BoardElement,
  type Bounds,
  type Camera,
  type ElementStyle,
  type EquationElement,
  type LineArrowheads,
  type Point,
  type FillStyle,
  type ShapeKind,
} from '@chalkboard/shared';
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react';

import {
  finalizeDrawingInteraction,
  updateDrawingInteraction,
  worldPointerSamples,
  type BezierFitSettings,
  type DrawingInteraction,
} from '../interaction/drawingInteraction';
import { createElement } from '../model/elementCreation';
import type { EditorDocumentAction } from '../model/editorState';
import {
  findBezierHandle,
  findResizeHandle,
  findTrapezoidHandle,
  getScreenPoint,
  type ResizeHandle,
} from '../interaction/interactionGeometry';
import { isEmptyMixedSource } from '../../math/mixedMath';
import { renderedPlainTextOffset } from '../../math/renderedPlainTextOffset';
import { hitTestRenderedEquation } from '../equation/renderedEquationHitTest';
import {
  applyElementChanges,
  updateBezierHandleInteraction,
  updateDraggingInteraction,
  updateTrapezoidHandleInteraction,
  updateResizingInteraction,
  type BezierHandleInteraction,
  type DraggingInteraction,
  type ResizingInteraction,
  type TrapezoidHandleInteraction,
} from '../interaction/selectionInteraction';
import type { PathToolKind, Tool } from '../interaction/toolModel';
import type { EquationEditStartOptions } from './useEquationEditing';

interface PanningInteraction {
  kind: 'panning';
  pointerId: number;
  startCamera: Camera;
  startScreen: Point;
}

interface BoxSelectionInteraction {
  current: Point;
  kind: 'box-selection';
  pointerId: number;
  start: Point;
}

// Exactly one gesture owns the pointer until completion or cancellation.
type Interaction =
  | BezierHandleInteraction
  | TrapezoidHandleInteraction
  | PanningInteraction
  | DrawingInteraction
  | DraggingInteraction
  | BoxSelectionInteraction
  | ResizingInteraction;

type CanvasHoverTarget = 'draggable' | ResizeHandle | null;

interface EditingEquationPointerState {
  draft?: EquationElement;
  height: number;
  id: string;
  isNew: boolean;
  source: string;
  width: number;
}

/** State owners and semantic commands consumed by the pointer state machine. */
export interface PointerControllerOptions {
  activeTool: Tool;
  activeToolRef: RefObject<Tool>;
  availableActiveTool: Tool;
  bezierFit: BezierFitSettings;
  camera: Camera;
  cornerRadius: number;
  defaultLineSpacing: number;
  defaultTextSize: number;
  dispatchDocument: Dispatch<EditorDocumentAction>;
  editingEquation: EditingEquationPointerState | null;
  elementStyle: ElementStyle;
  elements: BoardElement[];
  elementsForManipulation: BoardElement[];
  interactiveElements: BoardElement[];
  lineArrowheads: LineArrowheads;
  lineSpacing: number;
  pathKind: PathToolKind;
  readOnly: boolean;
  selectedIdSet: ReadonlySet<string>;
  selectedIds: string[];
  shapeFillSpacing: number;
  shapeFillStyle: FillStyle;
  shapeKind: ShapeKind;
  textCursorVerticalOffsetEm: number;
  textSize: number;
  canAddElement(): boolean;
  commitElements(elements: BoardElement[]): boolean;
  onBeginEquationEdit(
    equation: EquationElement,
    options: EquationEditStartOptions,
  ): void;
  onMoveEmptyEquation(point: Point): void;
  setBezierHandlePreviewId: Dispatch<SetStateAction<string | null>>;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  setRecentlyCreatedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  setCamera: Dispatch<SetStateAction<Camera>>;
}

/** Stable canvas event handlers plus the current resize gesture. */
interface PointerController {
  activeResizeHandle: ResizeHandle | null;
  boxSelection: Bounds | null;
  canvasHoverTarget: CanvasHoverTarget;
  isMovingSelection: boolean;
  isPanning: boolean;
  onPointerCancel(event: ReactPointerEvent<HTMLCanvasElement>): void;
  onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void;
  onPointerLeave(): void;
  onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void;
  resetInteractions(): void;
}

/**
 * Converts pointer events into one preview stream followed by one semantic
 * commit. Camera movement, selection, drawing, and editing remain mutually
 * exclusive gesture states.
 */
export function usePointerController({
  activeTool,
  activeToolRef,
  availableActiveTool,
  bezierFit,
  camera,
  canAddElement,
  commitElements,
  cornerRadius,
  defaultLineSpacing,
  defaultTextSize,
  dispatchDocument,
  editingEquation,
  elementStyle,
  elements,
  elementsForManipulation,
  interactiveElements,
  lineArrowheads,
  lineSpacing,
  onBeginEquationEdit,
  onMoveEmptyEquation,
  pathKind,
  readOnly,
  selectedIdSet,
  selectedIds,
  setBezierHandlePreviewId,
  setCamera,
  setMenuOpen,
  setRecentlyCreatedId,
  setSelectedIds,
  shapeFillSpacing,
  shapeFillStyle,
  shapeKind,
  textCursorVerticalOffsetEm,
  textSize,
}: PointerControllerOptions): PointerController {
  const interactionRef = useRef<Interaction | null>(null);
  const [boxSelection, setBoxSelection] = useState<Bounds | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isMovingSelection, setIsMovingSelection] = useState(false);
  const [activeResizeHandle, setActiveResizeHandle] =
    useState<ResizeHandle | null>(null);
  const [canvasHoverTarget, setCanvasHoverTarget] =
    useState<CanvasHoverTarget>(null);
  // Pointer events can outpace paint. One frame publishes the newest preview,
  // box selection, and hover target without dropping the eventual commit.
  const pendingPreviewRef = useRef<BoardElement[] | null>(null);
  const pendingBoxSelectionRef = useRef<{
    bounds: Bounds;
    selectedIds: string[];
  } | null>(null);
  const pendingHoverTargetRef = useRef<{ target: CanvasHoverTarget } | null>(
    null,
  );
  const pointerFrameRef = useRef<number | null>(null);

  const hasScheduledPointerPublication = () =>
    pendingPreviewRef.current !== null ||
    pendingBoxSelectionRef.current !== null ||
    pendingHoverTargetRef.current !== null;
  const cancelPointerFrameIfIdle = () => {
    if (hasScheduledPointerPublication() || pointerFrameRef.current === null) {
      return;
    }
    window.cancelAnimationFrame(pointerFrameRef.current);
    pointerFrameRef.current = null;
  };
  const schedulePointerFrame = () => {
    if (pointerFrameRef.current !== null) return;
    pointerFrameRef.current = window.requestAnimationFrame(() => {
      pointerFrameRef.current = null;
      const preview = pendingPreviewRef.current;
      const selection = pendingBoxSelectionRef.current;
      const hover = pendingHoverTargetRef.current;
      pendingPreviewRef.current = null;
      pendingBoxSelectionRef.current = null;
      pendingHoverTargetRef.current = null;
      if (preview !== null) {
        dispatchDocument({ type: 'preview', elements: preview });
      }
      if (selection !== null) {
        setBoxSelection(selection.bounds);
        setSelectedIds(selection.selectedIds);
      }
      if (hover !== null) setCanvasHoverTarget(hover.target);
    });
  };
  const schedulePreview = (elements: BoardElement[]) => {
    pendingPreviewRef.current = elements;
    schedulePointerFrame();
  };
  const scheduleBoxSelection = (bounds: Bounds, nextSelectedIds: string[]) => {
    pendingBoxSelectionRef.current = {
      bounds,
      selectedIds: nextSelectedIds,
    };
    schedulePointerFrame();
  };
  const scheduleHoverTarget = (target: CanvasHoverTarget) => {
    pendingHoverTargetRef.current = { target };
    schedulePointerFrame();
  };
  const clearScheduledHoverTarget = () => {
    pendingHoverTargetRef.current = null;
    cancelPointerFrameIfIdle();
  };
  const cancelScheduledPreview = () => {
    pendingPreviewRef.current = null;
    cancelPointerFrameIfIdle();
  };
  const commitScheduledBoxSelection = () => {
    const selection = pendingBoxSelectionRef.current;
    pendingBoxSelectionRef.current = null;
    if (selection !== null) setSelectedIds(selection.selectedIds);
    cancelPointerFrameIfIdle();
  };
  const clearScheduledPointerPublications = () => {
    pendingPreviewRef.current = null;
    pendingBoxSelectionRef.current = null;
    pendingHoverTargetRef.current = null;
    if (pointerFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerFrameRef.current);
      pointerFrameRef.current = null;
    }
  };
  useEffect(
    () => () => {
      pendingPreviewRef.current = null;
      pendingBoxSelectionRef.current = null;
      pendingHoverTargetRef.current = null;
      if (pointerFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerFrameRef.current);
      }
    },
    [],
  );

  // Read-only boards admit navigation and selection, never semantic mutation.
  const handleReadOnlyPointerDown = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    setMenuOpen(false);
    clearScheduledHoverTarget();
    if (event.button !== 0) return;
    const screenPoint = getScreenPoint(event);
    const worldPoint = screenToWorld(screenPoint, camera);
    if (availableActiveTool === 'hand') {
      event.currentTarget.setPointerCapture(event.pointerId);
      interactionRef.current = {
        kind: 'panning',
        pointerId: event.pointerId,
        startCamera: camera,
        startScreen: screenPoint,
      };
      setIsPanning(true);
      return;
    }

    const clientPoint = { x: event.clientX, y: event.clientY };
    const hit = [...interactiveElements]
      .reverse()
      .find((element) =>
        isEquationElement(element)
          ? hitTestRenderedEquation(element.id, clientPoint, 7)
          : hitTestElement(element, worldPoint, 7 / camera.zoom),
      );
    if (hit !== undefined) {
      setSelectedIds((current) =>
        event.shiftKey
          ? current.includes(hit.id)
            ? current.filter((id) => id !== hit.id)
            : [...current, hit.id]
          : [hit.id],
      );
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedIds([]);
    interactionRef.current = {
      current: worldPoint,
      kind: 'box-selection',
      pointerId: event.pointerId,
      start: worldPoint,
    };
    setBoxSelection({ x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 });
  };

  // Pointer down chooses one gesture owner and captures its immutable origin.
  const handleEditablePointerDown = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    setMenuOpen(false);
    clearScheduledHoverTarget();
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const currentTool = activeToolRef.current;
    const screenPoint = getScreenPoint(event);
    const worldPoint = screenToWorld(screenPoint, camera);
    const clientPoint = { x: event.clientX, y: event.clientY };

    if (currentTool === 'hand') {
      interactionRef.current = {
        kind: 'panning',
        pointerId: event.pointerId,
        startCamera: camera,
        startScreen: screenPoint,
      };
      setIsPanning(true);
      return;
    }

    if (currentTool === 'equation') {
      setRecentlyCreatedId(null);
      const activeDraft =
        editingEquation?.isNew === true &&
        !isEmptyMixedSource(editingEquation.source) &&
        editingEquation.draft !== undefined
          ? {
              ...editingEquation.draft,
              height: editingEquation.height,
              source: editingEquation.source,
              width: editingEquation.width,
            }
          : null;
      const equation = [
        ...interactiveElements,
        ...(activeDraft === null ? [] : [activeDraft]),
      ]
        .reverse()
        .find((element): element is EquationElement => {
          if (!isEquationElement(element)) return false;
          if (
            hitTestRenderedEquation(element.id, clientPoint, 7, {
              allowMultilineContainerFallback:
                element.id === editingEquation?.id,
            })
          ) {
            return true;
          }
          // Firefox can briefly detach the inactive DOM renderer while an
          // empty draft is being abandoned. Single-line blocks contain no
          // intentional internal whitespace, so their stored bounds are a
          // safe fallback until the renderer reconnects.
          const tolerance = 7 / camera.zoom;
          return (
            (element.id === editingEquation?.id ||
              !element.source.includes('\n')) &&
            worldPoint.x >= element.x - tolerance &&
            worldPoint.x <= element.x + element.width + tolerance &&
            worldPoint.y >= element.y - tolerance &&
            worldPoint.y <= element.y + element.height + tolerance
          );
        });
      if (
        editingEquation?.isNew === true &&
        isEmptyMixedSource(editingEquation.source) &&
        equation === undefined
      ) {
        event.preventDefault();
        onMoveEmptyEquation(worldPoint);
        setSelectedIds([]);
        return;
      }
      event.preventDefault();
      setSelectedIds([]);
      if (equation !== undefined && equation.id === editingEquation?.id) {
        const requestCaret = (remainingAttempts: number) => {
          const field = document.querySelector('math-field');
          if (field !== null) {
            const renderedBase = document.querySelector(
              `[data-mixed-text-id="${CSS.escape(equation.id)}"] .ML__base`,
            );
            const offset =
              renderedBase instanceof HTMLElement
                ? renderedPlainTextOffset(
                    renderedBase,
                    equation.source,
                    clientPoint,
                  )
                : null;
            field.dispatchEvent(
              new CustomEvent('chalkboard-caret-point-request', {
                detail: { offset, point: clientPoint },
              }),
            );
          } else if (remainingAttempts > 0) {
            window.requestAnimationFrame(() =>
              requestCaret(remainingAttempts - 1),
            );
          }
        };
        requestCaret(4);
        return;
      }
      if (equation !== undefined) {
        if (
          editingEquation?.isNew === true &&
          isEmptyMixedSource(editingEquation.source)
        ) {
          document.querySelector<HTMLElement>('math-field')?.blur();
        }
        onBeginEquationEdit(equation, { caretPoint: clientPoint });
        return;
      }
      if (!canAddElement()) {
        event.currentTarget.releasePointerCapture(event.pointerId);
        return;
      }
      const created = createElement(
        'equation',
        {
          x: worldPoint.x,
          y: worldPoint.y - textSize * textCursorVerticalOffsetEm,
        },
        elementStyle,
        { lineSpacing, textSize },
      );
      if (!isEquationElement(created)) return;
      onBeginEquationEdit(
        {
          ...created,
          source: '',
        },
        { caretPoint: clientPoint, isNew: true },
      );
      return;
    }

    const trapezoidHandle = findTrapezoidHandle(
      screenPoint,
      elementsForManipulation,
      camera,
    );
    if (
      trapezoidHandle !== null &&
      (currentTool === 'selection' || currentTool === 'shape')
    ) {
      interactionRef.current = {
        baseElement: trapezoidHandle.shape,
        baseElements: elements,
        changed: false,
        handle: trapezoidHandle.handle,
        kind: 'trapezoid-handle',
        latestElements: [],
        pointerId: event.pointerId,
        start: worldPoint,
      };
      setIsMovingSelection(true);
      return;
    }

    const bezierHandle = findBezierHandle(
      screenPoint,
      elementsForManipulation,
      camera,
    );
    if (
      bezierHandle !== null &&
      (currentTool === 'selection' || currentTool === 'line')
    ) {
      interactionRef.current = {
        baseElement: bezierHandle.line,
        baseElements: elements,
        changed: false,
        handle: bezierHandle.handle,
        kind: 'bezier-handle',
        latestElements: [],
        pointerId: event.pointerId,
        start: worldPoint,
      };
      setIsMovingSelection(true);
      return;
    }

    if (currentTool !== 'selection') {
      setRecentlyCreatedId(null);
      if (!canAddElement()) {
        event.currentTarget.releasePointerCapture(event.pointerId);
        return;
      }
      const drawsFreehand = currentTool === 'line' && pathKind === 'freehand';
      const draft = createElement(
        drawsFreehand ? 'freehand' : currentTool,
        worldPoint,
        elementStyle,
        {
          arrowheads: lineArrowheads,
          cornerRadius,
          fillSpacing: shapeFillSpacing,
          fillStyle: shapeFillStyle,
          lineSpacing: defaultLineSpacing,
          pathKind: pathKind === 'freehand' ? 'straight' : pathKind,
          shapeKind,
          splineContinuity: bezierFit.continuity,
          textSize: defaultTextSize,
        },
      );
      interactionRef.current = {
        baseElements: elements,
        draft,
        kind: 'drawing',
        pointerId: event.pointerId,
        points: [worldPoint],
        start: worldPoint,
      };
      schedulePreview([draft]);
      setSelectedIds([]);
      return;
    }

    const resizeHandle = findResizeHandle(
      screenPoint,
      elementsForManipulation,
      camera,
    );
    const resizeStartBounds = selectionBounds(elementsForManipulation);
    if (resizeHandle !== null && resizeStartBounds !== null) {
      interactionRef.current = {
        baseElements: elements,
        baseSelectedElements: elementsForManipulation,
        changed: false,
        handle: resizeHandle,
        kind: 'resizing',
        latestElements: [],
        pointerId: event.pointerId,
        selectedIds: new Set(selectedIds),
        start: worldPoint,
        startBounds: resizeStartBounds,
      };
      setActiveResizeHandle(resizeHandle);
      return;
    }

    const hit = [...interactiveElements]
      .reverse()
      .find((element) =>
        isEquationElement(element)
          ? hitTestRenderedEquation(element.id, clientPoint, 7)
          : hitTestElement(element, worldPoint, 7 / camera.zoom),
      );
    if (hit !== undefined) {
      setRecentlyCreatedId(null);
      if (event.shiftKey) {
        setSelectedIds((current) =>
          current.includes(hit.id)
            ? current.filter((id) => id !== hit.id)
            : [...current, hit.id],
        );
        return;
      }
      const dragSelection = selectedIdSet.has(hit.id) ? selectedIds : [hit.id];
      setSelectedIds(dragSelection);
      interactionRef.current = {
        baseElements: elements,
        baseSelectedElements: selectedIdSet.has(hit.id)
          ? elementsForManipulation
          : [hit],
        changed: false,
        kind: 'dragging',
        latestElements: [],
        pointerId: event.pointerId,
        start: worldPoint,
      };
      setIsMovingSelection(true);
      return;
    }

    setSelectedIds([]);
    setRecentlyCreatedId(null);
    interactionRef.current = {
      current: worldPoint,
      kind: 'box-selection',
      pointerId: event.pointerId,
      start: worldPoint,
    };
    setBoxSelection({ ...worldPoint, width: 0, height: 0 });
  };

  // Move updates only the active gesture's transient preview.
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const interaction = interactionRef.current;
    const screenPoint = getScreenPoint(event);
    if (interaction === null) {
      if (readOnly) {
        scheduleHoverTarget(null);
        return;
      }
      if (
        (activeTool === 'selection' || activeTool === 'shape') &&
        findTrapezoidHandle(screenPoint, elementsForManipulation, camera) !==
          null
      ) {
        scheduleHoverTarget('east');
        return;
      }
      if (
        (activeTool === 'selection' || activeTool === 'line') &&
        findBezierHandle(screenPoint, elementsForManipulation, camera) !== null
      ) {
        scheduleHoverTarget('draggable');
        return;
      }
      if (activeTool !== 'selection') {
        scheduleHoverTarget(null);
        return;
      }
      const resizeHandle = findResizeHandle(
        screenPoint,
        elementsForManipulation,
        camera,
      );
      if (resizeHandle !== null) {
        scheduleHoverTarget(resizeHandle);
        return;
      }
      const worldPoint = screenToWorld(screenPoint, camera);
      const clientPoint = { x: event.clientX, y: event.clientY };
      const draggable = [...interactiveElements]
        .reverse()
        .some((element) =>
          isEquationElement(element)
            ? hitTestRenderedEquation(element.id, clientPoint, 7)
            : hitTestElement(element, worldPoint, 7 / camera.zoom),
        );
      scheduleHoverTarget(draggable ? 'draggable' : null);
      return;
    }
    if (interaction.pointerId !== event.pointerId) return;

    if (interaction.kind === 'panning') {
      setCamera({
        ...interaction.startCamera,
        x:
          interaction.startCamera.x + screenPoint.x - interaction.startScreen.x,
        y:
          interaction.startCamera.y + screenPoint.y - interaction.startScreen.y,
      });
      return;
    }

    const worldPoint = screenToWorld(screenPoint, camera);
    if (interaction.kind === 'bezier-handle') {
      const nextElements = updateBezierHandleInteraction(
        interaction,
        worldPoint,
        camera.zoom,
      );
      if (nextElements !== null) {
        schedulePreview(nextElements);
      }
      return;
    }
    if (interaction.kind === 'trapezoid-handle') {
      const nextElements = updateTrapezoidHandleInteraction(
        interaction,
        worldPoint,
        camera.zoom,
      );
      if (nextElements !== null) {
        schedulePreview(nextElements);
      }
      return;
    }
    if (interaction.kind === 'drawing') {
      const draft = updateDrawingInteraction(interaction, {
        constrain: event.shiftKey,
        samples: worldPointerSamples(
          event.nativeEvent,
          event.currentTarget.getBoundingClientRect(),
          camera,
          worldPoint,
        ),
        worldPoint,
        zoom: camera.zoom,
      });
      schedulePreview([draft]);
      return;
    }

    if (interaction.kind === 'dragging') {
      const nextElements = updateDraggingInteraction(
        interaction,
        worldPoint,
        camera.zoom,
      );
      if (nextElements !== null) {
        schedulePreview(nextElements);
      }
      return;
    }

    if (interaction.kind === 'resizing') {
      const nextElements = updateResizingInteraction(
        interaction,
        worldPoint,
        camera.zoom,
        { preserveAspectRatio: event.shiftKey },
      );
      if (nextElements !== null) {
        schedulePreview(nextElements);
      }
      return;
    }

    interaction.current = worldPoint;
    const bounds = normalizeBounds({
      x: interaction.start.x,
      y: interaction.start.y,
      width: worldPoint.x - interaction.start.x,
      height: worldPoint.y - interaction.start.y,
    });
    scheduleBoxSelection(
      bounds,
      interactiveElements
        .filter((element) => boundsIntersect(bounds, elementBounds(element)))
        .map(({ id }) => id),
    );
  };

  // Completion and cancellation share cleanup; only completion commits.
  const resetInteractions = () => {
    clearScheduledPointerPublications();
    interactionRef.current = null;
    setBoxSelection(null);
    setCanvasHoverTarget(null);
    setIsPanning(false);
    setIsMovingSelection(false);
    setActiveResizeHandle(null);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const interaction = interactionRef.current;
    if (interaction === null || interaction.pointerId !== event.pointerId) {
      return;
    }
    cancelScheduledPreview();

    if (interaction.kind === 'drawing') {
      const finalized = finalizeDrawingInteraction(interaction, {
        fit: bezierFit,
        point: screenToWorld(getScreenPoint(event), camera),
        zoom: camera.zoom,
      });
      if (finalized === null) {
        dispatchDocument({ type: 'cancel-preview' });
        setSelectedIds([]);
      } else {
        const previewsBezierHandles =
          finalized.type === 'line' &&
          (finalized.pathKind === 'bezier' ||
            finalized.pathKind === 'orthogonal');
        if (commitElements([...interaction.baseElements, finalized])) {
          setRecentlyCreatedId(finalized.id);
          setSelectedIds([]);
          setBezierHandlePreviewId(previewsBezierHandles ? finalized.id : null);
        } else {
          setRecentlyCreatedId(null);
          setSelectedIds([]);
          setBezierHandlePreviewId(null);
        }
      }
    } else if (
      interaction.kind === 'bezier-handle' ||
      interaction.kind === 'trapezoid-handle' ||
      interaction.kind === 'dragging' ||
      interaction.kind === 'resizing'
    ) {
      if (interaction.changed) {
        commitElements(
          applyElementChanges(
            interaction.baseElements,
            interaction.latestElements,
          ),
        );
      } else dispatchDocument({ type: 'cancel-preview' });
    } else if (interaction.kind === 'box-selection') {
      commitScheduledBoxSelection();
      setBoxSelection(null);
    }

    interactionRef.current = null;
    setIsPanning(false);
    setIsMovingSelection(false);
    setActiveResizeHandle(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const interaction = interactionRef.current;
    if (interaction === null || interaction.pointerId !== event.pointerId) {
      return;
    }
    clearScheduledPointerPublications();
    if (
      interaction.kind === 'drawing' ||
      interaction.kind === 'bezier-handle' ||
      interaction.kind === 'trapezoid-handle' ||
      interaction.kind === 'dragging' ||
      interaction.kind === 'resizing'
    ) {
      dispatchDocument({ type: 'cancel-preview' });
    }
    interactionRef.current = null;
    setBoxSelection(null);
    if (interaction.kind === 'drawing') setSelectedIds([]);
    setIsPanning(false);
    setIsMovingSelection(false);
    setActiveResizeHandle(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return {
    activeResizeHandle,
    boxSelection,
    canvasHoverTarget,
    isMovingSelection,
    isPanning,
    onPointerCancel,
    onPointerDown: readOnly
      ? handleReadOnlyPointerDown
      : handleEditablePointerDown,
    onPointerLeave: () => {
      if (interactionRef.current !== null) return;
      clearScheduledHoverTarget();
      setCanvasHoverTarget(null);
    },
    onPointerMove,
    onPointerUp,
    resetInteractions,
  };
}
