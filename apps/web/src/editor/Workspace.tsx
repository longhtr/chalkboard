/**
 * Editor composition root. It joins committed document state, local/cloud
 * durability, camera, input controllers, rendering layers, inspector commands,
 * async import/export, and dialogs; domain algorithms remain in chapter modules.
 */
import { focusDeliberately } from '../math/writerFocus';
import {
  DEFAULT_ELEMENT_STYLE,
  DEFAULT_ELLIPSE_END_ANGLE,
  DEFAULT_ELLIPSE_START_ANGLE,
  normalizedEllipseArc,
  rotatedElementBounds,
  isEquationElement,
  MAX_SHAPE_FILL_SPACING,
  MIN_SHAPE_FILL_SPACING,
  SHAPE_HATCH_SPACING,
  isFreehandElement,
  isImageElement,
  screenToWorld,
  type BoardElement,
  type ElementStyle,
  type FillStyle,
  type EquationElement,
  type ImageElement,
  type LineArrowheads,
  type LineElement,
  type ShapeElement,
  type ShapeKind,
  type SplineContinuity,
} from '@chalkboard/shared';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import { useCloudBoard } from '../collaboration/useCloudBoard';
import { useCloudBoardTitle } from '../collaboration/useCloudBoardTitle';
import {
  BOARD_ELEMENT_LIMIT_MESSAGE,
  DEFAULT_LINE_SPACING,
  DEFAULT_TEXT_SIZE,
  MAX_LINE_SPACING,
  MAX_TEXT_SIZE,
  MIN_LINE_SPACING,
  MIN_TEXT_SIZE,
  boardElementAdditionFits,
  boardElementChangeFits,
} from './model/limits';
import { normalizedBoardTitle } from './model/boardTitle';
import { BoardStructureHistory } from './model/boardStructureHistory';
import { ObjectEditHistory } from './model/objectEditHistory';
import { editableHandleTargets } from './interaction/editableHandleTargets';
import * as equationFonts from './equation/equationFontSize';
import type { EquationEditingView } from './equation/useEquationEditingView';
import {
  hexToHsv,
  hexToRgb,
  hsvToHex,
  normalizeHexColor,
  rgbToHex,
  type HsvColor,
  type RgbColor,
} from './model/colorModel';
import { LEGACY_LOCAL_BOARD_ID } from './local/localBoardCache';
import { requestEquationTypingColor } from './equation/equationTypingColor';
import { localBoardRepository } from './local/localBoardRepository';
import { EquationEditor } from './equation/EquationEditor';
import { StatusNotice } from '../StatusNotice';
import { LatexCheatsheet } from '../math/LatexCheatsheet';
import {
  getWorkspaceFontChoice,
  setWorkspaceFontChoice as applyWorkspaceFontChoice,
} from '../math/mathLiveRuntime';
import type { MixedEditorHistory } from '../math/editorHistory';
import { isEmptyMixedSource } from '../math/mixedMath';
import {
  createEditorDocumentModel,
  editorDocumentModelReducer,
} from './interaction/derivedBoardView';
import {
  moveSelectedElementsTo,
  reorderSelectedElements,
  translateSelectedElements,
  type SelectionOrderCommand,
} from './interaction/selectionInteraction';
import {
  updateBezierContinuity as applyBezierContinuity,
  updateElementStyles,
  updateEllipseArc,
  updateLineArrowheads as applyLineArrowheads,
  updateOrthogonalCornerRadius as applyOrthogonalCornerRadius,
  updateLinePathKind,
  updateShapeProperties,
} from './interaction/styleEdits';
import { useBoardPersistence } from './local/useBoardPersistence';
import { pinchZoomFactor, useCamera } from './workspace/useCamera';
import { useBoardTitle } from './workspace/useBoardTitle';
import { useCanvasRenderer } from './workspace/useCanvasRenderer';
import {
  reconcileActiveEquationWithRemote,
  useEquationLifecycle,
  useEquationState,
} from './workspace/useEquationEditing';
import { groupContentLayers } from './interaction/contentLayers';
import {
  backgroundColorField,
  resolveBackgroundColor,
  resolveStrokeColor,
  strokeColorField,
  type ColorTheme,
} from '@chalkboard/shared';
import { themedElement, themedElements } from './interaction/themedElements';
import { HistoryControls, ZoomControls } from './workspace/ViewportControls';
import { BoardMenu } from './workspace/BoardMenu';
import { CloudControls } from './workspace/CloudControls';
import { ExportDialog } from './workspace/ExportDialog';
import { CollaborationOverlay } from './workspace/CollaborationOverlay';
import { ObjectNavigator } from './workspace/ObjectNavigator';
import { LayeredContent } from './workspace/LayeredContent';
import { ColorPicker } from './workspace/ColorPicker';
import { ColorSwatches } from './workspace/ColorSwatches';
import { PathControls } from './workspace/PathControls';
import { ShapeControls } from './workspace/ShapeControls';
import { ShortcutsDialog } from './workspace/ShortcutsDialog';
import { StrokeControls } from './workspace/StrokeControls';
import { StylePanel } from './workspace/StylePanel';
import { TextControls } from './workspace/TextControls';
import { ToolDock } from './workspace/ToolDock';
import {
  TOOL_DETAILS as toolDetails,
  type PathToolKind,
  type Tool,
} from './interaction/toolModel';
import { useEquationMeasurementQueue } from './workspace/useEquationMeasurementQueue';
import { useImageWorkflow } from './workspace/useImageWorkflow';
import { useInitialBoardCentering } from './workspace/useInitialBoardCentering';
import { useKeyboardCommands } from './workspace/useKeyboardCommands';
import { useObjectClipboard } from './workspace/useObjectClipboard';
import { usePointerController } from './workspace/usePointerController';
import { useWorkspaceSurfaces } from './workspace/useWorkspaceSurfaces';
import {
  hasPendingLocalBoardRecovery,
  hasSharedBoardSnapshot,
  loadInitialElements,
  loadInitialTitle,
  shouldHydrateFromIndexedDb,
  storageFailureMessage,
} from './local/browserState';
import type { WorkspaceProps } from './Workspace.types';
import {
  DEFAULT_MANUAL_BEZIER_MAX_SEGMENTS,
  loadBezierFitSettings,
  loadGridDotSize,
  loadGridLineOpacity,
  loadGridSpacing,
  loadGridStyle,
  loadGridVisibility,
  loadThemePalettes,
  loadLineSpacing,
  loadSourceTextSize,
  loadTextSize,
  LOCAL_CUSTOM_COLORS_KEY,
  LOCAL_CUSTOM_FILL_COLORS_KEY,
  usePreferencePersistence,
} from './workspace/preferences';
import { useTheme, type Theme } from './workspace/theme';
import {
  adjustedLineSpacing,
  adjustedTextSize,
} from './interaction/textAdjustments';
import { loadToolOrder, normalizeToolOrder } from './interaction/toolOrder';
import {
  exportEditableWorkspaceBoard,
  exportWorkspaceImage,
} from './portability/workspaceExport';

// Default palettes per theme. Dark entries are authored, not derived, so the
// starting swatches read correctly against dark paper.
const DEFAULT_STROKE_COLORS_BY_THEME: Record<ColorTheme, readonly string[]> = {
  dark: ['#e6e6ea', '#ff8787', '#74c0fc'],
  light: ['#1f2937', '#e03131', '#1971c2'],
};
const DEFAULT_FILL_COLORS_BY_THEME: Record<ColorTheme, readonly string[]> = {
  dark: ['#3b3a45', '#5c3130', '#1b3a5c'],
  light: ['#e9ecef', '#ffc9c9', '#a5d8ff'],
};
const COLOR_PICKER_FOCUS_HANDOFF_MS = 150;
const TEXT_CURSOR_VERTICAL_OFFSET_EM = 0.68;

interface WorkspaceOperationStatus {
  cancel?: () => void;
  error: boolean;
  kind?: 'storage';
  retry?: () => void;
  text: string;
}

/**
 * Composes the board's durable document, transient interaction state, visual
 * layers, and persistence boundary. Pointer-frequency work stays in refs and
 * dedicated controllers; this component publishes only semantic state changes.
 */

/**
 * Mirrors a gap across the selectable range. A range input must count upward,
 * but a denser fill is a *smaller* gap, so the control stores the mirror and
 * displays the real distance.
 */
function invertedFillSpacing(spacing: number): number {
  return MAX_SHAPE_FILL_SPACING + MIN_SHAPE_FILL_SPACING - spacing;
}

export function Workspace({
  cloudAccessConfirmed = true,
  cloudBoard = null,
  currentUser = null,
  invitationError,
  localBoardId = LEGACY_LOCAL_BOARD_ID,
  onCloudBoardTitleReconciled,
  onDismissInvitationError,
  notices,
  onCloudSessionExpired,
  onCopyLocalBoardToCloud,
  onCreateCloudBoard,
  onCreateLocalBoard,
  onImportLocalBoard,
  onLocalBoardUnavailable,
  onCloudAccessChanged,
  onManageCloudAccess,
  onOpenAccount,
  onOpenBoardInvites,
  onOpenBoards,
}: WorkspaceProps = {}) {
  // The camera is the single coordinate transform shared by every visual and
  // interaction layer. No renderer keeps a second, temporary camera.
  const {
    camera,
    canvasSize,
    centerAtVerticalStart,
    panBy,
    resetCamera,
    setCamera,
    viewportReady,
    viewportRef,
    zoomBy,
    zoomByFactor,
  } = useCamera();
  const historyActorId = currentUser?.id ?? 'local';
  // Refs below bridge asynchronous imports and pointer callbacks to the latest
  // board identity and committed document without scheduling React renders.
  const caretStorageKey =
    cloudBoard === null ? localBoardId : `cloud:${cloudBoard.id}`;
  const pendingLocalBoardId = cloudBoard === null ? localBoardId : null;
  const boardImportInputRef = useRef<HTMLInputElement>(null);
  const boardImportAbortRef = useRef<AbortController | null>(null);
  const [equationHistorySessions] = useState(
    () => new Map<string, MixedEditorHistory>(),
  );
  const [objectEditHistory] = useState(() => new ObjectEditHistory());
  const [boardStructureHistory] = useState(() => new BoardStructureHistory());
  const [cloudPublicationRevision, markCloudPublication] = useReducer(
    (revision: number) => revision + 1,
    0,
  );
  const textSizeGestureRef = useRef<{ committed: boolean } | null>(null);
  const lineSpacingGestureRef = useRef<{ committed: boolean } | null>(null);
  const cornerRadiusGestureRef = useRef<{ committed: boolean } | null>(null);
  const ellipseArcGestureRef = useRef<{ committed: boolean } | null>(null);
  const fillSpacingGestureRef = useRef<{ committed: boolean } | null>(null);
  const strokeDashGapGestureRef = useRef<{ committed: boolean } | null>(null);
  const [forceInitialBoardSave] = useState(
    () =>
      hasSharedBoardSnapshot() || hasPendingLocalBoardRecovery(localBoardId),
  );
  const [hydrateFromIndexedDb] = useState(() =>
    shouldHydrateFromIndexedDb(localBoardId),
  );

  // The reducer owns the committed document and sparse previews. User history
  // is intentionally outside it: mixed blocks, individual objects, and global
  // board-structure changes have separate bounded stores. Persistence and collaboration
  // consume only the committed `present` document.
  const [documentModel, dispatchDocument] = useReducer(
    editorDocumentModelReducer,
    null,
    () =>
      createEditorDocumentModel(
        cloudBoard === null ? loadInitialElements(localBoardId) : [],
      ),
  );
  const measureEquation = useEquationMeasurementQueue(dispatchDocument);
  const { derivedBoardView, document: documentState } = documentModel;
  const presentElementsRef = useRef(documentState.present);
  useLayoutEffect(() => {
    presentElementsRef.current = documentState.present;
  }, [cloudBoard?.id, documentState.present]);
  // Tool state describes the next interaction. Selection and recently-created
  // identity describe the current document focus and are reset at history and
  // board boundaries.
  const [activeTool, setActiveTool] = useState<Tool>('selection');
  const activeToolRef = useRef<Tool>(activeTool);
  const selectionObjectsInitializedRef = useRef(false);
  const selectionObjectsPreferredOpenRef = useRef(false);
  const [objectNavigatorFocusOnOpen, setObjectNavigatorFocusOnOpen] =
    useState(true);
  const [toolOrder, setToolOrder] = useState(loadToolOrder);
  const supportedToolOrder = useMemo(
    () => normalizeToolOrder(toolOrder),
    [toolOrder],
  );
  const [requestedSelectedIds, setSelectedIds] = useState<string[]>([]);
  // Selecting something no longer on the board is meaningless, and it happens
  // for reasons beyond undo: a collaborator can delete what this reader has
  // selected. Derived rather than written back, so no code path has to notice
  // a removal, and undo keeps the selection it did not remove.
  const selectedIds = useMemo(() => {
    if (requestedSelectedIds.length === 0) return requestedSelectedIds;
    const present = new Set(documentState.present.map((element) => element.id));
    const retained = requestedSelectedIds.filter((id) => present.has(id));
    return retained.length === requestedSelectedIds.length
      ? requestedSelectedIds
      : retained;
  }, [documentState.present, requestedSelectedIds]);
  const [recentlyCreatedId, setRecentlyCreatedId] = useState<string | null>(
    null,
  );
  const projectedBoardTitle = useMemo(
    () => cloudBoard?.title ?? loadInitialTitle(localBoardId),
    [cloudBoard?.title, localBoardId],
  );
  const {
    acceptProjection: acceptBoardTitleProjection,
    setTitle: setBoardTitle,
    title: boardTitle,
  } = useBoardTitle(
    cloudBoard === null ? `local:${localBoardId}` : `cloud:${cloudBoard.id}`,
    projectedBoardTitle,
  );
  // Equation editing has its own transaction and caret domains. The workspace
  // retains only the session identity and draft needed to compose board state.
  const {
    changeEquationInputMode,
    changeTextStyle,
    editingEquation,
    editingView,
    equationCaretPoint,
    equationCaretPosition,
    inputMode,
    modeToggleToken,
    readyEquationSession,
    requestTextStyle,
    selectEquationInputMode,
    setEditingEquation,
    setEditingView,
    setEquationCaretPoint,
    setEquationCaretPosition,
    setInputMode,
    setModeToggleToken,
    setReadyEquationSession,
    textStyle,
    toggleTextStyle,
  } = useEquationState();
  const editingEquationRef = useRef(editingEquation);
  useLayoutEffect(() => {
    editingEquationRef.current = editingEquation;
  }, [editingEquation]);
  const [equationHistoryAvailability, setEquationHistoryAvailability] =
    useState<{
      canRedo: boolean;
      canUndo: boolean;
      sessionId: string | null;
    }>({ canRedo: false, canUndo: false, sessionId: null });
  // Modal and panel visibility is centralized so keyboard handling can make a
  // single decision about whether board commands are currently admissible.
  const {
    closeObjectNavigator,
    exportOpen,
    fontSettingsOpen,
    themeSettingsOpen,
    gridSettingsOpen,
    latexCheatsheetOpen,
    menuOpen,
    modalOpen,
    newBoardOptionsOpen,
    objectNavigatorOpen,
    setExportOpen,
    setFontSettingsOpen,
    setThemeSettingsOpen,
    setGridSettingsOpen,
    setLatexCheatsheetOpen,
    setMenuOpen,
    setNewBoardOptionsOpen,
    setObjectNavigatorOpen,
    setShortcutsOpen,
    shortcutsOpen,
    suppressNextBoardMenuFocusRestoration,
  } = useWorkspaceSurfaces();
  const toggleObjectNavigator = useCallback(() => {
    const nextOpen = !objectNavigatorOpen;
    selectionObjectsInitializedRef.current = true;
    selectionObjectsPreferredOpenRef.current = nextOpen;
    if (nextOpen) setObjectNavigatorFocusOnOpen(true);
    setObjectNavigatorOpen(nextOpen);
  }, [objectNavigatorOpen, setObjectNavigatorOpen]);
  const closeSelectionObjectNavigator = useCallback(() => {
    selectionObjectsInitializedRef.current = true;
    selectionObjectsPreferredOpenRef.current = false;
    closeObjectNavigator();
  }, [closeObjectNavigator]);
  // Declared before the canvas renderer so its layout effect publishes
  // `data-theme` before the canvases resolve chrome colors from it.
  const { setTheme, theme } = useTheme();
  // Preferences are local UI policy. Element edits below copy their selected
  // values into semantic board transactions instead of persisting UI state.
  const [fontChoice, setWorkspaceFontChoice] = useState(getWorkspaceFontChoice);
  const [operationStatus, setOperationStatus] =
    useState<WorkspaceOperationStatus | null>(null);
  const [boardLimitStatus, setBoardLimitStatus] = useState<string | null>(null);
  const [operationAnnouncement, setOperationAnnouncement] = useState('');
  const [colorPickerTarget, setColorPickerTarget] = useState<
    'stroke' | 'fill' | null
  >(null);
  const [customColorDraft, setCustomColorDraft] = useState('#f59f00');
  const [customColorHsv, setCustomColorHsv] = useState(() =>
    hexToHsv('#f59f00'),
  );
  const [showGrid, setShowGrid] = useState(() => loadGridVisibility(theme));
  const [gridStyle, setGridStyle] = useState(() => loadGridStyle(theme));
  const [gridSpacing, setGridSpacing] = useState(() =>
    loadGridSpacing(theme, loadGridStyle(theme)),
  );
  const [gridDotSize, setGridDotSize] = useState(() => loadGridDotSize(theme));
  const [gridLineOpacity, setGridLineOpacity] = useState(() =>
    loadGridLineOpacity(theme),
  );
  const selectTheme = useCallback(
    (nextTheme: Theme) => {
      if (nextTheme === theme) return;
      const nextGridStyle = loadGridStyle(nextTheme);
      setShowGrid(loadGridVisibility(nextTheme));
      setGridStyle(nextGridStyle);
      setGridSpacing(loadGridSpacing(nextTheme, nextGridStyle));
      setGridDotSize(loadGridDotSize(nextTheme));
      setGridLineOpacity(loadGridLineOpacity(nextTheme));
      setTheme(nextTheme);
    },
    [setTheme, theme],
  );
  const [elementStyle, setElementStyle] = useState<ElementStyle>(
    DEFAULT_ELEMENT_STYLE,
  );
  const elementStyleRef = useRef(elementStyle);
  useLayoutEffect(() => {
    elementStyleRef.current = elementStyle;
  }, [elementStyle]);
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rectangle');
  const [ellipseStartAngle, setEllipseStartAngle] = useState(
    DEFAULT_ELLIPSE_START_ANGLE,
  );
  const [ellipseEndAngle, setEllipseEndAngle] = useState(
    DEFAULT_ELLIPSE_END_ANGLE,
  );
  const [shapeFillStyle, setShapeFillStyle] = useState<FillStyle>('solid');
  const [shapeFillSpacing, setShapeFillSpacing] = useState(SHAPE_HATCH_SPACING);
  const [pathKind, setPathKind] = useState<PathToolKind>('straight');
  const [lineArrowheads, setLineArrowheads] = useState<LineArrowheads>('none');
  const [bezierHandlePreviewId, setBezierHandlePreviewId] = useState<
    string | null
  >(null);
  const [bezierFit, setBezierFit] = useState(loadBezierFitSettings);
  const [manualBezierMaxSegments, setManualBezierMaxSegments] = useState(
    bezierFit.maxSegments ?? DEFAULT_MANUAL_BEZIER_MAX_SEGMENTS,
  );
  const [cornerRadius, setCornerRadius] = useState(0);
  // Swatches are per theme: a palette mixed for dark paper is wrong on light,
  // so both the defaults and the viewer's custom colors are kept separately.
  const [strokeColorsByTheme, setStrokeColorsByTheme] = useState(() =>
    loadThemePalettes(LOCAL_CUSTOM_COLORS_KEY, DEFAULT_STROKE_COLORS_BY_THEME),
  );
  const [fillColorsByTheme, setFillColorsByTheme] = useState(() =>
    loadThemePalettes(
      LOCAL_CUSTOM_FILL_COLORS_KEY,
      DEFAULT_FILL_COLORS_BY_THEME,
      ['transparent'],
    ),
  );
  const strokeColors = strokeColorsByTheme[theme];
  const fillColors = fillColorsByTheme[theme];
  const defaultStrokeColors = DEFAULT_STROKE_COLORS_BY_THEME[theme];
  const defaultFillColors = DEFAULT_FILL_COLORS_BY_THEME[theme];
  const setStrokeColors = (update: (current: string[]) => string[]): void => {
    setStrokeColorsByTheme((current) => ({
      ...current,
      [theme]: update(current[theme]),
    }));
  };
  const setFillColors = (update: (current: string[]) => string[]): void => {
    setFillColorsByTheme((current) => ({
      ...current,
      [theme]: update(current[theme]),
    }));
  };
  const [textSize, setTextSize] = useState(loadTextSize);
  const [sourceTextSize, setSourceTextSize] = useState(() =>
    loadSourceTextSize(textSize),
  );
  const [textSizeDraft, setTextSizeDraft] = useState(() => ({
    fontSize: textSize,
    value: String(textSize),
  }));
  const [lineSpacing, setLineSpacing] = useState(loadLineSpacing);
  const [lineSpacingDraft, setLineSpacingDraft] = useState(() => ({
    lineSpacing,
    value: String(lineSpacing),
  }));
  const activeEquationElement = useMemo(
    () => derivedBoardView.activeEquation(editingEquation),
    [derivedBoardView, editingEquation],
  );
  // Any board mutation or in-editor keystroke counts as activity, whatever tool
  // or block produced it. Only the identity change matters, never the value.
  const editActivity = useMemo(
    () => ({
      elements: documentState.present,
      source: editingEquation?.source,
    }),
    [documentState.present, editingEquation?.source],
  );
  // A block is only genuinely unsent while it is absent from the board, which
  // now lasts a single keystroke. Comparing sources instead would misfire
  // forever: what the board stores is a normalized form of what the editor
  // holds, so the two strings differ even when the text is fully saved.
  const editorContentPending = useMemo(() => {
    if (editingEquation === null) return false;
    return (
      !documentState.present.some(({ id }) => id === editingEquation.id) &&
      !isEmptyMixedSource(editingEquation.source)
    );
  }, [documentState.present, editingEquation]);
  // Local hydration, cross-tab replacement, and remote Yjs reconciliation all
  // enter through one whole-document replacement boundary.
  const handleExternalBoard = useCallback(
    (record: { elements: BoardElement[]; title: string }) => {
      dispatchDocument({ type: 'replace', elements: record.elements });
      setBoardTitle(record.title);
    },
    [dispatchDocument, setBoardTitle],
  );
  // The socket reconnects with the new authority by itself; this is what makes
  // the surrounding editor stop trusting the role it was told at open time.
  const handleCloudAccessChanged = useCallback(() => {
    onCloudAccessChanged?.();
  }, [onCloudAccessChanged]);

  const handleRemoteCloudBoard = useCallback(
    (elements: BoardElement[], title: string, actorId: string) => {
      const before = presentElementsRef.current;
      const editedIds = objectEditHistory.record(before, elements, actorId);
      if (!boardStructureHistory.record(before, elements, actorId)) {
        boardStructureHistory.recordBarrier(actorId, editedIds);
      }
      const activeEditingEquation = editingEquationRef.current;
      if (
        activeEditingEquation !== null &&
        elements.some(
          (element) =>
            element.id === activeEditingEquation.id &&
            isEquationElement(element) &&
            element.source !== activeEditingEquation.collaborationBaseSource,
        )
      ) {
        document.querySelector('math-field')?.dispatchEvent(
          new CustomEvent('chalkboard-history-external-actor', {
            detail: { actorId },
          }),
        );
      }
      presentElementsRef.current = elements;
      handleExternalBoard({ elements, title });
      setEditingEquation((current) => {
        if (current === null || current.isNew) return current;
        const remote = elements.find(
          (element): element is EquationElement =>
            element.id === current.id && isEquationElement(element),
        );
        if (remote === undefined) return null;
        const reconciled = reconcileActiveEquationWithRemote(current, remote);
        return reconciled.collaborationBaseSource ===
          current.collaborationBaseSource &&
          reconciled.source === current.source &&
          reconciled.width === current.width &&
          reconciled.height === current.height
          ? current
          : reconciled;
      });
    },
    [
      boardStructureHistory,
      handleExternalBoard,
      objectEditHistory,
      setEditingEquation,
    ],
  );
  const handleStorageError = useCallback((error: unknown) => {
    setOperationStatus({
      error: true,
      kind: 'storage',
      text: storageFailureMessage(error),
    });
  }, []);
  const handleStorageRecovered = useCallback(() => {
    setOperationStatus((current) =>
      current?.kind === 'storage' ? null : current,
    );
  }, []);
  // Exactly one durability owner is active: IndexedDB for local boards or the
  // acknowledged Yjs connection for cloud boards.
  const { persistBoard, storageReady } = useBoardPersistence({
    elements: documentState.present,
    enabled: cloudBoard === null,
    forceInitialSave: forceInitialBoardSave,
    hydrateFromIndexedDb,
    localBoardId,
    onExternalBoard: handleExternalBoard,
    onExternalBoardUnavailable: onLocalBoardUnavailable,
    onStorageError: handleStorageError,
    onStorageRecovered: handleStorageRecovered,
    title: boardTitle,
  });
  const cloudTitle =
    cloudBoard === null ? boardTitle : normalizedBoardTitle(boardTitle);
  const handleCloudTitleReconciled = useCallback(
    (reconciledBoardId: string, reconciledTitle: string) => {
      if (reconciledBoardId === cloudBoard?.id) {
        acceptBoardTitleProjection(reconciledTitle);
      }
      onCloudBoardTitleReconciled?.(reconciledBoardId, reconciledTitle);
    },
    [acceptBoardTitleProjection, cloudBoard?.id, onCloudBoardTitleReconciled],
  );
  const handleCloudTitleUnauthorized = useCallback(() => {
    onCloudSessionExpired?.();
  }, [onCloudSessionExpired]);
  const { retry: retryCloudBoardTitle, state: cloudBoardTitleState } =
    useCloudBoardTitle({
      boardId: cloudBoard?.id ?? null,
      canEdit: cloudBoard !== null && cloudBoard.role !== 'viewer',
      currentTitle: cloudBoard?.title ?? cloudTitle,
      desiredTitle: cloudTitle,
      onReconciled: handleCloudTitleReconciled,
      onUnauthorized: handleCloudTitleUnauthorized,
    });
  const {
    collaborators: cloudCollaborators,
    deviceRecoveryState: cloudDeviceRecoveryState,
    hasPendingWork: cloudHasPendingWork,
    retryConnection: retryCloudConnection,
    state: cloudConnectionState,
    updateCursor: updateCloudCursor,
    updateSelection: updateCloudSelection,
  } = useCloudBoard({
    boardId: cloudBoard?.id ?? null,
    canEdit: cloudBoard?.role !== 'viewer',
    elements: documentState.present,
    onAccessChanged: handleCloudAccessChanged,
    onRemoteBoard: handleRemoteCloudBoard,
    publicationRevision: cloudPublicationRevision,
    title: cloudTitle,
    user: currentUser,
  });
  useInitialBoardCentering({
    centerAtVerticalStart,
    contentReady:
      cloudBoard === null
        ? storageReady
        : cloudConnectionState !== 'connecting' &&
          cloudConnectionState !== 'reconnecting',
    elements: documentState.present,
    viewportReady,
  });

  useEffect(() => {
    updateCloudSelection(selectedIds);
    return () => updateCloudSelection([]);
  }, [selectedIds, updateCloudSelection]);

  // Derived display state overlays sparse previews and the active equation on
  // the committed spatial index. It never mutates the document it presents.
  const readOnly =
    cloudBoard?.role === 'viewer' || cloudConnectionState === 'incompatible';
  const availableActiveTool =
    readOnly && activeTool !== 'selection' && activeTool !== 'hand'
      ? 'selection'
      : activeTool;
  const displayReplacements = useMemo(() => {
    const preview = documentState.preview ?? [];
    if (activeEquationElement === undefined) return preview;
    return [
      ...preview.filter(({ id }) => id !== activeEquationElement.id),
      activeEquationElement,
    ];
  }, [activeEquationElement, documentState.preview]);
  const interactiveElements = useMemo(
    () => derivedBoardView.queryViewport(camera, canvasSize, 32),
    [camera, canvasSize, derivedBoardView],
  );
  const isEquationEditorReady =
    editingEquation !== null &&
    readyEquationSession === editingEquation.sessionId;
  const nearbyDisplayElements = useMemo(
    () =>
      derivedBoardView.queryViewport(camera, canvasSize, 200, {
        replacement: activeEquationElement,
        replacements: documentState.preview ?? [],
        retainReplacement: activeEquationElement !== undefined,
      }),
    [
      activeEquationElement,
      camera,
      canvasSize,
      derivedBoardView,
      documentState.preview,
    ],
  );
  // Colors are projected for the active theme once, here, so every renderer
  // downstream keeps reading `strokeColor`/`backgroundColor` unchanged.
  const themedDisplayElements = useMemo(
    () => themedElements(nearbyDisplayElements, theme),
    [nearbyDisplayElements, theme],
  );
  const contentLayers = useMemo(
    () => groupContentLayers(themedDisplayElements),
    [themedDisplayElements],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedElements = useMemo(
    () => derivedBoardView.elementsForIds(selectedIds, displayReplacements),
    [derivedBoardView, displayReplacements, selectedIds],
  );
  const hasStyleableSelection = selectedElements.some(
    (element) => !isImageElement(element),
  );
  const recentlyCreatedElement = derivedBoardView.get(recentlyCreatedId);
  const canDeleteCurrent =
    (activeTool === 'selection' && selectedIds.length > 0) ||
    (activeTool !== 'selection' &&
      activeTool !== 'equation' &&
      recentlyCreatedElement !== undefined &&
      !isEquationElement(recentlyCreatedElement));
  const bezierHandlePreviewCandidate = derivedBoardView.elementForId(
    bezierHandlePreviewId,
    displayReplacements,
  );
  const bezierHandlePreview =
    activeTool === 'line' &&
    selectedIds.length === 0 &&
    bezierHandlePreviewCandidate?.type === 'line' &&
    (bezierHandlePreviewCandidate.pathKind === 'bezier' ||
      bezierHandlePreviewCandidate.pathKind === 'orthogonal' ||
      bezierHandlePreviewCandidate.pathKind === 'straight')
      ? bezierHandlePreviewCandidate
      : undefined;
  const { elementsForManipulation, trapezoidHandlePreview } =
    editableHandleTargets({
      activeTool,
      recentlyCreated: recentlyCreatedElement,
      selectedCount: selectedIds.length,
      selectedElements,
      splinePreview: bezierHandlePreview,
    });
  const historyTargetIds = useMemo(() => {
    if (editingEquation !== null) return [];
    if (selectedIds.length > 0) return selectedIds;
    // A local structural undo or deletion deliberately leaves an invisible
    // requested target. Retain it only while the adjacent structural
    // transaction matches, so remote removal cannot become resurrection.
    if (
      requestedSelectedIds.length > 0 &&
      (boardStructureHistory.canUndoSelection(
        requestedSelectedIds,
        historyActorId,
      ) ||
        boardStructureHistory.canRedoSelection(
          requestedSelectedIds,
          historyActorId,
        ))
    ) {
      return requestedSelectedIds;
    }
    if (activeTool === 'shape' || activeTool === 'line') {
      const recentlyCreatedTarget =
        recentlyCreatedElement?.id ?? recentlyCreatedId;
      if (
        recentlyCreatedTarget !== null &&
        (recentlyCreatedElement !== undefined ||
          boardStructureHistory.canUndoSelection(
            [recentlyCreatedTarget],
            historyActorId,
          ) ||
          boardStructureHistory.canRedoSelection(
            [recentlyCreatedTarget],
            historyActorId,
          ))
      ) {
        return [recentlyCreatedTarget];
      }
    }
    return [];
  }, [
    activeTool,
    boardStructureHistory,
    editingEquation,
    historyActorId,
    recentlyCreatedElement,
    recentlyCreatedId,
    requestedSelectedIds,
    selectedIds,
  ]);
  const historyTargetIsPresent =
    historyTargetIds.length > 0 &&
    historyTargetIds.every((id) => derivedBoardView.get(id) !== undefined);
  const applyBoardStructureHistory = useCallback(
    (direction: 'redo' | 'undo') => {
      const result =
        direction === 'redo'
          ? boardStructureHistory.redo(
              presentElementsRef.current,
              historyActorId,
            )
          : boardStructureHistory.undo(
              presentElementsRef.current,
              historyActorId,
            );
      if (result === null) return false;
      presentElementsRef.current = result.elements;
      markCloudPublication();
      dispatchDocument({ type: 'replace', elements: result.elements });
      setSelectedIds(result.ids);
      return true;
    },
    [boardStructureHistory, dispatchDocument, historyActorId, setSelectedIds],
  );
  const requestWorkspaceHistory = useCallback(
    (direction: 'redo' | 'undo') => {
      if (editingEquation !== null) {
        const field = document.querySelector('math-field');
        if (field !== null) {
          field.dispatchEvent(
            new CustomEvent('chalkboard-history-request', {
              detail: { direction: direction === 'redo' ? 1 : -1 },
            }),
          );
          return;
        }
      }
      const structuralStepMatchesTarget =
        historyTargetIds.length > 0 &&
        (direction === 'redo'
          ? boardStructureHistory.canRedoSelection(
              historyTargetIds,
              historyActorId,
            )
          : boardStructureHistory.canUndoSelection(
              historyTargetIds,
              historyActorId,
            ));
      // A missing target can only be changed by the adjacent structural step;
      // object-local redo must never resurrect a deleted object by itself.
      if (
        structuralStepMatchesTarget &&
        (direction === 'redo' || !historyTargetIsPresent)
      ) {
        applyBoardStructureHistory(direction);
        return;
      }
      if (historyTargetIds.length > 0) {
        if (!historyTargetIsPresent) {
          // Once creation undo has moved this target into redo history, another
          // undo must continue to the preceding structural transaction.
          if (
            direction === 'undo' &&
            boardStructureHistory.canRedoSelection(
              historyTargetIds,
              historyActorId,
            ) &&
            boardStructureHistory.canUndo(historyActorId)
          ) {
            applyBoardStructureHistory(direction);
          }
          return;
        }
        const restored = objectEditHistory.step(
          historyTargetIds,
          direction === 'redo' ? 1 : -1,
          presentElementsRef.current,
          historyActorId,
        );
        if (restored !== null) {
          boardStructureHistory.clearRedo();
          presentElementsRef.current = restored;
          markCloudPublication();
          dispatchDocument({ type: 'replace', elements: restored });
          return;
        }
        if (structuralStepMatchesTarget) {
          applyBoardStructureHistory(direction);
        } else if (
          direction === 'redo' &&
          boardStructureHistory.canUndoSelection(
            historyTargetIds,
            historyActorId,
          ) &&
          boardStructureHistory.canRedo(historyActorId)
        ) {
          // Continue through consecutive structural redos after restoring the
          // previous target instead of trapping history on that object.
          applyBoardStructureHistory(direction);
        }
        return;
      }
      if (activeTool === 'selection') applyBoardStructureHistory(direction);
    },
    [
      activeTool,
      applyBoardStructureHistory,
      boardStructureHistory,
      dispatchDocument,
      editingEquation,
      historyActorId,
      historyTargetIds,
      historyTargetIsPresent,
      objectEditHistory,
    ],
  );
  const selectedShape = selectedElements.find(
    (element): element is ShapeElement => element.type === 'shape',
  );
  const selectedLine = selectedElements.find(
    (element): element is LineElement => element.type === 'line',
  );
  // Freehand strokes take endpoint decoration on the same terms as lines, so
  // the arrowhead control answers to either selection.
  const selectedFreehand = selectedElements.find(isFreehandElement);
  const displayedShapeKind = selectedShape?.shapeKind ?? shapeKind;
  const displayedEllipseArc =
    selectedShape !== undefined &&
    (selectedShape.shapeKind === 'ellipse' ||
      selectedShape.ellipseStartAngle !== undefined ||
      selectedShape.ellipseEndAngle !== undefined)
      ? normalizedEllipseArc(
          selectedShape.ellipseStartAngle,
          selectedShape.ellipseEndAngle,
        )
      : normalizedEllipseArc(ellipseStartAngle, ellipseEndAngle);
  const displayedPathKind = selectedLine?.pathKind ?? pathKind;
  const displayedSplineContinuity =
    selectedLine?.pathKind === 'bezier'
      ? (selectedLine.splineContinuity ?? 'c0')
      : bezierFit.continuity;
  const displayedLineArrowheads =
    selectedLine?.arrowheads ?? selectedFreehand?.arrowheads ?? lineArrowheads;
  const selectedOrthogonalLine =
    selectedLine?.pathKind === 'orthogonal' ? selectedLine : undefined;
  const displayedCornerRadius =
    selectedOrthogonalLine?.cornerRadius ??
    selectedShape?.cornerRadius ??
    cornerRadius;
  const displayedFillStyle = selectedShape?.fillStyle ?? shapeFillStyle;
  const displayedFillSpacing = selectedShape?.fillSpacing ?? shapeFillSpacing;
  const usesTextColor =
    activeTool === 'equation' || selectedElements.some(isEquationElement);
  const renderedEditingView =
    editingEquation === null || editingView === 'rendered';
  // Source view has no math/text mode: the characters typed are the source, so
  // delimiters are written out rather than switched into.
  const showInputModeControls =
    usesTextColor && activeTool === 'equation' && editingView === 'rendered';
  const showTypingControls = showInputModeControls && renderedEditingView;
  const showColorControls =
    !usesTextColor || (activeTool === 'equation' && renderedEditingView);
  const displayedStyle = usesTextColor
    ? elementStyle
    : (selectedElements[0] ?? elementStyle);
  const selectedEquationForStyle = selectedElements.find(isEquationElement);
  const displayedTextSize = Math.round(
    selectedEquationForStyle !== undefined
      ? equationFonts.equationFontSizeForView(
          selectedEquationForStyle,
          editingView,
        )
      : activeEquationElement === undefined
        ? editingView === 'source'
          ? sourceTextSize
          : textSize
        : equationFonts.equationFontSizeForView(
            activeEquationElement,
            editingView,
          ),
  );

  const textSizeInput =
    textSizeDraft.fontSize === displayedTextSize
      ? textSizeDraft.value
      : String(displayedTextSize);
  const displayedLineSpacing =
    selectedElements.find(isEquationElement)?.lineSpacing ??
    activeEquationElement?.lineSpacing ??
    lineSpacing;
  const lineSpacingInput =
    lineSpacingDraft.lineSpacing === displayedLineSpacing
      ? lineSpacingDraft.value
      : String(displayedLineSpacing);

  usePreferencePersistence({
    bezierFit,
    fillColors,
    firstCustomFillColor: defaultFillColors.length + 1,
    firstCustomStrokeColor: defaultStrokeColors.length,
    theme,
    gridDotSize,
    gridLineOpacity,
    gridSpacing,
    gridStyle,
    inputMode,
    lineSpacing,
    showGrid,
    strokeColors,
    sourceTextSize,
    textSize,
    toolOrder: supportedToolOrder,
  });

  // Every semantic writer passes through the same board-cap admission and
  // commit boundary. Rejected operations cancel previews and leave history and
  // durable state untouched.
  const reportOperationLimit = useCallback((message: string) => {
    setBoardLimitStatus(message);
    setOperationAnnouncement(message);
  }, []);

  const rejectBoardElementLimit = useCallback(() => {
    reportOperationLimit(BOARD_ELEMENT_LIMIT_MESSAGE);
  }, [reportOperationLimit]);

  const canAddElement = useCallback(() => {
    if (boardElementAdditionFits(presentElementsRef.current.length, 1)) {
      return true;
    }
    rejectBoardElementLimit();
    return false;
  }, [rejectBoardElementLimit]);

  const commitElements = useCallback(
    (elements: BoardElement[]) => {
      if (
        !boardElementChangeFits(
          presentElementsRef.current.length,
          elements.length,
        )
      ) {
        dispatchDocument({ type: 'cancel-preview' });
        rejectBoardElementLimit();
        return false;
      }
      setBoardLimitStatus(null);
      const before = presentElementsRef.current;
      objectEditHistory.record(before, elements, historyActorId);
      boardStructureHistory.clearRedo();
      boardStructureHistory.record(before, elements, historyActorId);
      presentElementsRef.current = elements;
      markCloudPublication();
      dispatchDocument({ type: 'replace', elements });
      return true;
    },
    [
      boardStructureHistory,
      dispatchDocument,
      historyActorId,
      objectEditHistory,
      rejectBoardElementLimit,
    ],
  );
  const replaceCurrentObjectTransaction = useCallback(
    (elements: BoardElement[]) => {
      objectEditHistory.replaceCurrent(presentElementsRef.current, elements);
      presentElementsRef.current = elements;
      markCloudPublication();
      dispatchDocument({ type: 'replace', elements });
    },
    [dispatchDocument, objectEditHistory],
  );

  const handleImportedImage = useCallback((image: ImageElement) => {
    setSelectedIds([image.id]);
    setRecentlyCreatedId(image.id);
    activeToolRef.current = 'selection';
    setActiveTool('selection');
  }, []);
  const { imageInputRef, importImage } = useImageWorkflow({
    boardId: cloudBoard?.id ?? null,
    camera,
    canvasSize,
    cloudWritable:
      cloudBoard !== null &&
      cloudBoard.role !== 'viewer' &&
      cloudConnectionState !== 'incompatible',
    commitElements,
    createdBy: currentUser?.id ?? 'local',
    elements: documentState.present,
    elementsRef: presentElementsRef,
    onImported: handleImportedImage,
    onLimit: rejectBoardElementLimit,
    onMessage: setOperationAnnouncement,
    onStatus: setOperationStatus,
  });

  // Equation publication translates the editor transaction into one board
  // commit while retaining measurement and crash-recovery ordering.
  const replaceEquationElements = useCallback(
    (elements: BoardElement[]) => {
      markCloudPublication();
      dispatchDocument({ type: 'replace', elements });
    },
    [dispatchDocument],
  );
  const {
    beginEquationEdit,
    caretPositionForEquation,
    changeEquationSource,
    commitEquationEdit,
    focusActiveEquationEditor,
    persistEquationEdit,
    rememberEquationCaret,
  } = useEquationLifecycle({
    caretStorageKey,
    cloud: cloudBoard !== null,
    commitElements,
    editingEquation,
    editingView,
    elements: documentState.present,
    pendingLocalBoardId,
    persistBoard,
    rejectBoardElementLimit,
    replaceElements: replaceEquationElements,
    setEditingEquation,
    setEquationCaretPoint,
    setEquationCaretPosition,
    setReadyEquationSession,
    setRecentlyCreatedId,
    setSelectedIds,
  });

  // Selection commands preserve document order and produce one semantic commit
  // regardless of how many selected elements they affect.
  const deleteSelection = useCallback(() => {
    if (!canDeleteCurrent) return;
    const idsToDelete =
      activeTool === 'selection' && selectedIds.length > 0
        ? selectedIdSet
        : new Set(
            recentlyCreatedElement === undefined
              ? []
              : [recentlyCreatedElement.id],
          );
    if (idsToDelete.size === 0) return;
    commitElements(
      documentState.present.filter(({ id }) => !idsToDelete.has(id)),
    );
    // Keep a deliberate invisible target so undo works immediately even when
    // Delete was invoked while a drawing tool remained active.
    setSelectedIds([...idsToDelete]);
    setRecentlyCreatedId(null);
    setBezierHandlePreviewId(null);
  }, [
    activeTool,
    canDeleteCurrent,
    commitElements,
    documentState.present,
    recentlyCreatedElement,
    selectedIds.length,
    selectedIdSet,
    setBezierHandlePreviewId,
    setRecentlyCreatedId,
    setSelectedIds,
  ]);

  const nudgeSelection = useCallback(
    (
      direction: 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp',
      distance: 1 | 10,
    ) => {
      if (readOnly) return;
      const delta = {
        x:
          direction === 'ArrowLeft'
            ? -distance
            : direction === 'ArrowRight'
              ? distance
              : 0,
        y:
          direction === 'ArrowUp'
            ? -distance
            : direction === 'ArrowDown'
              ? distance
              : 0,
      };
      const translated = translateSelectedElements(
        presentElementsRef.current,
        selectedIdSet,
        delta,
      );
      if (translated !== presentElementsRef.current) commitElements(translated);
    },
    [commitElements, readOnly, selectedIdSet],
  );

  const moveSelectedInOrder = useCallback(
    (command: SelectionOrderCommand) => {
      if (readOnly) return;
      const reordered = reorderSelectedElements(
        documentState.present,
        selectedIdSet,
        command,
      );
      if (reordered !== documentState.present) commitElements(reordered);
    },
    [commitElements, documentState.present, readOnly, selectedIdSet],
  );

  const dropSelectedAtEdge = useCallback(
    (draggedIds: ReadonlySet<string>, edge: 'bottom' | 'top') => {
      if (readOnly) return;
      const reordered = reorderSelectedElements(
        documentState.present,
        draggedIds,
        edge === 'top' ? 'to-front' : 'to-back',
      );
      if (reordered !== documentState.present) commitElements(reordered);
    },
    [commitElements, documentState.present, readOnly],
  );

  const dropSelectedInOrder = useCallback(
    (
      draggedIds: ReadonlySet<string>,
      targetId: string,
      placement: 'after' | 'before',
    ) => {
      if (readOnly) return;
      const reordered = moveSelectedElementsTo(
        documentState.present,
        draggedIds,
        targetId,
        placement,
      );
      if (reordered !== documentState.present) commitElements(reordered);
    },
    [commitElements, documentState.present, readOnly],
  );

  const { copySelectedObjects, pasteCopiedObjects } = useObjectClipboard({
    activeToolRef,
    commitElements,
    elements: documentState.present,
    rejectBoardElementLimit,
    reportOperationLimit,
    selectedIdSet,
    setActiveTool,
    setRecentlyCreatedId,
    setSelectedIds,
  });

  const {
    addStraightPoint,
    activeResizeHandle,
    boxSelection,
    canvasHoverTarget,
    isMovingSelection,
    isPanning,
    onPointerCancel: handlePointerCancel,
    onPointerDown: handlePointerDown,
    onPointerLeave: handlePointerLeave,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    resetInteractions: resetPointerInteractions,
  } = usePointerController({
    activeTool,
    activeToolRef,
    availableActiveTool,
    canAddElement,
    bezierFit,
    camera,
    commitElements,
    cornerRadius,
    defaultLineSpacing: DEFAULT_LINE_SPACING,
    defaultTextSize: DEFAULT_TEXT_SIZE,
    dispatchDocument,
    editingEquation,
    elementStyle,
    ellipseEndAngle,
    ellipseStartAngle,
    elements: documentState.present,
    elementsForManipulation,
    interactiveElements,
    lineArrowheads,
    lineSpacing,
    onBeginEquationEdit: beginEquationEdit,
    onMoveEmptyEquation: (worldPoint) => {
      setEditingEquation((current) =>
        current?.isNew === true && isEmptyMixedSource(current.source)
          ? {
              ...current,
              draft: {
                ...current.draft,
                x: worldPoint.x,
                y:
                  worldPoint.y -
                  current.draft.fontSize * TEXT_CURSOR_VERTICAL_OFFSET_EM,
              },
            }
          : current,
      );
    },
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
    sourceTextSize,
    textCursorVerticalOffsetEm: TEXT_CURSOR_VERTICAL_OFFSET_EM,
    textSize,
  });

  const { gridCanvasRef, overlayCanvasRef } = useCanvasRenderer({
    bezierHandlePreview,
    boxSelection,
    camera,
    canvasSize,
    gridDotSize,
    gridLineOpacity,
    gridSpacing,
    gridStyle,
    selectedElements,
    showGrid,
    theme,
    trapezoidHandlePreview,
  });

  // Tool changes finish or abandon the active equation before exposing the next
  // interaction mode; otherwise two editors could own the same keyboard event.
  const selectTool = useCallback(
    (tool: Tool) => {
      const newMixedTextId =
        editingEquation?.isNew === true &&
        !isEmptyMixedSource(editingEquation.source)
          ? editingEquation.id
          : undefined;
      if (editingEquation !== null && tool !== 'equation') {
        document.querySelector<HTMLElement>('math-field')?.blur();
        commitEquationEdit(
          editingEquation.sessionId,
          editingEquation.source,
          editingEquation.width,
          editingEquation.height,
        );
      }
      resetPointerInteractions();
      dispatchDocument({ type: 'cancel-preview' });
      if (tool === 'selection') {
        const idToSelect = newMixedTextId ?? recentlyCreatedElement?.id;
        if (idToSelect !== undefined) setSelectedIds([idToSelect]);
        const enteringSelection = activeToolRef.current !== 'selection';
        if (!selectionObjectsInitializedRef.current) {
          selectionObjectsInitializedRef.current = true;
          const autoOpenObjects =
            !window.matchMedia('(max-width: 600px)').matches;
          selectionObjectsPreferredOpenRef.current = autoOpenObjects;
          if (autoOpenObjects) {
            // Automatic disclosure must not steal keyboard ownership from the
            // canvas, toolbar, or file chooser that selected this tool.
            setObjectNavigatorFocusOnOpen(false);
            suppressNextBoardMenuFocusRestoration();
            setObjectNavigatorOpen(true);
          }
        } else if (
          enteringSelection &&
          selectionObjectsPreferredOpenRef.current
        ) {
          setObjectNavigatorFocusOnOpen(false);
          suppressNextBoardMenuFocusRestoration();
          setObjectNavigatorOpen(true);
        }
      } else {
        setSelectedIds([]);
        setObjectNavigatorOpen(false);
      }
      if (tool === 'equation') setRecentlyCreatedId(null);
      if (tool !== 'line') setBezierHandlePreviewId(null);
      activeToolRef.current = tool;
      setActiveTool(tool);
    },
    [
      commitEquationEdit,
      dispatchDocument,
      editingEquation,
      recentlyCreatedElement,
      resetPointerInteractions,
      setActiveTool,
      setBezierHandlePreviewId,
      setObjectNavigatorOpen,
      setRecentlyCreatedId,
      setSelectedIds,
      suppressNextBoardMenuFocusRestoration,
    ],
  );

  const moveToEquationInDirection = useCallback(
    (code: 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp') => {
      if (editingEquation === null) return false;
      const equations = derivedBoardView
        .overlayPreview(
          derivedBoardView.equationElements(),
          displayReplacements,
        )
        .filter(isEquationElement);
      const current = equations.find(
        (element) => element.id === editingEquation.id,
      );
      if (current === undefined) return false;
      const horizontal = code === 'ArrowLeft' || code === 'ArrowRight';
      const ordered = [...equations].sort((first, second) => {
        const firstCenter = {
          x: first.x + first.width / 2,
          y: first.y + first.height / 2,
        };
        const secondCenter = {
          x: second.x + second.width / 2,
          y: second.y + second.height / 2,
        };
        const primaryDifference = horizontal
          ? firstCenter.x - secondCenter.x
          : firstCenter.y - secondCenter.y;
        const crossDifference = horizontal
          ? firstCenter.y - secondCenter.y
          : firstCenter.x - secondCenter.x;
        return (
          primaryDifference ||
          crossDifference ||
          first.id.localeCompare(second.id)
        );
      });
      const currentIndex = ordered.findIndex(
        (element) => element.id === current.id,
      );
      const step = code === 'ArrowRight' || code === 'ArrowDown' ? 1 : -1;
      const target = ordered[currentIndex + step];
      if (target === undefined) return false;

      document.querySelector<HTMLElement>('math-field')?.blur();
      commitEquationEdit(
        editingEquation.sessionId,
        editingEquation.source,
        editingEquation.width,
        editingEquation.height,
      );
      beginEquationEdit(target, {
        caretPosition: caretPositionForEquation(target.id),
      });
      return true;
    },
    [
      beginEquationEdit,
      caretPositionForEquation,
      commitEquationEdit,
      derivedBoardView,
      displayReplacements,
      editingEquation,
    ],
  );

  // The keyboard controller receives semantic commands rather than setters so
  // listener lifetime remains stable while behavior tracks current state.
  useKeyboardCommands({
    activeTool,
    bezierHandlePreview: bezierHandlePreviewId !== null,
    canDelete: canDeleteCurrent,
    canNudgeSelection:
      activeTool === 'selection' && selectedElements.length > 0,
    currentStrokeColor: resolveStrokeColor(elementStyle, theme),
    editingEquation: editingEquation !== null,
    modalOpen,
    readOnly,
    strokeColors,
    toolOrder: supportedToolOrder,
    addStraightPoint,
    adjustLineSpacing: (direction) => {
      updateLineSpacing(adjustedLineSpacing(displayedLineSpacing, direction));
    },
    adjustTextSize: (direction) => {
      updateTextSize(adjustedTextSize(displayedTextSize, direction));
    },
    cancelBezierPreview: () => {
      setBezierHandlePreviewId(null);
      setSelectedIds([]);
    },
    copySelectedObjects: () => {
      void copySelectedObjects();
    },
    deleteSelection,
    moveToEquation: moveToEquationInDirection,
    nudgeSelection,
    pasteCopiedObjects: () => {
      void pasteCopiedObjects();
    },
    requestHistory: requestWorkspaceHistory,
    selectTool,
    setTypingColor: (strokeColor) => {
      const next = {
        ...elementStyle,
        [strokeColorField(theme)]: strokeColor,
      };
      elementStyleRef.current = next;
      setElementStyle(next);
      document.querySelector('math-field')?.dispatchEvent(
        new CustomEvent('chalkboard-typing-color-request', {
          detail: { color: strokeColor },
        }),
      );
    },
    toggleEquationEditingView: () => {
      changeEditingView(editingView === 'source' ? 'rendered' : 'source');
    },
    toggleEquationInputMode: () => {
      if (editingEquation === null) {
        setInputMode((current) => (current === 'math' ? 'text' : 'math'));
      } else {
        setModeToggleToken((current) => current + 1);
      }
    },
    toggleSelectionObjects: toggleObjectNavigator,
  });

  const mobileKeyboardEditingSessionId = editingEquation?.sessionId ?? null;

  // Keep the active writing above MathLive's overlay keyboard. The keyboard can
  // grow when its tab changes, so visibility is checked on every geometry
  // update rather than only when the field first opens.
  useEffect(() => {
    if (
      mobileKeyboardEditingSessionId === null ||
      !window.matchMedia('(max-width: 600px), (pointer: coarse)').matches
    ) {
      return;
    }
    const keyboard = window.mathVirtualKeyboard;
    let revealAttempts = 0;
    let revealFrame: number | null = null;
    const checkEditorVisibility = () => {
      revealFrame = null;
      const field = document.querySelector('math-field');
      if (!keyboard.visible || !(field instanceof HTMLElement)) {
        revealAttempts -= 1;
        if (revealAttempts > 0) {
          revealFrame = window.requestAnimationFrame(checkEditorVisibility);
        }
        return;
      }
      const keyboardBounds = keyboard.boundingRect;
      if (keyboardBounds.bottom > window.innerHeight + 2) {
        revealAttempts -= 1;
        if (revealAttempts > 0) {
          revealFrame = window.requestAnimationFrame(checkEditorVisibility);
        }
        return;
      }
      const fieldBounds = field.getBoundingClientRect();
      const overlap = fieldBounds.bottom + 16 - keyboardBounds.top;
      if (overlap <= 0) return;
      setCamera((current) => ({ ...current, y: current.y - overlap }));
    };
    const revealEditor = () => {
      // Font loading and MathLive initialization can delay the first keyboard
      // geometry event well past the field mount on a phone.
      revealAttempts = 180;
      if (revealFrame !== null) window.cancelAnimationFrame(revealFrame);
      revealFrame = window.requestAnimationFrame(checkEditorVisibility);
    };
    keyboard.addEventListener('geometrychange', revealEditor);
    keyboard.addEventListener('virtual-keyboard-toggle', revealEditor);
    revealEditor();
    return () => {
      keyboard.removeEventListener('geometrychange', revealEditor);
      keyboard.removeEventListener('virtual-keyboard-toggle', revealEditor);
      if (revealFrame !== null) window.cancelAnimationFrame(revealFrame);
    };
  }, [mobileKeyboardEditingSessionId, setCamera]);

  // Bound to the viewport rather than the drawing surface: while a mixed text
  // block is being edited its field covers the canvas, and a wheel over it
  // would otherwise reach nothing and leave the board stuck.
  useEffect(() => {
    const viewport = viewportRef.current;
    const canvas = overlayCanvasRef.current;
    if (viewport === null || canvas === null) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey) {
        const bounds = canvas.getBoundingClientRect();
        zoomByFactor(pinchZoomFactor(event.deltaY, event.deltaMode), {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        });
        return;
      }
      panBy(event.deltaX, event.deltaY);
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [overlayCanvasRef, panBy, viewportRef, zoomByFactor]);

  // Inspector controls update selected elements when possible and otherwise
  // update the style template used by the next created element.
  const updateSelectedStyle = (change: Partial<ElementStyle>) => {
    setElementStyle((current) => ({ ...current, ...change }));
    const typingColor = change[strokeColorField(theme)];
    if (usesTextColor && typingColor !== undefined) {
      if (editingEquation !== null) {
        requestEquationTypingColor(typingColor);
      }
      return;
    }
    if (editingEquation?.isNew) {
      setEditingEquation((current) =>
        current?.isNew
          ? { ...current, draft: { ...current.draft, ...change } }
          : current,
      );
    }
    const editsExistingEquationId =
      editingEquation !== null && !editingEquation.isNew
        ? editingEquation.id
        : null;
    if (selectedIds.length === 0 && editsExistingEquationId === null) return;
    const targetIds =
      editsExistingEquationId === null
        ? selectedIdSet
        : new Set([...selectedIdSet, editsExistingEquationId]);
    const elements = updateElementStyles(
      documentState.present,
      targetIds,
      change,
    );
    if (elements !== null) commitElements(elements);
  };

  const updateSelectedStrokeDashGap = (strokeDashGap: number) => {
    setElementStyle((current) => ({ ...current, strokeDashGap }));
    if (selectedIds.length === 0) return;
    const elements = updateElementStyles(documentState.present, selectedIdSet, {
      strokeDashGap,
    });
    if (elements === null) return;
    const gesture = strokeDashGapGestureRef.current;
    if (gesture?.committed) {
      replaceCurrentObjectTransaction(elements);
      return;
    }
    commitElements(elements);
    if (gesture !== null) gesture.committed = true;
  };

  const updateSelectedShape = (
    change: Partial<
      Pick<
        ShapeElement,
        'cornerRadius' | 'ellipseEndAngle' | 'ellipseStartAngle' | 'shapeKind'
      >
    >,
  ) => {
    if (change.shapeKind !== undefined) setShapeKind(change.shapeKind);
    if (change.cornerRadius !== undefined) setCornerRadius(change.cornerRadius);
    if (change.ellipseStartAngle !== undefined) {
      setEllipseStartAngle(change.ellipseStartAngle);
    }
    if (change.ellipseEndAngle !== undefined) {
      setEllipseEndAngle(change.ellipseEndAngle);
    }
    if (selectedIds.length === 0) return;
    const elements = updateShapeProperties(
      documentState.present,
      selectedIdSet,
      change,
    );
    if (elements === null) return;
    const gesture = cornerRadiusGestureRef.current;
    if (change.cornerRadius !== undefined && gesture?.committed) {
      replaceCurrentObjectTransaction(elements);
    } else {
      commitElements(elements);
      if (change.cornerRadius !== undefined && gesture !== null) {
        gesture.committed = true;
      }
    }
  };

  const updateSelectedLine = (nextPathKind: PathToolKind) => {
    setPathKind(nextPathKind);
    if (nextPathKind === 'freehand' || selectedIds.length === 0) return;
    const elements = updateLinePathKind(
      documentState.present,
      selectedIdSet,
      nextPathKind,
      bezierFit.continuity,
    );
    if (elements !== null) commitElements(elements);
  };

  const updateSelectedSplineContinuity = (continuity: SplineContinuity) => {
    setBezierFit((current) => ({ ...current, continuity }));
    if (selectedIds.length === 0) return;
    const elements = applyBezierContinuity(
      documentState.present,
      selectedIdSet,
      continuity,
    );
    if (elements !== null) commitElements(elements);
  };

  const updateSelectedCornerRadius = (cornerRadius: number) => {
    setCornerRadius(cornerRadius);
    if (selectedIds.length === 0) return;
    // A mixed selection can hold both kinds, so each edit runs and the second
    // builds on whatever the first produced.
    const shaped = updateShapeProperties(documentState.present, selectedIdSet, {
      cornerRadius,
    });
    const lined = applyOrthogonalCornerRadius(
      shaped ?? documentState.present,
      selectedIdSet,
      cornerRadius,
    );
    const elements = lined ?? shaped;
    if (elements === null) return;
    const gesture = cornerRadiusGestureRef.current;
    if (gesture?.committed) {
      replaceCurrentObjectTransaction(elements);
      return;
    }
    commitElements(elements);
    if (gesture !== null) gesture.committed = true;
  };

  const updateSelectedEllipseArc = (change: {
    endAngle?: number;
    startAngle?: number;
  }) => {
    const next = normalizedEllipseArc(
      change.startAngle ?? displayedEllipseArc.startAngle,
      change.endAngle ?? displayedEllipseArc.endAngle,
    );
    setEllipseStartAngle(next.startAngle);
    setEllipseEndAngle(next.endAngle);
    if (selectedIds.length === 0) return;
    const elements = updateEllipseArc(documentState.present, selectedIdSet, {
      ellipseEndAngle: next.endAngle,
      ellipseStartAngle: next.startAngle,
    });
    if (elements === null) return;
    const gesture = ellipseArcGestureRef.current;
    if (gesture?.committed) {
      replaceCurrentObjectTransaction(elements);
      return;
    }
    commitElements(elements);
    if (gesture !== null) gesture.committed = true;
  };

  const updateSelectedLineArrowheads = (arrowheads: LineArrowheads) => {
    setLineArrowheads(arrowheads);
    if (selectedIds.length === 0) return;
    const elements = applyLineArrowheads(
      documentState.present,
      selectedIdSet,
      arrowheads,
    );
    if (elements !== null) commitElements(elements);
  };

  const updateSelectedFillStyle = (fillStyle: FillStyle) => {
    setShapeFillStyle(fillStyle);
    if (selectedIds.length === 0) return;
    const elements = updateShapeProperties(
      documentState.present,
      selectedIdSet,
      { fillStyle },
    );
    if (elements !== null) commitElements(elements);
  };

  const updateSelectedFillSpacing = (fillSpacing: number) => {
    setShapeFillSpacing(fillSpacing);
    if (selectedIds.length === 0) return;
    const elements = updateShapeProperties(
      documentState.present,
      selectedIdSet,
      { fillSpacing },
    );
    if (elements === null) return;
    // One drag is one undo entry: the first change pushes history and the rest
    // replace it, matching how the corner-radius slider behaves.
    const gesture = fillSpacingGestureRef.current;
    if (gesture?.committed) {
      replaceCurrentObjectTransaction(elements);
      return;
    }
    commitElements(elements);
    if (gesture !== null) gesture.committed = true;
  };

  const addCustomColor = (value: string, target: 'stroke' | 'fill') => {
    const color = normalizeHexColor(value);
    if (color === null) return;
    if (target === 'fill') {
      setFillColors((current) =>
        current.includes(color) ? current : [...current, color],
      );
      updateSelectedStyle({ [backgroundColorField(theme)]: color });
    } else {
      setStrokeColors((current) =>
        current.includes(color) ? current : [...current, color],
      );
      updateSelectedStyle({ [strokeColorField(theme)]: color });
    }
  };

  const closeColorPicker = () => {
    setColorPickerTarget(null);
    focusActiveEquationEditor();
  };

  const updateCustomColorHsv = (change: Partial<HsvColor>) => {
    const next = { ...customColorHsv, ...change };
    setCustomColorHsv(next);
    setCustomColorDraft(hsvToHex(next));
  };

  const updateCustomColorHex = (value: string) => {
    setCustomColorDraft(value);
    const color = normalizeHexColor(value);
    if (color !== null) setCustomColorHsv(hexToHsv(color));
  };

  const updateCustomColorRgb = (change: Partial<RgbColor>) => {
    const color = rgbToHex({
      ...hexToRgb(hsvToHex(customColorHsv)),
      ...change,
    });
    setCustomColorDraft(color);
    setCustomColorHsv(hexToHsv(color));
  };

  const submitCustomColor = () => {
    const color = normalizeHexColor(customColorDraft);
    const target = colorPickerTarget;
    if (color === null || target === null) return;
    setCustomColorDraft(color);
    setCustomColorHsv(hexToHsv(color));
    addCustomColor(color, target);
    window.requestAnimationFrame(() => {
      const activeField = document.querySelector<HTMLElement>('math-field');
      // Deliberate: the picker is closing and focus belongs back on the block.
      if (activeField !== null) {
        focusDeliberately(activeField, { preventScroll: true });
      }
      window.setTimeout(() => {
        setColorPickerTarget(null);
        focusActiveEquationEditor();
      }, COLOR_PICKER_FOCUS_HANDOFF_MS);
    });
  };

  const removeCustomColor = (color: string) => {
    if (defaultStrokeColors.includes(color)) return;
    setStrokeColors((current) => current.filter((value) => value !== color));
    if (resolveStrokeColor(elementStyle, theme) === color) {
      updateSelectedStyle({
        [strokeColorField(theme)]: defaultStrokeColors[0] ?? '#1f2937',
      });
    }
  };

  const removeCustomFillColor = (color: string) => {
    if (defaultFillColors.includes(color)) return;
    setFillColors((current) => current.filter((value) => value !== color));
    if (resolveBackgroundColor(elementStyle, theme) === color) {
      updateSelectedStyle({ [backgroundColorField(theme)]: 'transparent' });
    }
  };

  function updateTextSize(fontSize: number) {
    if (editingView === 'source') setSourceTextSize(fontSize);
    else setTextSize(fontSize);
    setTextSizeDraft({ fontSize, value: String(fontSize) });
    if (editingEquation?.isNew) {
      setEditingEquation((current) =>
        current?.isNew
          ? {
              ...current,
              draft: equationFonts.updateEquationFontSize(
                current.draft,
                editingView,
                fontSize,
              ),
            }
          : current,
      );
    }
    const editingId =
      editingEquation !== null && !editingEquation.isNew
        ? editingEquation.id
        : null;
    const elements = equationFonts.updateEquationFontSizes(
      documentState.present,
      {
        editingId,
        editingView,
        fontSize,
        selectedIds: selectedIdSet,
      },
    );
    if (elements !== documentState.present) {
      const gesture = textSizeGestureRef.current;
      if (gesture?.committed) {
        replaceCurrentObjectTransaction(elements);
      } else {
        commitElements(elements);
        if (gesture !== null) gesture.committed = true;
      }
    }
  }

  /**
   * Switches the editing view, fixing the source size onto the block first.
   *
   * A block that has never been shown in both views only derives its source
   * size from its rendered one, so the two moved together. Writing the derived
   * value down at the moment the block first changes view separates them.
   */
  function changeEditingView(view: EquationEditingView) {
    if (view !== editingView) {
      if (view === 'source') {
        document
          .querySelector('math-field')
          ?.dispatchEvent(new CustomEvent('chalkboard-prepare-source-view'));
      }
      if (editingEquation?.isNew === true) {
        setEditingEquation((current) =>
          current?.isNew
            ? {
                ...current,
                draft: equationFonts.materializeSourceFontSize(current.draft),
              }
            : current,
        );
      } else if (editingEquation !== null) {
        const elements = equationFonts.materializeSourceFontSizes(
          documentState.present,
          editingEquation.id,
        );
        // Replaced rather than committed: writing the size down is bookkeeping
        // for a view change, not an edit, and an undo entry here would put the
        // writer's own last edit one press further away.
        if (elements !== documentState.present) {
          replaceCurrentObjectTransaction(elements);
        }
      }
    }
    setEditingView(view);
  }

  const commitTextSizeInput = () => {
    const parsed = Number(textSizeInput);
    const fontSize =
      textSizeInput.trim() !== '' && Number.isFinite(parsed)
        ? Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, Math.round(parsed)))
        : displayedTextSize;
    setTextSizeDraft({ fontSize, value: String(fontSize) });
    if (fontSize !== displayedTextSize) updateTextSize(fontSize);
  };

  function updateLineSpacing(value: number) {
    const nextLineSpacing = Math.round(value * 10) / 10;
    setLineSpacing(nextLineSpacing);
    setLineSpacingDraft({
      lineSpacing: nextLineSpacing,
      value: String(nextLineSpacing),
    });
    if (editingEquation?.isNew) {
      setEditingEquation((current) =>
        current?.isNew
          ? {
              ...current,
              draft: { ...current.draft, lineSpacing: nextLineSpacing },
            }
          : current,
      );
    }
    const editingId =
      editingEquation !== null && !editingEquation.isNew
        ? editingEquation.id
        : null;
    let changed = false;
    const elements = documentState.present.map((element) => {
      if (
        !isEquationElement(element) ||
        (!selectedIdSet.has(element.id) && element.id !== editingId) ||
        element.lineSpacing === nextLineSpacing
      ) {
        return element;
      }
      changed = true;
      return { ...element, lineSpacing: nextLineSpacing };
    });
    if (changed) {
      const gesture = lineSpacingGestureRef.current;
      if (gesture?.committed) {
        replaceCurrentObjectTransaction(elements);
      } else {
        commitElements(elements);
        if (gesture !== null) gesture.committed = true;
      }
    }
  }

  const commitLineSpacingInput = () => {
    const parsed = Number(lineSpacingInput);
    const nextLineSpacing =
      lineSpacingInput.trim() !== '' && Number.isFinite(parsed)
        ? Math.min(
            MAX_LINE_SPACING,
            Math.max(MIN_LINE_SPACING, Math.round(parsed * 10) / 10),
          )
        : displayedLineSpacing;
    setLineSpacingDraft({
      lineSpacing: nextLineSpacing,
      value: String(nextLineSpacing),
    });
    if (nextLineSpacing !== displayedLineSpacing) {
      updateLineSpacing(nextLineSpacing);
    }
  };

  const equationElements = nearbyDisplayElements.filter(
    (element): element is EquationElement => isEquationElement(element),
  );
  const editedElement =
    editingEquation === null
      ? undefined
      : equationElements.find(({ id }) => id === editingEquation.id);
  // MathLive must receive the active theme's base stroke. Otherwise ordinary
  // dark text is mistaken for a per-run override against the stored light base
  // and is serialized with an unnecessary explicit color.
  const editorElement =
    editingEquation === null || editedElement === undefined
      ? undefined
      : themedElement(
          { ...editedElement, source: editingEquation.source },
          theme,
        );
  const equationHistoryKey =
    editingEquation === null
      ? null
      : `${cloudBoard === null ? `local:${localBoardId}` : `cloud:${cloudBoard.id}`}:${editingEquation.id}`;
  const retainedEquationHistory =
    equationHistoryKey === null
      ? undefined
      : equationHistorySessions.get(equationHistoryKey);
  const cursorClass =
    activeResizeHandle !== null
      ? `is-resizing-${activeResizeHandle}`
      : isPanning || isMovingSelection
        ? 'is-grabbing'
        : canvasHoverTarget === 'rotate'
          ? 'is-rotating'
          : canvasHoverTarget !== null && canvasHoverTarget !== 'draggable'
            ? `is-resizing-${canvasHoverTarget}`
            : canvasHoverTarget === 'draggable'
              ? 'is-move'
              : availableActiveTool === 'selection'
                ? 'is-selecting'
                : availableActiveTool === 'hand'
                  ? 'is-grab'
                  : availableActiveTool === 'equation'
                    ? 'is-text'
                    : 'is-crosshair';

  const copyLocalBoardToCloud = async () => {
    setMenuOpen(false);
    setOperationStatus({ error: false, text: 'Copying board to cloud…' });
    try {
      if (onCopyLocalBoardToCloud === undefined) {
        throw new Error('Cloud copy is unavailable.');
      }
      await onCopyLocalBoardToCloud();
      setOperationStatus(null);
      setOperationAnnouncement('Board copied to cloud.');
    } catch (error) {
      setOperationStatus({
        error: true,
        retry: () => void copyLocalBoardToCloud(),
        text:
          error instanceof Error ? error.message : 'Cloud board copy failed.',
      });
    }
  };

  const createCloudBoard = async () => {
    setMenuOpen(false);
    setNewBoardOptionsOpen(false);
    setOperationStatus({ error: false, text: 'Creating cloud board…' });
    try {
      if (onCreateCloudBoard === undefined) {
        throw new Error('Cloud board creation is unavailable.');
      }
      await onCreateCloudBoard();
      setOperationStatus(null);
      setOperationAnnouncement('Cloud board created.');
    } catch (error) {
      setOperationStatus({
        error: true,
        retry: () => void createCloudBoard(),
        text:
          error instanceof Error
            ? error.message
            : 'Cloud board creation failed.',
      });
    }
  };

  const importEditableBoard = async (file: File) => {
    setMenuOpen(false);
    boardImportAbortRef.current?.abort();
    const controller = new AbortController();
    boardImportAbortRef.current = controller;
    setOperationStatus({
      cancel: () => controller.abort(),
      error: false,
      text: 'Validating editable board…',
    });
    try {
      if (onImportLocalBoard === undefined) {
        throw new Error('Editable board import is unavailable.');
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      await onImportLocalBoard(bytes, controller.signal);
      setOperationStatus(null);
      setOperationAnnouncement('Board imported.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setOperationStatus(null);
        setOperationAnnouncement('Board import cancelled.');
      } else {
        setOperationStatus({
          error: true,
          text:
            error instanceof Error
              ? error.message
              : 'Editable board import failed.',
        });
      }
    } finally {
      if (boardImportAbortRef.current === controller) {
        boardImportAbortRef.current = null;
      }
      if (boardImportInputRef.current !== null) {
        boardImportInputRef.current.value = '';
      }
    }
  };

  const exportEditableBoard = async () => {
    setMenuOpen(false);
    setOperationStatus({ error: false, text: 'Preparing editable board…' });
    try {
      const filename = await exportEditableWorkspaceBoard({
        boardTitle,
        cloud: cloudBoard !== null,
        cloudConnectionState,
        cloudElements: documentState.present,
        fontChoice,
        hasPendingWork: cloudHasPendingWork,
        localBoardId,
        readLocalBoard: (id) => localBoardRepository.read(id),
      });
      setOperationStatus(null);
      setOperationAnnouncement(`Exported ${filename}`);
    } catch (error) {
      setOperationStatus({
        error: true,
        text:
          error instanceof Error
            ? error.message
            : 'Editable board export failed.',
      });
    }
  };

  // Rendering order mirrors board order: persistent content first, then active
  // editors, interaction overlays, controls, and modal surfaces.
  return (
    <main className={readOnly ? 'workspace is-read-only' : 'workspace'}>
      <BoardMenu
        boardTitle={boardTitle}
        canCopyToCloud={cloudBoard === null && currentUser !== null}
        canCreateCloud={currentUser !== null}
        fontSettingsOpen={fontSettingsOpen}
        gridDotSize={gridDotSize}
        gridLineOpacity={gridLineOpacity}
        gridSettingsOpen={gridSettingsOpen}
        gridSpacing={gridSpacing}
        gridStyle={gridStyle}
        fontChoice={fontChoice}
        menuOpen={menuOpen}
        newBoardOptionsOpen={newBoardOptionsOpen}
        onBoardTitleChange={(title) => {
          markCloudPublication();
          setBoardTitle(title);
        }}
        onBoardTitleCommit={(title) => {
          markCloudPublication();
          setBoardTitle(normalizedBoardTitle(title));
        }}
        onCopyToCloud={() => void copyLocalBoardToCloud()}
        onCreateCloudBoard={() => void createCloudBoard()}
        onCreateLocalBoard={() => {
          setMenuOpen(false);
          setNewBoardOptionsOpen(false);
          onCreateLocalBoard?.();
        }}
        onExportBoard={() => void exportEditableBoard()}
        onImportBoard={() => {
          setMenuOpen(false);
          boardImportInputRef.current?.click();
        }}
        onOpenBoards={() => {
          setMenuOpen(false);
          onOpenBoards?.();
        }}
        onOpenBoardInvites={() => {
          setMenuOpen(false);
          onOpenBoardInvites?.();
        }}
        onClearCanvas={() => {
          commitElements([]);
          setSelectedIds([]);
          setMenuOpen(false);
        }}
        onGridDotSizeChange={setGridDotSize}
        onGridLineOpacityChange={setGridLineOpacity}
        onGridSpacingChange={setGridSpacing}
        onGridStyleChange={(style) => {
          setGridSpacing(loadGridSpacing(theme, style));
          setGridStyle(style);
        }}
        onWorkspaceFontChoiceChange={(choice) => {
          setWorkspaceFontChoice(choice);
          void applyWorkspaceFontChoice(choice);
        }}
        onOpenExport={() => {
          setMenuOpen(false);
          setExportOpen(true);
        }}
        onOpenLatexCheatsheet={() => {
          setMenuOpen(false);
          setObjectNavigatorOpen(false);
          setLatexCheatsheetOpen(true);
        }}
        onOpenShortcuts={() => {
          setMenuOpen(false);
          setObjectNavigatorOpen(false);
          setShortcutsOpen(true);
        }}
        onToggleFontSettings={() => {
          setNewBoardOptionsOpen(false);
          setGridSettingsOpen(false);
          setThemeSettingsOpen(false);
          setFontSettingsOpen((current) => !current);
        }}
        onThemeChange={selectTheme}
        onToggleThemeSettings={() => {
          setNewBoardOptionsOpen(false);
          setGridSettingsOpen(false);
          setFontSettingsOpen(false);
          setThemeSettingsOpen((current) => !current);
        }}
        onToggleGrid={() => setShowGrid((current) => !current)}
        onToggleGridSettings={() => {
          setNewBoardOptionsOpen(false);
          setFontSettingsOpen(false);
          setThemeSettingsOpen(false);
          setGridSettingsOpen((current) => !current);
        }}
        onToggleMenu={() => {
          if (!menuOpen) {
            setNewBoardOptionsOpen(false);
            setGridSettingsOpen(false);
            setFontSettingsOpen(false);
            setThemeSettingsOpen(false);
          }
          setMenuOpen((current) => !current);
        }}
        onToggleNewBoardOptions={() => {
          setGridSettingsOpen(false);
          setFontSettingsOpen(false);
          setThemeSettingsOpen(false);
          setNewBoardOptionsOpen((current) => !current);
        }}
        readOnly={readOnly}
        showGrid={showGrid}
        theme={theme}
        themeSettingsOpen={themeSettingsOpen}
      >
        <input
          ref={boardImportInputRef}
          className="sr-only"
          type="file"
          accept=".chalkboard,application/vnd.chalkboard.board+zip"
          aria-label="Choose editable board file"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file !== undefined) void importEditableBoard(file);
          }}
        />
        <input
          ref={imageInputRef}
          className="sr-only"
          type="file"
          accept="image/avif,image/gif,image/jpeg,image/png,image/svg+xml,image/webp,.svg"
          aria-label="Choose image or SVG file"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file !== undefined) void importImage(file);
          }}
        />
        <div className="status-stack">
          {notices}
          {invitationError !== undefined && (
            <StatusNotice
              actions={[
                {
                  label: 'Dismiss',
                  onClick: () => onDismissInvitationError?.(),
                },
              ]}
              body={invitationError}
              tone="warning"
            />
          )}
          {boardLimitStatus !== null && (
            <StatusNotice
              actions={[
                { label: 'Dismiss', onClick: () => setBoardLimitStatus(null) },
              ]}
              body={boardLimitStatus}
              tone="warning"
            />
          )}
          {operationStatus !== null && (
            <StatusNotice
              actions={[
                ...(operationStatus.cancel === undefined
                  ? []
                  : [{ label: 'Cancel', onClick: operationStatus.cancel }]),
                ...(operationStatus.retry === undefined
                  ? []
                  : [{ label: 'Retry', onClick: operationStatus.retry }]),
              ]}
              body={operationStatus.text}
              tone={operationStatus.error ? 'warning' : 'plain'}
            />
          )}
        </div>
        <span className="sr-only" aria-live="polite">
          {operationAnnouncement}
        </span>
      </BoardMenu>

      <ShortcutsDialog
        onClose={() => setShortcutsOpen(false)}
        open={shortcutsOpen}
        toolLabels={supportedToolOrder.map((tool) => toolDetails[tool].label)}
      />

      <ExportDialog
        canExportSelection={selectedIds.length > 0}
        onClose={() => setExportOpen(false)}
        onExport={(options) =>
          exportWorkspaceImage({
            boardTitle,
            elements: documentState.present,
            fontChoice,
            options,
            selectedIds,
            theme,
          })
        }
        open={exportOpen}
      />

      {latexCheatsheetOpen && (
        <LatexCheatsheet onClose={() => setLatexCheatsheetOpen(false)} />
      )}

      {objectNavigatorOpen ? (
        <ObjectNavigator
          elements={documentState.present}
          focusOnOpen={objectNavigatorFocusOnOpen}
          onCenterObject={(id) => {
            const element = documentState.present.find(
              (candidate) => candidate.id === id,
            );
            if (element === undefined) return;
            centerAtVerticalStart(rotatedElementBounds(element));
          }}
          onClose={closeSelectionObjectNavigator}
          onDeleteSelected={deleteSelection}
          onDropAtEdge={dropSelectedAtEdge}
          onDropSelected={dropSelectedInOrder}
          onMoveSelected={moveSelectedInOrder}
          onSelect={(id, mode) => {
            selectTool('selection');
            setRecentlyCreatedId(null);
            setSelectedIds((current) =>
              mode === 'toggle'
                ? current.includes(id)
                  ? current.filter((value) => value !== id)
                  : [...current, id]
                : [id],
            );
          }}
          onSelectRange={(ids) => {
            selectTool('selection');
            setRecentlyCreatedId(null);
            setSelectedIds(ids);
          }}
          readOnly={readOnly}
          selectedIds={selectedIdSet}
        />
      ) : null}

      <ToolDock
        activeTool={availableActiveTool}
        canDelete={canDeleteCurrent}
        displayedPathKind={displayedPathKind}
        displayedShapeKind={displayedShapeKind}
        editingEquation={editingEquation !== null}
        inputMode={inputMode}
        onDelete={deleteSelection}
        onImport={() => {
          setOperationStatus(null);
          selectTool('selection');
          imageInputRef.current?.click();
        }}
        onSelectTool={selectTool}
        sourceView={editingView === 'source'}
        onToggleActiveEquationMode={() =>
          setModeToggleToken((current) => current + 1)
        }
        onToggleSelectionObjects={toggleObjectNavigator}
        onToggleInputMode={() =>
          setInputMode((current) => (current === 'math' ? 'text' : 'math'))
        }
        onToolOrderChange={setToolOrder}
        readOnly={readOnly}
        selectionObjectsOpen={objectNavigatorOpen}
        toolOrder={supportedToolOrder}
      />

      <CloudControls
        cloudBoardActive={cloudBoard !== null && cloudAccessConfirmed}
        collaborators={cloudCollaborators}
        connectionState={cloudConnectionState}
        currentUser={currentUser}
        deviceRecoveryState={cloudDeviceRecoveryState}
        draftPending={editorContentPending}
        editActivity={editActivity}
        hasPendingWork={cloudHasPendingWork}
        onOpenAccount={onOpenAccount}
        onRetryConnection={retryCloudConnection}
        onRetryTitle={retryCloudBoardTitle}
        onShare={onManageCloudAccess ?? onOpenAccount ?? (() => undefined)}
        shareLabel="Share"
        titleState={cloudBoardTitleState}
        viewerRole={cloudBoard?.role === 'viewer'}
      />
      {!readOnly &&
      (activeTool === 'equation' ||
        (activeTool === 'selection' && hasStyleableSelection) ||
        (activeTool !== 'selection' && activeTool !== 'hand')) ? (
        <StylePanel
          editingEquation={editingEquation !== null}
          inputMode={inputMode}
          onInputModeChange={selectEquationInputMode}
          showInputMode={showInputModeControls}
        >
          {showColorControls ? (
            <>
              <span className="panel-label">
                {usesTextColor ? 'Text color' : 'Stroke color'}
              </span>
              <ColorSwatches
                activeColor={resolveStrokeColor(displayedStyle, theme)}
                colors={
                  activeTool === 'shape' || selectedShape !== undefined
                    ? ['transparent', ...strokeColors]
                    : strokeColors
                }
                defaultColors={defaultStrokeColors}
                kind={usesTextColor ? 'text' : 'stroke'}
                onChange={(color) =>
                  updateSelectedStyle({ [strokeColorField(theme)]: color })
                }
                onRemove={removeCustomColor}
                onTogglePicker={() => {
                  if (colorPickerTarget === 'stroke') closeColorPicker();
                  else setColorPickerTarget('stroke');
                }}
                pickerOpen={colorPickerTarget === 'stroke'}
              />
            </>
          ) : null}
          {showColorControls && colorPickerTarget !== null && (
            <ColorPicker
              draft={customColorDraft}
              hsv={customColorHsv}
              onClose={closeColorPicker}
              onHexChange={updateCustomColorHex}
              onHsvChange={updateCustomColorHsv}
              onRgbChange={updateCustomColorRgb}
              onSubmit={submitCustomColor}
              target={colorPickerTarget}
            />
          )}
          {(activeTool === 'shape' || selectedShape !== undefined) && (
            <ShapeControls
              ellipseEndAngle={displayedEllipseArc.endAngle}
              ellipseStartAngle={displayedEllipseArc.startAngle}
              onChange={(nextShapeKind) =>
                updateSelectedShape({
                  ...(displayedShapeKind === 'ellipse' ||
                  nextShapeKind === 'ellipse'
                    ? {
                        ellipseEndAngle: displayedEllipseArc.endAngle,
                        ellipseStartAngle: displayedEllipseArc.startAngle,
                      }
                    : {}),
                  shapeKind: nextShapeKind,
                })
              }
              onEllipseAngleChange={updateSelectedEllipseArc}
              onEllipseAngleGestureChange={(phase) => {
                ellipseArcGestureRef.current =
                  phase === 'start' ? { committed: false } : null;
              }}
              shapeKind={displayedShapeKind}
              showKindOptions={activeTool === 'shape'}
            />
          )}
          {(activeTool === 'line' || selectedLine !== undefined) && (
            <PathControls
              allowFreehand={activeTool === 'line'}
              fit={{
                ...bezierFit,
                continuity: displayedSplineContinuity,
              }}
              manualMaximum={manualBezierMaxSegments}
              onAccuracyChange={(accuracy) =>
                setBezierFit((current) => ({ ...current, accuracy }))
              }
              onContinuityChange={updateSelectedSplineContinuity}
              onManualMaximumChange={(maxSegments) => {
                setManualBezierMaxSegments(maxSegments);
                setBezierFit((current) => ({ ...current, maxSegments }));
              }}
              onPathChange={(kind) => {
                updateSelectedLine(kind);
                setBezierHandlePreviewId(null);
              }}
              onToggleAutomaticMaximum={() => {
                setBezierFit((current) => {
                  if (current.maxSegments === null) {
                    return {
                      ...current,
                      maxSegments: manualBezierMaxSegments,
                    };
                  }
                  setManualBezierMaxSegments(current.maxSegments);
                  return { ...current, maxSegments: null };
                });
              }}
              pathKind={displayedPathKind}
              showFittingControls={activeTool === 'line'}
            />
          )}
          {(activeTool === 'shape' ||
            selectedShape !== undefined ||
            activeTool === 'line' ||
            selectedLine !== undefined ||
            selectedFreehand !== undefined) && (
            <StrokeControls
              arrowheads={displayedLineArrowheads}
              cornerRadius={displayedCornerRadius}
              isLine={
                activeTool === 'line' ||
                selectedLine !== undefined ||
                selectedFreehand !== undefined
              }
              isOrthogonalLine={
                selectedOrthogonalLine !== undefined ||
                (activeTool === 'line' &&
                  selectedLine === undefined &&
                  pathKind === 'orthogonal')
              }
              isShape={activeTool === 'shape' || selectedShape !== undefined}
              onArrowheadsChange={updateSelectedLineArrowheads}
              onCornerRadiusChange={updateSelectedCornerRadius}
              onCornerRadiusGestureChange={(phase) => {
                cornerRadiusGestureRef.current =
                  phase === 'start' ? { committed: false } : null;
              }}
              onStrokeDashGapChange={updateSelectedStrokeDashGap}
              onStrokeDashGapGestureChange={(phase) => {
                strokeDashGapGestureRef.current =
                  phase === 'start' ? { committed: false } : null;
              }}
              onStyleChange={updateSelectedStyle}
              shapeKind={displayedShapeKind}
              style={displayedStyle}
            />
          )}
          {usesTextColor && (
            <TextControls
              editingView={editingView}
              inputMode={inputMode}
              lineSpacing={displayedLineSpacing}
              lineSpacingInput={lineSpacingInput}
              onCommitLineSpacingInput={commitLineSpacingInput}
              onCommitTextSizeInput={commitTextSizeInput}
              onEditingViewChange={changeEditingView}
              onFocusEditor={focusActiveEquationEditor}
              onLineSpacingChange={updateLineSpacing}
              onLineSpacingDraftChange={(value) =>
                setLineSpacingDraft({
                  lineSpacing: displayedLineSpacing,
                  value,
                })
              }
              onLineSpacingGestureChange={(phase) => {
                lineSpacingGestureRef.current =
                  phase === 'start' ? { committed: false } : null;
              }}
              onRegularText={() => requestTextStyle({ style: 'regular' })}
              onTextSizeChange={updateTextSize}
              onTextSizeDraftChange={(value) =>
                setTextSizeDraft({ fontSize: displayedTextSize, value })
              }
              onTextSizeGestureChange={(phase) => {
                textSizeGestureRef.current =
                  phase === 'start' ? { committed: false } : null;
              }}
              onToggleTextStyle={toggleTextStyle}
              showEditingView={
                editingEquation !== null || activeTool === 'equation'
              }
              showTextStyle={showTypingControls}
              textSize={displayedTextSize}
              textSizeInput={textSizeInput}
              textStyle={textStyle}
            />
          )}
          {(activeTool === 'shape' || selectedShape !== undefined) && (
            <>
              <span className="panel-label">Fill</span>
              <ColorSwatches
                activeColor={resolveBackgroundColor(displayedStyle, theme)}
                colors={fillColors}
                defaultColors={defaultFillColors}
                kind="fill"
                onChange={(color) =>
                  updateSelectedStyle({
                    [backgroundColorField(theme)]: color,
                  })
                }
                onRemove={removeCustomFillColor}
                onTogglePicker={() => {
                  if (colorPickerTarget === 'fill') closeColorPicker();
                  else setColorPickerTarget('fill');
                }}
                pickerOpen={colorPickerTarget === 'fill'}
              />
              {resolveBackgroundColor(displayedStyle, theme) !==
                'transparent' && (
                <>
                  <span className="panel-label">Fill style</span>
                  <div
                    className="stroke-pattern-options"
                    role="group"
                    aria-label="Fill style"
                  >
                    {(
                      [
                        ['solid', 'Solid fill'],
                        ['hachure', 'Hachure fill'],
                        ['cross-hatch', 'Cross-hatch fill'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        type="button"
                        className={
                          displayedFillStyle === value
                            ? 'stroke-pattern-option is-active'
                            : 'stroke-pattern-option'
                        }
                        aria-label={`Use ${label.toLowerCase()}`}
                        aria-pressed={displayedFillStyle === value}
                        title={label}
                        key={value}
                        onClick={() => updateSelectedFillStyle(value)}
                      >
                        <span
                          className={`fill-style-sample is-${value}`}
                          style={{
                            color: resolveBackgroundColor(
                              displayedStyle,
                              theme,
                            ),
                          }}
                        />
                      </button>
                    ))}
                  </div>
                  {displayedFillStyle !== 'solid' && (
                    <>
                      <span className="panel-label">Fill spacing</span>
                      <div className="slider-with-value">
                        <input
                          type="range"
                          aria-label="Fill spacing slider"
                          min={MIN_SHAPE_FILL_SPACING}
                          max={MAX_SHAPE_FILL_SPACING}
                          step="1"
                          // Reversed: dragging right is denser, so the gap runs
                          // high to low across the track while the slider's own
                          // value still increases the way a range input must.
                          value={invertedFillSpacing(displayedFillSpacing)}
                          onChange={(event) =>
                            updateSelectedFillSpacing(
                              invertedFillSpacing(
                                Number(event.currentTarget.value),
                              ),
                            )
                          }
                          onPointerDown={() => {
                            fillSpacingGestureRef.current = {
                              committed: false,
                            };
                          }}
                          onPointerUp={() => {
                            fillSpacingGestureRef.current = null;
                          }}
                          onPointerCancel={() => {
                            fillSpacingGestureRef.current = null;
                          }}
                        />
                        <output>{displayedFillSpacing}px</output>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </StylePanel>
      ) : null}

      <div className={`canvas-viewport ${cursorClass}`} ref={viewportRef}>
        <canvas className="canvas-layer grid-layer" ref={gridCanvasRef} />
        <LayeredContent
          camera={camera}
          canvasSize={canvasSize}
          editingEquationId={editingEquation?.id}
          isEquationEditorReady={
            isEquationEditorReady || editingView === 'source'
          }
          layers={contentLayers}
          onMeasureEquation={measureEquation}
          selectedIds={selectedIdSet}
          viewportReady={viewportReady}
        />
        <div className="dom-layer">
          <CollaborationOverlay
            camera={camera}
            collaborators={cloudCollaborators}
            elements={nearbyDisplayElements}
          />
          {editingEquation !== null && editorElement !== undefined ? (
            <EquationEditor
              camera={camera}
              editingView={editingView}
              key={editingEquation.sessionId}
              caretPoint={equationCaretPoint}
              caretPosition={equationCaretPosition}
              element={editorElement}
              historyActorId={historyActorId}
              historySession={retainedEquationHistory}
              isReady={isEquationEditorReady}
              initialMode={inputMode}
              modeToggleToken={modeToggleToken}
              textBold={textStyle.bold}
              textItalic={textStyle.italic}
              onCaretChange={(position) =>
                rememberEquationCaret(editorElement.id, position)
              }
              onChange={(source, width, height) =>
                changeEquationSource(
                  editingEquation.sessionId,
                  source,
                  width,
                  height,
                )
              }
              onCommit={(source, width, height) =>
                commitEquationEdit(
                  editingEquation.sessionId,
                  source,
                  width,
                  height,
                )
              }
              onHistoryAvailabilityChange={(availability) =>
                setEquationHistoryAvailability((current) => {
                  const next = {
                    ...availability,
                    sessionId: editingEquation.sessionId,
                  };
                  return current.sessionId === next.sessionId &&
                    current.canUndo === next.canUndo &&
                    current.canRedo === next.canRedo
                    ? current
                    : next;
                })
              }
              onHistorySession={(history) => {
                if (equationHistoryKey === null) return;
                const sessions = equationHistorySessions;
                sessions.delete(equationHistoryKey);
                sessions.set(equationHistoryKey, history);
                if (sessions.size > 100) {
                  const oldestKey = sessions.keys().next().value;
                  if (oldestKey !== undefined) sessions.delete(oldestKey);
                }
              }}
              onModeChange={changeEquationInputMode}
              onTextStyleChange={changeTextStyle}
              onPersist={(source, width, height) =>
                persistEquationEdit(
                  editingEquation.sessionId,
                  source,
                  width,
                  height,
                )
              }
              onReady={() => setReadyEquationSession(editingEquation.sessionId)}
              onSourceRenderError={() =>
                setOperationStatus({
                  error: true,
                  text: 'Kept your source as written; it could not be rendered.',
                })
              }
              typingColor={resolveStrokeColor(elementStyle, theme)}
            />
          ) : null}
        </div>
        <canvas
          className="canvas-layer interaction-layer"
          ref={overlayCanvasRef}
          role="application"
          aria-label="Chalkboard drawing canvas"
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={(event) => {
            handlePointerMove(event);
            const bounds = viewportRef.current?.getBoundingClientRect();
            if (bounds !== undefined) {
              updateCloudCursor(
                screenToWorld(
                  {
                    x: event.clientX - bounds.left,
                    y: event.clientY - bounds.top,
                  },
                  camera,
                ),
              );
            }
          }}
          onPointerLeave={() => {
            updateCloudCursor(null);
            handlePointerLeave();
          }}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        />
      </div>

      <ZoomControls
        camera={camera}
        canvasSize={canvasSize}
        onReset={resetCamera}
        onZoom={zoomBy}
      />

      {!readOnly ? (
        <HistoryControls
          canRedo={
            editingEquation !== null
              ? equationHistoryAvailability.sessionId ===
                  editingEquation.sessionId &&
                equationHistoryAvailability.canRedo
              : historyTargetIds.length > 0
                ? boardStructureHistory.canRedoSelection(
                    historyTargetIds,
                    historyActorId,
                  ) ||
                  (historyTargetIsPresent &&
                    (objectEditHistory.canStep(
                      historyTargetIds,
                      1,
                      documentState.present,
                      historyActorId,
                    ) ||
                      (boardStructureHistory.canUndoSelection(
                        historyTargetIds,
                        historyActorId,
                      ) &&
                        boardStructureHistory.canRedo(historyActorId))))
                : activeTool === 'selection' &&
                  boardStructureHistory.canRedo(historyActorId)
          }
          canUndo={
            editingEquation !== null
              ? equationHistoryAvailability.sessionId ===
                  editingEquation.sessionId &&
                equationHistoryAvailability.canUndo
              : historyTargetIds.length > 0
                ? (historyTargetIsPresent &&
                    objectEditHistory.canStep(
                      historyTargetIds,
                      -1,
                      documentState.present,
                      historyActorId,
                    )) ||
                  boardStructureHistory.canUndoSelection(
                    historyTargetIds,
                    historyActorId,
                  ) ||
                  (!historyTargetIsPresent &&
                    boardStructureHistory.canRedoSelection(
                      historyTargetIds,
                      historyActorId,
                    ) &&
                    boardStructureHistory.canUndo(historyActorId))
                : activeTool === 'selection' &&
                  boardStructureHistory.canUndo(historyActorId)
          }
          onRedo={() => requestWorkspaceHistory('redo')}
          onUndo={() => requestWorkspaceHistory('undo')}
        />
      ) : null}

      <div className="sr-only" aria-live="polite">
        Canvas contains {documentState.present.length}{' '}
        {documentState.present.length === 1 ? 'object' : 'objects'}
      </div>
    </main>
  );
}
