/**
 * Owns one imperative MathLive field from construction through teardown. It
 * coordinates command entry, mode/style, selection, pointer/keyboard events,
 * clipboard, history, canonical publication, measurement, focus, and recovery.
 */
import { worldToScreen, type Point } from '@chalkboard/shared';
import { MathfieldElement } from 'mathlive';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { flushSync } from 'react-dom';

import {
  bufferedCommandCompletion,
  deferredCommandCompletion,
  fillBufferedCommandCompletion,
  fillDeferredCommandCompletion,
  immediateCommandCompletion,
  type BufferedCommandCompletion,
} from './commandCompletion';
import { EditorCommandController } from './editorCommandController';
import { materializeMathLiveEditorDocument } from './editorDocumentModel';
import {
  clipboardTextFromMathLiveSelection,
  editorClipboardInsertions,
} from './editorClipboard';
import { installEditorEventLifecycle } from './editorEventLifecycle';
import { EditorSelectionController } from './editorSelectionController';
import { decorateExcalifontLayout } from './excalifontLayout';
import { applyLineClearance } from './lineClearance';
import { EditorPublicationController } from './editorPublication';
import { MixedEditorHistory } from './editorHistory';
import type { InlineMathEditorProps } from './InlineMathEditor.types';
import { INLINE_MATH_EDITOR_SHADOW_CSS } from './inlineMathEditorShadowCss';
import {
  getWorkspaceFontChoice,
  waitForWorkspaceFonts,
} from './mathLiveRuntime';
import { mathArrayStretch } from './mathLineSpacing';
import { configureMobileMathKeyboard } from './mobileMathKeyboard';
import { mergeEquationSourceEdit } from './mergeEquationSourceEdit';
import { installSourceCaretSynchronization } from './sourceCaretSynchronization';
import { focusDeliberately, writerHoldsAnotherControl } from './writerFocus';
import {
  canonicalizeMathLiveEditorValue,
  expandTextColors,
  expandTextStyles,
  fromMathLiveMultilineSource,
  isEmptyMixedSource,
  isMathOnlyMixedSource,
  isTextColorMarker,
  isTextStyleMarker,
  MATHLIVE_BOLD_OFF,
  MATHLIVE_BOLD_ON,
  MATHLIVE_ITALIC_OFF,
  MATHLIVE_ITALIC_ON,
  MATHLIVE_LINE_BREAK,
  MATHLIVE_BARE_DOLLAR,
  MATHLIVE_LITERAL_BACKSLASH,
  MATHLIVE_LITERAL_BRACE_LEFT,
  MATHLIVE_LITERAL_BRACE_RIGHT,
  MATHLIVE_LITERAL_DOLLAR,
  MATHLIVE_LITERAL_PERCENT,
  mathSegments,
  mixedSourceFromMathLiveEditor,
  textColorForMarker,
} from './mixedMath';

/**
 * How long after a press a second one in the same place still reads as one
 * gesture. Matched to the common operating-system double-click time so the
 * editor asks no more of the writer's hand than the rest of their desktop does.
 */
const DOUBLE_PRESS_MILLISECONDS = 500;

/** How far the second press may land from the first and still be the same gesture. */
const DOUBLE_PRESS_SLOP = 5;

/** Conservative identity for an external edit whose account is not in the prop update. */

/**
 * Adapts MathLive's mutable field to Chalkboard's canonical mixed source. One
 * mounted field owns input normalization, command transactions, history,
 * selection mapping, publication, and teardown for an editing session.
 *
 * MathLive may emit browser events before its host transaction and may repaint
 * selection state after handlers return. The lifecycle below therefore keeps
 * source, selection, and publication ordering explicit rather than treating the
 * field as a conventional controlled input.
 */
export function InlineMathEditor({
  camera,
  caretPoint,
  caretPosition,
  element,
  historyActorId,
  historySession,
  isReady,
  initialMode,
  modeToggleToken,
  onCaretChange,
  onChange,
  onCommit,
  onHistoryAvailabilityChange,
  onHistorySession,
  onModeChange,
  onPersist,
  onReady,
  onSourceRenderError,
  onTextStyleChange,
  sourceView,
  textBold,
  textItalic,
  typingColor,
}: InlineMathEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const applyExternalSourceRef = useRef<(source: string) => void>(
    () => undefined,
  );
  const applyPendingRawSourceRef = useRef<() => void>(() => undefined);
  const onSourceRenderErrorRef = useRef(onSourceRenderError);
  const onCaretChangeRef = useRef(onCaretChange);
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const onHistoryAvailabilityChangeRef = useRef(onHistoryAvailabilityChange);
  const onHistorySessionRef = useRef(onHistorySession);
  const onModeChangeRef = useRef(onModeChange);
  const onTextStyleChangeRef = useRef(onTextStyleChange);
  const onPersistRef = useRef(onPersist);
  const onReadyRef = useRef(onReady);
  const toggleModeRef = useRef<() => void>(() => undefined);
  const setTypingColorRef = useRef<(color: string) => void>(() => undefined);
  const typingColorValueRef = useRef(typingColor);
  const previousModeToggleTokenRef = useRef(modeToggleToken);
  const initialModeRef = useRef(initialMode);
  const historyActorIdRef = useRef(historyActorId);
  const initialHistorySessionRef = useRef(historySession);
  const initialBaseColorRef = useRef(element.strokeColor);
  const spacingRef = useRef(element.lineSpacing);
  // The field is decorated from inside the long-lived effect below, which does
  // not re-run on camera changes, so the zoom is read through a ref rather than
  // captured.
  const zoomRef = useRef(camera.zoom);
  const sourceViewRef = useRef(sourceView);
  const resumeEditorReadinessRef = useRef<() => void>(() => undefined);
  const handleEditingViewTransitionRef = useRef<() => void>(() => undefined);
  const renderedEntrySourceRef = useRef<string | null>(null);
  const renderedViewEditedRef = useRef(false);
  const viewTransitionRef = useRef(false);
  const initialTextStyleRef = useRef({ bold: textBold, italic: textItalic });
  const latestElementSourceRef = useRef(element.source);
  const [initialLatex] = useState(element.source);
  const [publicationController] = useState(
    () =>
      new EditorPublicationController({
        height: element.height,
        source: element.source,
        width: element.width,
      }),
  );
  const position = worldToScreen(element, camera);

  useLayoutEffect(() => {
    onCaretChangeRef.current = onCaretChange;
    onChangeRef.current = onChange;
    onCommitRef.current = onCommit;
    historyActorIdRef.current = historyActorId;
    onHistoryAvailabilityChangeRef.current = onHistoryAvailabilityChange;
    onHistorySessionRef.current = onHistorySession;
    onModeChangeRef.current = onModeChange;
    onTextStyleChangeRef.current = onTextStyleChange;
    onPersistRef.current = onPersist;
    onReadyRef.current = onReady;
    onSourceRenderErrorRef.current = onSourceRenderError;
  }, [
    onCaretChange,
    onChange,
    onCommit,
    historyActorId,
    onHistoryAvailabilityChange,
    onHistorySession,
    onModeChange,
    onPersist,
    onReady,
    onSourceRenderError,
    onTextStyleChange,
  ]);

  useLayoutEffect(() => {
    latestElementSourceRef.current = element.source;
  }, [element.source]);

  useLayoutEffect(() => {
    if (sourceViewRef.current === sourceView) return;
    const previousSourceView = sourceViewRef.current;
    sourceViewRef.current = sourceView;
    handleEditingViewTransitionRef.current();
    if (previousSourceView && !sourceView) {
      renderedViewEditedRef.current = false;
      applyPendingRawSourceRef.current();
      resumeEditorReadinessRef.current();
    }
    viewTransitionRef.current = true;
    const timer = window.setTimeout(() => {
      viewTransitionRef.current = false;
    }, 200);
    return () => window.clearTimeout(timer);
  }, [sourceView]);

  useEffect(() => {
    if (previousModeToggleTokenRef.current === modeToggleToken) return;
    previousModeToggleTokenRef.current = modeToggleToken;
    // Source view has no math/text mode: the characters typed are the source.
    if (sourceViewRef.current) return;
    toggleModeRef.current();
  }, [modeToggleToken]);

  useLayoutEffect(() => {
    typingColorValueRef.current = typingColor;
    setTypingColorRef.current(typingColor);
  }, [typingColor]);

  useLayoutEffect(() => {
    applyExternalSourceRef.current(element.source);
  }, [element.source]);

  useLayoutEffect(() => {
    zoomRef.current = camera.zoom;
  }, [camera.zoom]);

  useLayoutEffect(() => {
    spacingRef.current = element.lineSpacing;
    const field =
      containerRef.current?.querySelector<MathfieldElement>('math-field');
    if (field !== null && field !== undefined) {
      field.registers.arraystretch = mathArrayStretch(element.lineSpacing);
    }
  }, [element.lineSpacing]);

  // One effect owns the imperative field from construction through teardown.
  // Splitting that ownership across React effects would introduce ordering
  // races between MathLive's model, DOM, selection, and browser events.
  useEffect(() => {
    const parent = containerRef.current;
    if (parent === null) return;
    const needsDisconnectBlur = navigator.userAgent.includes('Firefox');
    let disposed = false;
    let mounted = false;
    let finishing = false;
    let editorReady = false;
    let preserveEarlyLineSelection = false;
    const earlyInputs: (
      | {
          bold: boolean;
          color: string;
          italic: boolean;
          key: string;
          kind: 'key';
          mode: 'math' | 'text';
        }
      | {
          kind: 'paste';
          mode: 'math' | 'text';
          text: string;
        }
    )[] = [];
    let positionInitialized = false;
    let clickedPositionQueued = false;
    let clickedPositionAdjusted = false;
    let pointerSelection: {
      anchor: number;
      anchorPoint: Point;
      pointerId: number;
    } | null = null;
    let blurTimer: number | null = null;
    let focusFrame: number | null = null;
    let fontMeasureFrame: number | null = null;
    let selectionFrame: number | null = null;
    let lineSelectionPointerId: number | null = null;
    let lineSelectionRange: { end: number; start: number } | null = null;
    let lineSelectionRestoreFrame: number | null = null;
    let lineSelectionClickResetTimer: number | null = null;
    let suppressLineSelectionCompatibilityEvents = false;
    let lastFieldPointerDown: { time: number; x: number; y: number } | null =
      null;
    let lineBreakObserver: MutationObserver | null = null;
    let emptyMathRegion = false;
    let preserveMathAfterDeletion = false;
    // MathLive can normalize an after-sentinel caret back onto the sentinel in
    // Firefox while continuing to paint it on the following row. Preserve the
    // semantic side until a deliberate edit or pointer action consumes it, so
    // source view and the next insertion cannot mistake that row for the end
    // of the preceding one.
    let lineBreakCaretAffinity: {
      breakOffset: number;
      position: number;
    } | null = null;
    let verticalColumn: number | null = null;
    let activeInputMode = initialModeRef.current;
    let activeRequestedTextStyle = { ...initialTextStyleRef.current };
    const expandedInitialLatex = expandTextStyles(
      expandTextColors(initialLatex, initialBaseColorRef.current),
    );
    const initialDocument = materializeMathLiveEditorDocument(
      expandedInitialLatex,
      activeInputMode,
    );
    let retainsMathOnlySource = initialDocument.retainsMathOnlySource;
    let hasExplicitMath = initialDocument.hasExplicitMath;
    let editorHistory: MixedEditorHistory | null = null;
    let reportedHistoryAvailability: {
      canRedo: boolean;
      canUndo: boolean;
    } | null = null;
    const reportEditorHistoryAvailability = () => {
      const availability = {
        canRedo: editorHistory?.canRedoFor(historyActorIdRef.current) ?? false,
        canUndo: editorHistory?.canUndoFor(historyActorIdRef.current) ?? false,
      };
      if (
        reportedHistoryAvailability?.canRedo === availability.canRedo &&
        reportedHistoryAvailability.canUndo === availability.canUndo
      ) {
        return;
      }
      reportedHistoryAvailability = availability;
      onHistoryAvailabilityChangeRef.current(availability);
    };
    let bufferedCommandState: {
      argument: string;
      argumentIndex: number;
      arguments: string[];
      completion: BufferedCommandCompletion;
    } | null = null;
    let commandCompletionPending = false;
    let finishCommandHistoryOnKeyUp = false;
    let applyingExternalSource = false;
    let restoringTextStyles = false;
    let pendingStyleInputs = 0;
    let deferredCommandTemplate: string | null = null;
    let unselectableCommandCompletion: string | null = null;
    let requestedCaretPoint: Point | null = null;
    let requestedCaretOffset: number | null = null;
    let requestedCaretPointQueued = false;
    let requestedCaretPointAttempts = 0;
    let sourceHistoryPosition = initialLatex.length;
    let localSourceEditPending = false;
    let pendingExternalHistoryActor: string | null = null;
    let replayLineBreak: (() => void) | null = null;
    let replayPaste: ((text: string) => void) | null = null;
    let finalizePendingInput: () => void = () => undefined;

    // Construct the field and every controller that shares its exact lifetime.
    configureMobileMathKeyboard();
    MathfieldElement.soundsDirectory = null;
    const field = new MathfieldElement();
    const commandController = new EditorCommandController(field);
    const latexCommandTransaction = {
      begin: (position: number) => commandController.beginTransaction(position),
      clear: () => commandController.clearTransaction(),
    };
    field.dataset.workspaceFont = getWorkspaceFontChoice();
    const selectionOverlay = document.createElement('div');
    selectionOverlay.className = 'inline-math-editor__selection';
    field.defaultMode = initialDocument.defaultMode;
    field.smartFence = true;
    field.smartSuperscript = true;
    field.popoverPolicy = 'off';
    field.mathVirtualKeyboardPolicy = 'auto';
    field.setAttribute('aria-label', 'Edit equation');
    field.style.setProperty('--editor-color', initialBaseColorRef.current);
    const caretStyle = document.createElement('style');
    const updateCommandEntryPresentation = () => {
      if (disposed) return;
      field.toggleAttribute(
        'data-latex-command-active',
        field.mode === 'latex',
      );
    };
    const scheduleCommandEntryPresentation = () => {
      window.queueMicrotask(updateCommandEntryPresentation);
    };
    caretStyle.textContent = INLINE_MATH_EDITOR_SHADOW_CSS;

    const lineBreakOffsets = () => selectionController.lineBreakOffsets();
    const terminalPlaceholderBreak = () => {
      const terminalBreak = lineBreakOffsets().at(-1);
      if (terminalBreak === undefined) return null;
      const terminalValue = field.getValue([
        terminalBreak + 1,
        field.lastOffset,
      ]);
      const terminalMath = mathSegments(terminalValue);
      return terminalValue.includes('\\placeholder{}') &&
        terminalMath.length === 1 &&
        isMathOnlyMixedSource(terminalValue) &&
        isEmptyMixedSource(terminalValue)
        ? terminalBreak
        : null;
    };
    const semanticFieldPosition = () =>
      lineBreakCaretAffinity !== null &&
      field.position >= lineBreakCaretAffinity.breakOffset &&
      field.position <= lineBreakCaretAffinity.position
        ? Math.min(lineBreakCaretAffinity.position, field.lastOffset)
        : field.position;
    const consumeLineBreakCaretAffinity = () => {
      if (lineBreakCaretAffinity === null) return;
      field.position = semanticFieldPosition();
      lineBreakCaretAffinity = null;
    };
    const historyPosition = () =>
      selectionController.logicalPositionFromField(semanticFieldPosition());
    const fieldPositionFromHistory = (position: number) =>
      selectionController.fieldPositionFromHistory(position);
    const constrainPositionToClickedLine = () =>
      selectionController.constrainPositionToClickedLine(caretPoint);
    const nearestOffsetAtPoint = (point: Point) =>
      selectionController.nearestOffsetAtPoint(point);
    const clearPointerSelection = () =>
      selectionController.clearPointerSelection();
    const showPointerSelection = (
      anchor: number,
      anchorPoint: Point,
      focus: number,
      focusPoint: Point,
    ) =>
      selectionController.showPointerSelection(
        anchor,
        anchorPoint,
        focus,
        focusPoint,
      );
    handleEditingViewTransitionRef.current = () => {
      lastFieldPointerDown = null;
      pointerSelection = null;
      lineSelectionPointerId = null;
      lineSelectionRange = null;
      suppressLineSelectionCompatibilityEvents = false;
      if (lineSelectionRestoreFrame !== null) {
        window.cancelAnimationFrame(lineSelectionRestoreFrame);
        lineSelectionRestoreFrame = null;
      }
      if (lineSelectionClickResetTimer !== null) {
        window.clearTimeout(lineSelectionClickResetTimer);
        lineSelectionClickResetTimer = null;
      }
      selectionController.endPointerGeometry();
      clearPointerSelection();
      editorHistory?.clearPendingEdit();
      editorHistory?.finishGroup();
    };
    // MathLive arms a deferred re-focus of its keyboard sink on every focus of
    // the field and never rechecks whether focus should still be there, so a
    // control the writer reaches for inside that window has focus torn away
    // mid-keystroke and the keystroke is lost with it. Refusing the focus at
    // the sink stops the theft outright; restoring focus afterwards would
    // still blur the control and commit whatever half-typed value it held.
    const guardedSinks = new WeakSet<HTMLElement>();
    const guardKeyboardSink = () => {
      const sink = field.shadowRoot?.querySelector('.ML__keyboard-sink');
      if (!(sink instanceof HTMLElement) || guardedSinks.has(sink)) return;
      guardedSinks.add(sink);
      const focusSink = sink.focus.bind(sink);
      sink.focus = (options?: FocusOptions) => {
        if (writerHoldsAnotherControl(field)) return;
        focusSink(options);
      };
    };

    // Focus and caret placement wait for MathLive's shadow DOM to settle.
    const scheduleFocusCheck = () => {
      if (disposed || sourceViewRef.current) return;
      focusFrame = window.requestAnimationFrame(focusWhenReady);
    };
    resumeEditorReadinessRef.current = scheduleFocusCheck;
    // Opening the block is one request for focus, and every retry below only
    // delivers it again while the shadow DOM settles. That can take long enough
    // for the writer to reach a toolbar control first, so only the first
    // attempt records a request; later ones give way to the writer instead of
    // asking again on their behalf and taking the control back mid-keystroke.
    let focusRequestRecorded = false;
    const focusWhenReady = () => {
      if (disposed || sourceViewRef.current) return;
      if (focusRequestRecorded && writerHoldsAnotherControl(field)) return;
      if (!positionInitialized) {
        positionInitialized = true;
        field.position =
          initialLatex === ''
            ? 0
            : caretPoint !== null
              ? (selectionController.nearestOffsetAtPoint(caretPoint) ?? 0)
              : caretPosition === null
                ? field.lastOffset
                : fieldPositionFromHistory(caretPosition);
        constrainPositionToClickedLine();
        scheduleFocusCheck();
        return;
      }
      if (!field.selectionIsCollapsed && !preserveEarlyLineSelection) {
        const currentPosition = field.position;
        field.position = currentPosition;
      }
      guardKeyboardSink();
      focusRequestRecorded = true;
      focusDeliberately(field);
      const keyboardSink =
        field.shadowRoot?.querySelector('.ML__keyboard-sink');
      if (
        document.hasFocus() &&
        keyboardSink instanceof HTMLElement &&
        field.shadowRoot?.activeElement !== keyboardSink
      ) {
        focusDeliberately(keyboardSink, { preventScroll: true });
      }
      if (
        document.activeElement !== field ||
        !(keyboardSink instanceof HTMLElement) ||
        field.shadowRoot?.activeElement !== keyboardSink
      ) {
        scheduleFocusCheck();
        return;
      }
      const caret = field.shadowRoot?.querySelector(
        '.ML__caret, .ML__text-caret, .ML__latex-caret',
      );
      if (!(caret instanceof HTMLElement) && !preserveEarlyLineSelection) {
        scheduleFocusCheck();
        return;
      }
      if (requestedCaretPoint !== null) {
        if (!requestedCaretPointQueued) {
          requestedCaretPointQueued = true;
          scheduleFocusCheck();
          return;
        }
        const offset =
          requestedCaretOffset ?? nearestOffsetAtPoint(requestedCaretPoint);
        const base = field.shadowRoot?.querySelector('.ML__base');
        const suspiciousStart =
          offset === 0 &&
          base instanceof HTMLElement &&
          requestedCaretPoint.x > base.getBoundingClientRect().left + 5;
        if (
          offset === null ||
          (suspiciousStart && requestedCaretPointAttempts < 4)
        ) {
          requestedCaretPointAttempts += 1;
          scheduleFocusCheck();
          return;
        }
        field.position = offset;
        requestedCaretPoint = null;
        requestedCaretOffset = null;
      }
      if (!clickedPositionAdjusted && caretPoint !== null) {
        if (!clickedPositionQueued) {
          clickedPositionQueued = true;
        } else {
          clickedPositionAdjusted = true;
          selectionController.positionAtPoint(caretPoint);
        }
        scheduleFocusCheck();
        return;
      }
      const pendingEarlyInputs = earlyInputs.splice(0);
      if (pendingEarlyInputs.length > 0) {
        editorHistory?.markBeforeEdit(historyPosition());
      }
      let appliedStyle: {
        bold: boolean;
        color: string;
        italic: boolean;
      } | null = null;
      for (const entry of pendingEarlyInputs) {
        if (entry.mode !== activeInputMode) {
          activeInputMode = entry.mode;
          switchFieldMode(entry.mode);
        }
        if (entry.kind === 'paste') {
          replayPaste?.(entry.text);
          continue;
        }
        if (entry.key === 'Backspace') {
          field.executeCommand('deleteBackward');
          continue;
        }
        if (entry.key === 'Enter') {
          replayLineBreak?.();
          continue;
        }
        if (
          appliedStyle === null ||
          appliedStyle.bold !== entry.bold ||
          appliedStyle.color !== entry.color ||
          appliedStyle.italic !== entry.italic
        ) {
          field.applyStyle({
            ...(entry.color === initialBaseColorRef.current
              ? {}
              : { color: entry.color }),
            fontSeries: entry.bold ? 'b' : 'auto',
            fontShape: entry.italic ? 'it' : 'auto',
          });
          appliedStyle = entry;
        }
        if (activeInputMode === 'text') {
          field.insert(
            entry.key === '\\'
              ? MATHLIVE_LITERAL_BACKSLASH
              : entry.key === '$'
                ? MATHLIVE_LITERAL_DOLLAR
                : entry.key,
            { mode: 'text' },
          );
        } else if (entry.key !== ' ') {
          field.insert(entry.key, { mode: 'math' });
        }
      }
      if (pendingEarlyInputs.length > 0) {
        const replayedSource = source();
        recordEditorHistory(replayedSource);
        publishChange(replayedSource);
      }
      editorReady = true;
      preserveEarlyLineSelection = false;
      editorHistory?.clearPendingEdit();
      reportMode();
      reportTextStyle();
      onReadyRef.current();
    };
    // Mode and typing style are reported from the field after each transaction.
    const reportMode = () => {
      onModeChangeRef.current(activeInputMode);
    };
    const reportTextStyle = () => {
      if (activeInputMode !== 'text') return;
      activeRequestedTextStyle = {
        bold: field.queryStyle({ fontSeries: 'b' }) === 'all',
        italic: field.queryStyle({ fontShape: 'it' }) === 'all',
      };
      onTextStyleChangeRef.current(activeRequestedTextStyle);
    };
    const switchFieldMode = (mode: 'math' | 'text') => {
      const selection = field.selectionIsCollapsed ? null : field.selection;
      const position = field.position;
      if (selection !== null) field.position = position;
      field.executeCommand(['switchMode', mode]);
      if (selection === null) {
        field.position = Math.min(position, field.lastOffset);
      } else {
        field.selection = selection;
      }
    };
    const ensureActiveMode = () => {
      const changed =
        activeInputMode === 'math'
          ? field.mode === 'text'
          : field.mode !== 'text';
      if (changed) switchFieldMode(activeInputMode);
      if (activeInputMode === 'math') {
        if (changed) {
          emptyMathRegion = true;
          if (field.value.replaceAll('\\placeholder{}', '').trim() === '') {
            hasExplicitMath = true;
          }
        }
        if (mathSegments(field.value).length > 0) hasExplicitMath = true;
      }
    };
    const applyTypingColor = (color: string) => {
      typingColorValueRef.current = color;
      const selection = field.selectionIsCollapsed ? null : field.selection;
      if (selection !== null) {
        editorHistory?.markBeforeEdit(historyPosition());
      }
      field.applyStyle({ color });
      if (selection !== null) {
        field.selection = selection;
        selectionController.invalidateDocument();
        const coloredSource = source();
        recordEditorHistory(coloredSource);
        publishChange(coloredSource);
        const publishFinalizedColor = () => {
          if (disposed) return;
          selectionController.invalidateDocument();
          const finalizedColorSource = source();
          recordEditorHistory(finalizedColorSource);
          publishChange(finalizedColorSource);
        };
        window.queueMicrotask(publishFinalizedColor);
        window.setTimeout(publishFinalizedColor, 0);
      }
    };
    setTypingColorRef.current = applyTypingColor;
    const handleTypingColorRequest = (event: Event) => {
      const color = (event as CustomEvent<{ color?: unknown }>).detail?.color;
      if (typeof color === 'string') applyTypingColor(color);
    };
    const handleTextStyleRequest = (event: Event) => {
      const detail = (
        event as CustomEvent<{ enabled?: unknown; style?: unknown }>
      ).detail;
      if (
        typeof detail?.enabled !== 'boolean' ||
        (detail.style !== 'regular' &&
          detail.style !== 'bold' &&
          detail.style !== 'italic')
      ) {
        return;
      }
      editorHistory?.markBeforeEdit(historyPosition());
      if (detail.style === 'regular') {
        activeRequestedTextStyle = { bold: false, italic: false };
        field.applyStyle({ fontSeries: 'auto', fontShape: 'auto' });
      } else if (detail.style === 'bold') {
        activeRequestedTextStyle = {
          ...activeRequestedTextStyle,
          bold: detail.enabled,
        };
        field.applyStyle({ fontSeries: detail.enabled ? 'b' : 'auto' });
      } else {
        activeRequestedTextStyle = {
          ...activeRequestedTextStyle,
          italic: detail.enabled,
        };
        field.applyStyle({ fontShape: detail.enabled ? 'it' : 'auto' });
      }
      const styledSource = source();
      recordEditorHistory(styledSource);
      reportMode();
      reportTextStyle();
      publishChange(styledSource);
      // Firefox can apply MathLive selection styles after the custom toolbar
      // event returns. Publish once more at the microtask boundary so a fast
      // commit cannot persist the pre-style source.
      window.queueMicrotask(() => {
        if (disposed) return;
        const finalizedStyleSource = source();
        recordEditorHistory(finalizedStyleSource);
        reportTextStyle();
        publishChange(finalizedStyleSource);
      });
    };
    const decorateSpecialText = () => {
      reportMode();
      field.shadowRoot?.querySelectorAll('.ML__text').forEach((element) => {
        element.classList.toggle(
          'mixed-text-line-break',
          element.textContent === MATHLIVE_LINE_BREAK,
        );
        element.classList.toggle(
          'mixed-text-literal-dollar',
          element.textContent === MATHLIVE_LITERAL_DOLLAR ||
            element.textContent === MATHLIVE_BARE_DOLLAR,
        );
        element.classList.toggle(
          'mixed-text-literal-backslash',
          element.textContent === MATHLIVE_LITERAL_BACKSLASH,
        );
        element.classList.toggle(
          'mixed-text-literal-brace-left',
          element.textContent === MATHLIVE_LITERAL_BRACE_LEFT,
        );
        element.classList.toggle(
          'mixed-text-literal-brace-right',
          element.textContent === MATHLIVE_LITERAL_BRACE_RIGHT,
        );
        element.classList.toggle(
          'mixed-text-literal-percent',
          element.textContent === MATHLIVE_LITERAL_PERCENT,
        );
        element.classList.toggle(
          'mixed-text-color-marker',
          isTextColorMarker(element.textContent ?? ''),
        );
        element.classList.toggle(
          'mixed-text-style-marker',
          isTextStyleMarker(element.textContent ?? ''),
        );
      });
      if (field.shadowRoot !== null) {
        const shadowRoot = field.shadowRoot;
        shadowRoot
          .querySelectorAll('.mixed-text-terminal-placeholder')
          .forEach((element) =>
            element.classList.remove('mixed-text-terminal-placeholder'),
          );
        if (terminalPlaceholderBreak() !== null) {
          const finalBreak = [
            ...shadowRoot.querySelectorAll('.mixed-text-line-break'),
          ].at(-1);
          let terminalAtom = finalBreak?.nextElementSibling ?? null;
          while (terminalAtom !== null && terminalAtom.textContent === '') {
            terminalAtom = terminalAtom.nextElementSibling;
          }
          // MathLive renders its internal placeholder as U+25A2. Tag only the
          // atom immediately after the final line-break sentinel; placeholders
          // inside user commands must retain their ordinary presentation.
          if (terminalAtom?.textContent === '\u25a2') {
            terminalAtom.classList.add('mixed-text-terminal-placeholder');
          }
        }
        decorateExcalifontLayout(shadowRoot);
        // Last, so the break spans already carry their class and the corrected
        // glyph geometry is what gets measured.
        applyLineClearance(shadowRoot, zoomRef.current);
      }
    };
    const restoreExpandedTextStyles = () => {
      const selection = field.selection;
      const lastOffset = field.lastOffset;
      // Only a sentinel can start or end a styled run, so ask for the sentinel
      // offsets once. Reading every offset instead is quadratic in block
      // length, because `getValue` walks the atom tree for each range it is
      // given, and this runs for every document the editor is handed.
      const boundaries = [
        ...new Set([
          ...selectionController.invisibleFormattingMarkerOffsets(),
          lastOffset,
        ]),
      ].sort((left, right) => left - right);
      const baseColor = initialBaseColorRef.current;
      let bold = false;
      let italic = false;
      let color = baseColor;
      let runStart = 0;
      restoringTextStyles = true;
      try {
        for (const offset of boundaries) {
          const value =
            offset < lastOffset ? field.getValue([offset, offset + 1]) : '';
          // A color marker ends a run exactly as a bold or italic one does.
          // Skipping them left every colored run merged into its neighbour and
          // restored without its color, so reopening a block showed the writing
          // in the block's own color and losing it looked like the color had
          // been discarded.
          const markerColor = textColorForMarker(value);
          if (
            offset < lastOffset &&
            markerColor === undefined &&
            !isTextStyleMarker(value)
          ) {
            continue;
          }
          if (offset > runStart && (bold || italic || color !== baseColor)) {
            field.selection = {
              direction: 'none',
              ranges: [[runStart, offset]],
            };
            field.applyStyle({
              ...(color === baseColor ? {} : { color }),
              ...(bold ? { fontSeries: 'b' as const } : {}),
              ...(italic ? { fontShape: 'it' as const } : {}),
            });
            pendingStyleInputs += 1;
          }
          if (markerColor !== undefined) color = markerColor;
          else if (value === MATHLIVE_BOLD_ON) bold = true;
          else if (value === MATHLIVE_BOLD_OFF) bold = false;
          else if (value === MATHLIVE_ITALIC_ON) italic = true;
          else if (value === MATHLIVE_ITALIC_OFF) italic = false;
          runStart = offset + 1;
        }
      } finally {
        field.selection = selection;
        restoringTextStyles = false;
        // MathLive delivers each `applyStyle`'s `input` event on a later task,
        // so clearing the guard here never caught any of them: a block with
        // nineteen styled runs answered nineteen input events by serializing
        // the whole document, recording history, and publishing a change that
        // came from the source just applied rather than from the writer. Count
        // them off instead, and stop counting on the next task so a real edit
        // can never be swallowed.
        if (pendingStyleInputs > 0) {
          window.setTimeout(() => {
            pendingStyleInputs = 0;
          }, 0);
        }
      }
    };
    const scheduleLineBreakDecoration = () => {
      window.requestAnimationFrame(() => {
        if (!disposed) decorateSpecialText();
      });
    };
    // Replacing the document must synchronize MathLive's root mode as well as
    // the parser mode. `setValue(..., { mode })` controls how the new source is
    // parsed, but does not change `defaultMode`, which owns the root atom and
    // therefore the parent context of later caret movement and insertion.
    const replaceFieldDocument = (value: string, mode: 'math' | 'text') => {
      field.setValue('', {
        mode,
        silenceNotifications: true,
      });
      field.defaultMode = mode;
      field.executeCommand(['switchMode', mode]);
      field.setValue(value, {
        mode,
        silenceNotifications: true,
      });
      selectionController.invalidateDocument();
      sourceCaretSynchronization.invalidate();
      restoreExpandedTextStyles();
    };
    const handleMount = () => {
      if (mounted) return;
      mounted = true;
      guardKeyboardSink();
      field.registers.arraystretch = mathArrayStretch(spacingRef.current);
      replaceFieldDocument(initialDocument.value, initialDocument.defaultMode);
      renderedEntrySourceRef.current = source();
      const initialHistorySnapshot = {
        actorId: historyActorIdRef.current,
        hasExplicitMath,
        position: historyPosition(),
        retainsMathOnlySource,
        source: initialLatex,
      };
      editorHistory =
        initialHistorySessionRef.current ??
        new MixedEditorHistory(initialHistorySnapshot);
      if (initialHistorySessionRef.current !== undefined) {
        editorHistory.resume(initialHistorySnapshot, mergeEquationSourceEdit);
      }
      onHistorySessionRef.current(editorHistory);
      reportEditorHistoryAvailability();
      ensureActiveMode();
      if (
        initialLatex === '' &&
        activeInputMode === 'text' &&
        (initialTextStyleRef.current.bold || initialTextStyleRef.current.italic)
      ) {
        field.applyStyle({
          ...(initialTextStyleRef.current.bold
            ? { fontSeries: 'b' as const }
            : {}),
          ...(initialTextStyleRef.current.italic
            ? { fontShape: 'it' as const }
            : {}),
        });
      }
      if (typingColorValueRef.current !== initialBaseColorRef.current) {
        applyTypingColor(typingColorValueRef.current);
      }
      field.menuItems = [];
      field.shadowRoot?.append(caretStyle);
      if (field.shadowRoot !== null) {
        lineBreakObserver = new MutationObserver(decorateSpecialText);
        lineBreakObserver.observe(field.shadowRoot, {
          characterData: true,
          childList: true,
          subtree: true,
        });
      }
      decorateSpecialText();
      scheduleLineBreakDecoration();
      if (initialLatex === '') {
        positionInitialized = true;
        field.position = 0;
        scheduleFocusCheck();
        void waitForWorkspaceFonts().catch(() => {
          // Empty fields remain editable with the browser's fallback font.
        });
        return;
      }
      void waitForWorkspaceFonts()
        .catch(() => {
          // Continue focus and measurement with the browser's fallback font.
        })
        .then(() => {
          if (disposed) return;
          scheduleFocusCheck();
          window.requestAnimationFrame(() => {
            if (disposed) return;
            const [width, height] = dimensions();
            onPersistRef.current(source(), width, height);
          });
        });
    };
    // Canonical source and measured dimensions form one publication snapshot.
    const dimensions = () =>
      [
        Math.max(24, field.offsetWidth),
        Math.max(28, field.offsetHeight),
      ] as const;
    const source = () => {
      const options = {
        baseColor: initialBaseColorRef.current,
        emptyMathRegion,
        hasExplicitMath,
        mode: field.mode,
        retainsMathOnlySource,
      };
      return mixedSourceFromMathLiveEditor(field.value, options);
    };
    const selectionController = new EditorSelectionController({
      elementId: element.id,
      field,
      getSource: source,
      selectionOverlay,
    });
    const remeasureForFont = () => {
      field.dataset.workspaceFont = getWorkspaceFontChoice();
      if (fontMeasureFrame !== null) {
        window.cancelAnimationFrame(fontMeasureFrame);
      }
      fontMeasureFrame = window.requestAnimationFrame(() => {
        if (disposed) return;
        const [width, height] = dimensions();
        onPersistRef.current(source(), width, height);
      });
    };
    // Source view is a raw text editor. Parsing a half-typed string on every
    // keystroke is what made it unpredictable: an unbalanced `$` reinterprets
    // the rest of the block as math, `expandTextColors` then injects markers
    // against that reading, and the whole document is rebuilt through
    // `setValue` before the next character arrives. Raw text is therefore held
    // aside untouched and parsed once, on the way back to the rendered view.
    const applyParsedSource = (nextSource: string) => {
      const currentSource = source();
      // MathLive can paint a local keystroke before delivering its input event.
      // Capture unknown current state before rebasing a genuinely new remote
      // value. Concurrent model notifications can transiently revisit a known
      // undo snapshot; applying it may update presentation, but must not
      // destructively rebase every local history entry to that stale value.
      editorHistory?.reconcileExternal(
        {
          hasExplicitMath,
          position: historyPosition(),
          retainsMathOnlySource,
          source: currentSource,
        },
        nextSource,
        mergeEquationSourceEdit,
      );
      const wasAtEnd = field.position === field.lastOffset;
      const previousPosition = field.position;
      const expandedSource = expandTextStyles(
        expandTextColors(nextSource, initialBaseColorRef.current),
      );
      const nextDocument = materializeMathLiveEditorDocument(
        expandedSource,
        activeInputMode,
      );
      hasExplicitMath = nextDocument.hasExplicitMath;
      retainsMathOnlySource = nextDocument.retainsMathOnlySource;
      // Reconciliation has already rebased every retained local snapshot over
      // this accepted remote source. Adding the peer value as a history entry
      // here would put another actor on top and make the owner's selective undo
      // a no-op even though the peer input is present in every rebased snapshot.
      reportEditorHistoryAvailability();
      lineBreakCaretAffinity = null;
      applyingExternalSource = true;
      try {
        replaceFieldDocument(nextDocument.value, nextDocument.defaultMode);
      } finally {
        applyingExternalSource = false;
      }
      field.position = wasAtEnd
        ? field.lastOffset
        : Math.min(previousPosition, field.lastOffset);
      emptyMathRegion = isEmptyMathRegion();
      ensureActiveMode();
      decorateSpecialText();
      scheduleLineBreakDecoration();
      renderedEntrySourceRef.current = source();
      renderedViewEditedRef.current = false;
      publicationController.synchronizeSource(nextSource);
    };
    applyExternalSourceRef.current = (nextSource) => {
      const externalActorId = pendingExternalHistoryActor;
      pendingExternalHistoryActor = null;
      if (sourceViewRef.current) {
        // Keep history and persistence on the exact characters typed, without
        // interpreting them. Measurement stays as it was: the rendered block
        // must not resize under a source that has not been parsed yet.
        if (publicationController.source === nextSource) return;
        const localEdit = localSourceEditPending;
        localSourceEditPending = false;
        // React can render an earlier local publication after the textarea has
        // already published a later one. Only an explicitly tagged external
        // source may move the editor backwards.
        if (!localEdit && externalActorId === null) return;
        const previousSource = publicationController.source;
        publicationController.synchronizeSource(nextSource);
        const snapshot = {
          actorId: localEdit
            ? historyActorIdRef.current
            : (externalActorId ?? historyActorIdRef.current),
          hasExplicitMath: mathSegments(nextSource).length > 0,
          position: sourceHistoryPosition,
          positionDomain: 'source' as const,
          retainsMathOnlySource: isMathOnlyMixedSource(nextSource),
          source: nextSource,
        };
        if (localEdit) {
          editorHistory?.markBeforeEdit(sourceHistoryPosition);
          editorHistory?.record(snapshot);
        } else {
          editorHistory?.reconcileExternal(
            { ...snapshot, source: previousSource },
            nextSource,
            mergeEquationSourceEdit,
          );
        }
        reportEditorHistoryAvailability();
        return;
      }
      const sourceProjection = publicationController.classifySourceProjection(
        nextSource,
        source(),
        externalActorId !== null,
      );
      if (sourceProjection === 'ignore') return;
      if (sourceProjection === 'synchronize') {
        publicationController.synchronizeSource(nextSource);
        return;
      }
      applyParsedSource(nextSource);
    };
    applyPendingRawSourceRef.current = () => {
      const nextSource = latestElementSourceRef.current;
      if (source() === nextSource) return;
      editorHistory?.record({
        actorId: historyActorIdRef.current,
        hasExplicitMath: mathSegments(nextSource).length > 0,
        position: sourceHistoryPosition,
        positionDomain: 'source',
        retainsMathOnlySource: isMathOnlyMixedSource(nextSource),
        source: nextSource,
      });
      reportEditorHistoryAvailability();
      try {
        applyParsedSource(nextSource);
      } catch (error) {
        // The text the user wrote is the thing worth keeping. Leave it exactly
        // as typed, published and persisted, and say that only the rendering
        // failed rather than replacing the source with whatever partial state
        // the parse reached.
        publicationController.synchronizeSource(nextSource);
        onSourceRenderErrorRef.current(
          error instanceof Error ? error.message : String(error),
        );
      }
    };
    // Commit, persistence, and history all consume the same stable source.
    const stableSource = () =>
      publicationController.stableSource({
        currentSource: source(),
        renderedEntrySource: renderedEntrySourceRef.current,
        renderedViewEdited: renderedViewEditedRef.current,
        sourceView: sourceViewRef.current,
      });
    const commit = () => {
      finalizePendingInput();
      const [width, height] = dimensions();
      onCommitRef.current(stableSource(), width, height);
    };
    const persist = () => {
      finalizePendingInput();
      const [width, height] = dimensions();
      onPersistRef.current(stableSource(), width, height);
    };
    const isEmptyMathRegion = () => {
      if (field.mode !== 'math') return false;
      const value = field.value.trim();
      if (value === '' || value === '\\placeholder{}') return true;
      const math = mathSegments(value);
      return (
        math.length === 1 &&
        isMathOnlyMixedSource(value) &&
        math[0]?.latex.trim() === '\\placeholder{}'
      );
    };
    const macroCommandCompletion = (command: string) =>
      commandController.macroCommandCompletion(command);
    const renderBufferedArgument = () => {
      if (bufferedCommandState === null) return;
      const argumentMode =
        bufferedCommandState.completion.argumentModes[
          bufferedCommandState.argumentIndex
        ];
      const escapedPreview = bufferedCommandState.argument
        .replaceAll('\\', '\\backslash ')
        .replaceAll('{', '\\{')
        .replaceAll('}', '\\}')
        .replaceAll('$', '\\$')
        .replaceAll('#', '\\#')
        .replaceAll('%', '\\%')
        .replaceAll('&', '\\&');
      const preview =
        bufferedCommandState.argument === ''
          ? '\\placeholder{}'
          : argumentMode === 'math'
            ? bufferedCommandState.argument
            : `\\mathrm{${escapedPreview}}`;
      field.insert(preview, {
        focus: true,
        format: 'latex',
        insertionMode: 'replaceSelection',
        mode: 'math',
        selectionMode: 'item',
        silenceNotifications: true,
      });
    };
    const finishBufferedArgument = (action: 'advance' | 'complete') => {
      if (bufferedCommandState === null) return;
      bufferedCommandState.arguments[bufferedCommandState.argumentIndex] =
        bufferedCommandState.argument;
      const hasNextArgument =
        bufferedCommandState.argumentIndex + 1 <
        bufferedCommandState.completion.argumentModes.length;
      if (action === 'advance' && hasNextArgument) {
        bufferedCommandState.argumentIndex += 1;
        bufferedCommandState.argument = '';
        renderBufferedArgument();
        return;
      }
      const completedArguments =
        bufferedCommandState.completion.argumentModes.map(
          (_, index) => bufferedCommandState?.arguments[index] ?? '',
        );
      const latex = fillBufferedCommandCompletion(
        bufferedCommandState.completion.template,
        completedArguments,
      );
      bufferedCommandState = null;
      field.insert(latex, {
        focus: true,
        format: 'latex',
        insertionMode: 'replaceSelection',
        mode: 'math',
        selectionMode: 'after',
      });
      editorHistory?.finishGroup();
    };
    const activeLatexCommand = () => commandController.activeLatexCommand();
    const restoreLatexCommandStartPosition = () => {
      const anchor = commandController.restoreTransactionStartPosition();
      if (anchor === 0) {
        switchFieldMode('text');
        field.position = 0;
      }
      return anchor;
    };
    const repairEmptyCommandArguments = () => {
      commandController.unselectableCompletion = unselectableCommandCompletion;
      const repaired = commandController.repairEmptyArguments();
      unselectableCommandCompletion = commandController.unselectableCompletion;
      return repaired;
    };
    const publishChange = (nextSource = source()) => {
      if (!sourceViewRef.current) renderedViewEditedRef.current = true;
      reportMode();
      scheduleLineBreakDecoration();
      const [width, height] = dimensions();
      if (!publicationController.accept(nextSource, width, height)) return;
      onChangeRef.current(nextSource, width, height);
    };
    const recordEditorHistory = (nextSource = source()) => {
      editorHistory?.record({
        actorId: historyActorIdRef.current,
        hasExplicitMath,
        position: historyPosition(),
        retainsMathOnlySource,
        source: nextSource,
      });
      reportEditorHistoryAvailability();
    };
    const restoreEditorHistory = (direction: -1 | 1) => {
      const restoration = editorHistory?.step(
        direction,
        historyActorIdRef.current,
      );
      if (restoration === null || restoration === undefined) return;
      reportEditorHistoryAvailability();
      const { position: restoredPosition, snapshot } = restoration;
      retainsMathOnlySource = snapshot.retainsMathOnlySource;
      hasExplicitMath = snapshot.hasExplicitMath;
      lineBreakCaretAffinity = null;
      if (sourceViewRef.current) {
        const sourcePosition = Math.max(
          0,
          Math.min(restoredPosition, snapshot.source.length),
        );
        sourceHistoryPosition = sourcePosition;
        publishChange(snapshot.source);
        onCaretChangeRef.current(sourcePosition);
        window.requestAnimationFrame(() => {
          if (disposed || !sourceViewRef.current) return;
          const textarea = document.querySelector<HTMLTextAreaElement>(
            'textarea[aria-label="Block source"]:not([hidden])',
          );
          textarea?.focus({ preventScroll: true });
          textarea?.setSelectionRange(sourcePosition, sourcePosition);
        });
        return;
      }
      const expandedSnapshotSource = expandTextStyles(
        expandTextColors(snapshot.source, initialBaseColorRef.current),
      );
      const restoredDocument = materializeMathLiveEditorDocument(
        expandedSnapshotSource,
        activeInputMode,
      );
      replaceFieldDocument(
        restoredDocument.value,
        restoredDocument.defaultMode,
      );
      // Restore the global input mode at the root before moving into the
      // snapshot. Switching modes before the restored formula, or from a
      // caret nested inside it, can make MathLive reinterpret the surrounding
      // LaTeX as literal text.
      field.position = field.lastOffset;
      ensureActiveMode();
      field.position =
        snapshot.positionDomain === 'source'
          ? sourceCaretSynchronization.fieldOffsetForSource(
              restoredPosition,
              snapshot.source,
            )
          : fieldPositionFromHistory(restoredPosition);
      guardKeyboardSink();
      focusDeliberately(field, { preventScroll: true });
      const keyboardSink =
        field.shadowRoot?.querySelector('.ML__keyboard-sink');
      if (keyboardSink instanceof HTMLElement) {
        focusDeliberately(keyboardSink, { preventScroll: true });
      }
      scheduleFocusCheck();
      emptyMathRegion = isEmptyMathRegion();
      clearPointerSelection();
      decorateSpecialText();
      publishChange(snapshot.source);
    };
    const requestEditorHistory = (direction: -1 | 1) => {
      if (direction < 0) recordEditorHistory(publicationController.source);
      restoreEditorHistory(direction);
    };
    const handleHistoryExternalActor = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const actorId = (event.detail as { actorId?: unknown }).actorId;
      if (typeof actorId === 'string' && actorId.length > 0) {
        pendingExternalHistoryActor = actorId;
      }
    };
    const handleHistoryRequest = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const direction = (event.detail as { direction?: unknown }).direction;
      if (direction === -1 || direction === 1) {
        window.setTimeout(() => requestEditorHistory(direction), 0);
      }
    };
    // Browser input events publish semantic edits; keyboard-sink events do not.
    const handleBeforeInput = (event: Event) => {
      if (!editorReady) return;
      const inputType = event instanceof InputEvent ? event.inputType : '';
      if (inputType !== 'historyUndo' && inputType !== 'historyRedo') {
        editorHistory?.markBeforeEdit(historyPosition());
      }
    };
    const handleCompositionStart = () => {
      if (!editorReady) return;
      consumeLineBreakCaretAffinity();
      editorHistory?.markBeforeEdit(historyPosition());
      ensureActiveMode();
      if (activeInputMode === 'text') {
        field.applyStyle({
          ...(typingColorValueRef.current === initialBaseColorRef.current
            ? {}
            : { color: typingColorValueRef.current }),
          fontSeries: activeRequestedTextStyle.bold ? 'b' : 'auto',
          fontShape: activeRequestedTextStyle.italic ? 'it' : 'auto',
        });
      }
    };
    const handleCompositionEnd = () => {
      if (!editorReady) return;
      selectionController.invalidateDocument();
      ensureActiveMode();
      const composedSource = source();
      recordEditorHistory(composedSource);
      publishChange(composedSource);
    };
    const handleInput = (event: Event) => {
      // Ignore MathLive's keyboard-sink event and accept its host transaction.
      // Once source view owns the draft, delayed events from this hidden inert
      // field belong to the preceding rendered transaction and must not rewrite
      // the canonical textarea with MathLive's internal sentinel spelling.
      if (
        event.composedPath()[0] !== field ||
        applyingExternalSource ||
        sourceViewRef.current
      ) {
        return;
      }
      scheduleCommandEntryPresentation();
      clearPointerSelection();
      if (restoringTextStyles) return;
      if (pendingStyleInputs > 0) {
        pendingStyleInputs -= 1;
        return;
      }
      const preservesEmptyMath = preserveMathAfterDeletion;
      preserveMathAfterDeletion = false;
      ensureActiveMode();
      emptyMathRegion =
        activeInputMode === 'math' &&
        (preservesEmptyMath || isEmptyMathRegion());
      const nextSource = source();
      recordEditorHistory(nextSource);
      publishChange(nextSource);
    };
    finalizePendingInput = () => {
      if (sourceViewRef.current) return;
      const hasPendingInput =
        bufferedCommandState !== null ||
        commandCompletionPending ||
        deferredCommandTemplate !== null ||
        field.mode === 'latex';
      if (!hasPendingInput) return;
      finishBufferedArgument('complete');
      if (field.mode === 'latex') {
        field.executeCommand(['complete', 'accept-all']);
      }
      if (deferredCommandTemplate !== null) {
        field.insert(
          fillDeferredCommandCompletion(deferredCommandTemplate, ''),
          {
            focus: true,
            format: 'latex',
            insertionMode: 'replaceSelection',
            mode: 'math',
            selectionMode: 'after',
          },
        );
      }
      repairEmptyCommandArguments();
      commandCompletionPending = false;
      deferredCommandTemplate = null;
      unselectableCommandCompletion = null;
      latexCommandTransaction.clear();
      editorHistory?.finishGroup();
      selectionController.invalidateDocument();
      const finalizedSource = source();
      recordEditorHistory(finalizedSource);
      publishChange(finalizedSource);
    };
    // Pointer ownership decides selection, caret placement, and session commit.
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const path = event.composedPath();
      if (path.includes(field)) return;
      const keepsEditorOpen = path.some(
        (target) =>
          target instanceof Element &&
          (target.matches('[data-keep-math-editor-open]') ||
            target.matches('math-virtual-keyboard, .ML__keyboard')),
      );
      if (keepsEditorOpen) return;
      finishBufferedArgument('complete');
      finishing = true;
      if (needsDisconnectBlur) field.blur();
      flushSync(commit);
    };
    const handleBlur = () => {
      if (blurTimer !== null) window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => {
        blurTimer = null;
        const activeElement = document.activeElement;
        const styleControlHasFocus =
          activeElement instanceof Element &&
          activeElement.closest('[data-keep-math-editor-open]') !== null;
        if (
          editorReady &&
          !finishing &&
          !viewTransitionRef.current &&
          document.hasFocus() &&
          activeElement !== field &&
          !styleControlHasFocus &&
          !window.mathVirtualKeyboard.visible
        ) {
          finishBufferedArgument('complete');
          flushSync(commit);
        }
      }, 100);
    };
    const handleFieldPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !editorReady) return;
      lineBreakCaretAffinity = null;
      if (lineSelectionRestoreFrame !== null) {
        window.cancelAnimationFrame(lineSelectionRestoreFrame);
        lineSelectionRestoreFrame = null;
      }
      if (lineSelectionClickResetTimer !== null) {
        window.clearTimeout(lineSelectionClickResetTimer);
        lineSelectionClickResetTimer = null;
      }
      suppressLineSelectionCompatibilityEvents = false;
      lineSelectionRange = null;
      finishBufferedArgument('complete');
      event.preventDefault();
      event.stopImmediatePropagation();
      verticalColumn = null;
      commandCompletionPending = false;
      latexCommandTransaction.clear();
      deferredCommandTemplate = null;
      unselectableCommandCompletion = null;
      editorHistory?.finishGroup();
      const anchorPoint = { x: event.clientX, y: event.clientY };
      // A second press in the same place takes the whole line. MathLive's own
      // double-click is never seen here - this handler consumes the press
      // before it reaches the field - and the compatibility `dblclick` event
      // never arrives either, because preventing a pointerdown suppresses it.
      // So the repeat is recognised from the presses themselves.
      const previousPress = lastFieldPointerDown;
      lastFieldPointerDown = {
        time: event.timeStamp,
        x: event.clientX,
        y: event.clientY,
      };
      const repeatedPress =
        previousPress !== null &&
        event.timeStamp - previousPress.time <= DOUBLE_PRESS_MILLISECONDS &&
        Math.abs(event.clientX - previousPress.x) <= DOUBLE_PRESS_SLOP &&
        Math.abs(event.clientY - previousPress.y) <= DOUBLE_PRESS_SLOP;
      if (repeatedPress) {
        const line = selectionController.lineRangeAtPoint(anchorPoint);
        if (line !== null && line.end > line.start) {
          // No drag opens from this press: the line is the selection, and a
          // move afterwards would otherwise redraw it from the anchor.
          pointerSelection = null;
          lineSelectionPointerId = event.pointerId;
          lineSelectionRange = line;
          suppressLineSelectionCompatibilityEvents = true;
          selectionController.endPointerGeometry();
          field.selection = {
            direction: 'forward',
            ranges: [[line.start, line.end]],
          };
          // Capture the matching release too. Letting that one event through
          // gives MathLive the completed second press and it replaces our line
          // range with its own single-symbol double-click selection.
          field.setPointerCapture(event.pointerId);
          focusDeliberately(field);
          reportMode();
          return;
        }
      }
      // Snapshot geometry while the selection is still collapsed; MathLive
      // reports displaced rects for atoms it re-renders as selected.
      selectionController.beginPointerGeometry();
      const offset = nearestOffsetAtPoint(anchorPoint);
      if (offset !== null) {
        clearPointerSelection();
        field.position = offset;
        ensureActiveMode();
        pointerSelection = {
          anchor: field.position,
          anchorPoint,
          pointerId: event.pointerId,
        };
        field.setPointerCapture(event.pointerId);
      }
      focusDeliberately(field);
      if (offset !== null) {
        window.requestAnimationFrame(() => {
          if (
            field.isConnected &&
            field.selectionIsCollapsed &&
            field.position !== offset
          ) {
            field.position = offset;
          }
        });
      }
      reportMode();
    };
    const handleFieldCompatibilityClick = (event: MouseEvent) => {
      if (suppressLineSelectionCompatibilityEvents) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      // A re-entered field can be focused and visible for a frame before the
      // readiness loop completes. Pointer presses deliberately pass through in
      // that interval, but Chromium still sends the resulting native dblclick.
      // Claim it here so MathLive cannot replace the intended row with the one
      // symbol under the pointer.
      if (event.type !== 'dblclick' || event.button !== 0) return;
      const line = selectionController.lineRangeAtPoint({
        x: event.clientX,
        y: event.clientY,
      });
      if (line === null || line.end <= line.start) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      lastFieldPointerDown = null;
      preserveEarlyLineSelection = !editorReady;
      if (preserveEarlyLineSelection) {
        requestedCaretPoint = null;
        requestedCaretOffset = null;
        clickedPositionAdjusted = true;
      }
      field.selection = {
        direction: 'forward',
        ranges: [[line.start, line.end]],
      };
      if (lineSelectionRestoreFrame !== null) {
        window.cancelAnimationFrame(lineSelectionRestoreFrame);
      }
      lineSelectionRestoreFrame = window.requestAnimationFrame(() => {
        lineSelectionRestoreFrame = null;
        if (!field.isConnected) return;
        field.selection = {
          direction: 'forward',
          ranges: [[line.start, line.end]],
        };
      });
      focusDeliberately(field);
      reportMode();
    };
    const handleFieldPointerMove = (event: PointerEvent) => {
      if (lineSelectionPointerId === event.pointerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (
        pointerSelection === null ||
        pointerSelection.pointerId !== event.pointerId
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const offset = selectionController.offsetAtPoint({
        x: event.clientX,
        y: event.clientY,
      });
      if (offset === null) return;
      const { anchor, anchorPoint } = pointerSelection;
      field.selection = {
        direction: offset < anchor ? 'backward' : 'forward',
        ranges: [[Math.min(anchor, offset), Math.max(anchor, offset)]],
      };
      showPointerSelection(anchor, anchorPoint, offset, {
        x: event.clientX,
        y: event.clientY,
      });
    };
    const finishFieldPointerSelection = (event: PointerEvent) => {
      // Released unconditionally: a pointer-down that resolved no offset never
      // opens a selection, and leaving the snapshot in place would freeze stale
      // geometry into every later click.
      selectionController.endPointerGeometry();
      if (lineSelectionPointerId === event.pointerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        lineSelectionPointerId = null;
        const selectedLine = lineSelectionRange;
        lineSelectionRange = null;
        scheduleLineBreakDecoration();
        reportMode();
        reportTextStyle();
        if (field.hasPointerCapture(event.pointerId)) {
          field.releasePointerCapture(event.pointerId);
        }
        // The browser dispatches compatibility click/dblclick events after the
        // pointer release. MathLive handles those even though it never saw the
        // pointerdown, collapsing this range back to the symbol under the
        // pointer. Reapply once after that event sequence, before next paint.
        if (selectedLine !== null) {
          lineSelectionRestoreFrame = window.requestAnimationFrame(() => {
            lineSelectionRestoreFrame = null;
            if (!field.isConnected) return;
            field.selection = {
              direction: 'forward',
              ranges: [[selectedLine.start, selectedLine.end]],
            };
          });
        }
        // `click` and `dblclick` are dispatched after pointerup in this same
        // event turn. Keep them suppressed through that turn, then stop before
        // a later deliberate click can be mistaken for part of this gesture.
        lineSelectionClickResetTimer = window.setTimeout(() => {
          lineSelectionClickResetTimer = null;
          suppressLineSelectionCompatibilityEvents = false;
        }, 0);
        return;
      }
      if (
        pointerSelection === null ||
        pointerSelection.pointerId !== event.pointerId
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      pointerSelection = null;
      scheduleLineBreakDecoration();
      reportMode();
      reportTextStyle();
      if (field.hasPointerCapture(event.pointerId)) {
        field.releasePointerCapture(event.pointerId);
      }
    };
    // Clipboard conversion crosses MathLive offsets and canonical mixed source.
    const handleCopy = (event: ClipboardEvent) => {
      if (field.selectionIsCollapsed || event.clipboardData === null) return;
      const clipboardValue = clipboardTextFromMathLiveSelection(
        field.getValue(field.selection),
      );
      event.preventDefault();
      event.stopImmediatePropagation();
      event.clipboardData.setData('text/plain', clipboardValue);
    };
    const handleCut = (event: ClipboardEvent) => {
      if (field.selectionIsCollapsed || event.clipboardData === null) return;
      const clipboardValue = clipboardTextFromMathLiveSelection(
        field.getValue(field.selection),
      );
      event.preventDefault();
      event.stopImmediatePropagation();
      event.clipboardData.setData('text/plain', clipboardValue);
      editorHistory?.markBeforeEdit(historyPosition());
      field.insert('', {
        insertionMode: 'replaceSelection',
        mode: activeInputMode,
        selectionMode: 'after',
      });
      selectionController.invalidateDocument();
      clearPointerSelection();
      ensureActiveMode();
      emptyMathRegion = isEmptyMathRegion();
      const sourceAfterCut = source();
      recordEditorHistory(sourceAfterCut);
      publishChange(sourceAfterCut);
      scheduleLineBreakDecoration();
      reportMode();
      reportTextStyle();
    };
    const insertClipboardText = (text: string) => {
      const prepared = editorClipboardInsertions(text, activeInputMode);
      if (prepared.multiline) retainsMathOnlySource = false;
      prepared.insertions.forEach(({ lineBreakBefore, value }) => {
        if (lineBreakBefore) {
          field.insert(MATHLIVE_LINE_BREAK, {
            insertionMode: 'replaceSelection',
            mode: 'text',
            selectionMode: 'after',
          });
          ensureActiveMode();
        }
        if (value === '') return;
        field.insert(value, {
          ...(activeInputMode === 'math' ? { format: 'latex' as const } : {}),
          insertionMode: 'replaceSelection',
          mode: activeInputMode,
          selectionMode: 'after',
        });
      });
      selectionController.invalidateDocument();
      ensureActiveMode();
      emptyMathRegion = isEmptyMathRegion();
      const sourceAfterPaste = source();
      recordEditorHistory(sourceAfterPaste);
      publishChange(sourceAfterPaste);
      scheduleLineBreakDecoration();
      reportMode();
    };
    replayPaste = insertClipboardText;
    const handlePaste = (event: ClipboardEvent) => {
      const clipboard = event.clipboardData;
      if (clipboard === null) return;
      const text = clipboard.getData('text/plain');

      event.preventDefault();
      event.stopImmediatePropagation();
      if (!editorReady) {
        earlyInputs.push({
          kind: 'paste',
          mode: activeInputMode,
          text,
        });
        return;
      }
      consumeLineBreakCaretAffinity();
      editorHistory?.markBeforeEdit(historyPosition());
      insertClipboardText(text);
    };
    const enterMath = () => {
      activeInputMode = 'math';
      switchFieldMode('math');
      emptyMathRegion = true;
      hasExplicitMath =
        field.value.replaceAll('\\placeholder{}', '').trim() === '' ||
        mathSegments(field.value).length > 0;
      reportMode();
    };
    const moveOutOfMath = () => {
      activeInputMode = 'text';
      if (emptyMathRegion || isEmptyMathRegion()) {
        if (field.value.includes('\\placeholder{}')) {
          field.executeCommand('deleteBackward');
        }
        switchFieldMode('text');
        emptyMathRegion = false;
        hasExplicitMath = mathSegments(field.value).length > 0;
      } else {
        switchFieldMode('text');
      }
      reportMode();
    };
    // Navigation changes mode without allowing MathLive to reinterpret neighbors.
    const toggleMode = () => {
      consumeLineBreakCaretAffinity();
      finishBufferedArgument('complete');
      commandCompletionPending = false;
      latexCommandTransaction.clear();
      deferredCommandTemplate = null;
      unselectableCommandCompletion = null;
      editorHistory?.finishGroup();
      if (activeInputMode === 'math') moveOutOfMath();
      else enterMath();
    };
    const moveVertically = (direction: -1 | 1) => {
      const breaks = lineBreakOffsets();
      if (breaks.length === 0) return false;

      const currentLine = breaks.findIndex(
        (offset) => field.position <= offset,
      );
      const lineIndex = currentLine < 0 ? breaks.length : currentLine;
      const targetLine = lineIndex + direction;
      if (targetLine < 0 || targetLine > breaks.length) return true;

      const currentStart =
        lineIndex === 0 ? 0 : (breaks[lineIndex - 1] ?? -1) + 1;
      const targetStart =
        targetLine === 0 ? 0 : (breaks[targetLine - 1] ?? -1) + 1;
      const targetEnd = breaks[targetLine] ?? field.lastOffset;
      verticalColumn ??= Math.max(0, field.position - currentStart);
      field.position = Math.min(targetStart + verticalColumn, targetEnd);
      ensureActiveMode();
      reportMode();
      return true;
    };
    const insertLineBreak = () => {
      const fieldValueBeforeBreak = field.value;
      const startedAtDocumentEnd = field.position === field.lastOffset;
      const sourceBeforeBreak = canonicalizeMathLiveEditorValue(
        fieldValueBeforeBreak,
        {
          wrapUndelimitedMath:
            hasExplicitMath && mathSegments(fieldValueBeforeBreak).length === 0,
        },
      );
      if (activeInputMode === 'math') {
        for (let depth = 0; depth < 16; depth += 1) {
          const positionBeforeMove = field.position;
          field.executeCommand('moveAfterParent');
          if (field.position === positionBeforeMove) break;
        }
      }
      const breakOffsetsBefore = lineBreakOffsets();
      const insertedBreakOrdinal = breakOffsetsBefore.filter(
        (offset) => offset < field.position,
      ).length;
      retainsMathOnlySource = false;
      const sourceBeforeTerminalBreak = () =>
        canonicalizeMathLiveEditorValue(fieldValueBeforeBreak, {
          wrapUndelimitedMath:
            activeInputMode === 'math' &&
            mathSegments(fieldValueBeforeBreak).length === 0,
        }).replace(/\\text\{\}(?=\s*(?:\${1,2})?\s*$)/u, '');
      const rebuildTerminalBreak = () => {
        const rebuiltSource = sourceBeforeTerminalBreak();
        const rebuiltDocument = materializeMathLiveEditorDocument(
          `${rebuiltSource}\n`,
          activeInputMode,
        );
        if (rebuiltDocument.hasExplicitMath) hasExplicitMath = true;
        replaceFieldDocument(
          rebuiltDocument.value,
          rebuiltDocument.defaultMode,
        );
        field.position = field.lastOffset;
      };
      // A committed one-line formula can reopen with its document-end caret
      // trapped inside a trailing empty text atom. Inserting first is too late:
      // MathLive initially reports a top-level sentinel, then asynchronously
      // folds it into `\text{}`. Remove that semantically empty capture point
      // and build the terminal row directly.
      const trappedInTerminalEmptyText =
        startedAtDocumentEnd &&
        activeInputMode === 'math' &&
        /\\text\{\}\s*$/u.test(fieldValueBeforeBreak);
      if (trappedInTerminalEmptyText) {
        rebuildTerminalBreak();
      } else {
        field.insert(MATHLIVE_LINE_BREAK, {
          insertionMode: 'replaceSelection',
          mode: 'text',
          selectionMode: 'after',
        });
      }
      let breakOffsetsAfter = lineBreakOffsets();
      // Keep an invariant fallback for any other command context that accepts
      // the sentinel without exposing a top-level row immediately.
      if (
        startedAtDocumentEnd &&
        breakOffsetsAfter.length === breakOffsetsBefore.length
      ) {
        rebuildTerminalBreak();
        breakOffsetsAfter = lineBreakOffsets();
      }
      let insertedBreak = breakOffsetsAfter[insertedBreakOrdinal];

      const sourceAfterBreak = fromMathLiveMultilineSource(field.value);
      const canonicalSourceAfterBreak = canonicalizeMathLiveEditorValue(
        field.value,
        {
          wrapUndelimitedMath:
            hasExplicitMath && mathSegments(field.value).length === 0,
        },
      );
      if (
        !trappedInTerminalEmptyText &&
        canonicalSourceAfterBreak !== sourceAfterBreak
      ) {
        const insertedBreakIndex = [...canonicalSourceAfterBreak]
          .map((character, index) => ({ character, index }))
          .filter(({ character }) => character === '\n')
          .map(({ index }) => index)
          .find(
            (index) =>
              canonicalSourceAfterBreak.slice(0, index) +
                canonicalSourceAfterBreak.slice(index + 1) ===
              sourceBeforeBreak,
          );
        const repairedBreakOrdinal =
          insertedBreakIndex === undefined
            ? canonicalSourceAfterBreak.split('\n').length - 2
            : [
                ...canonicalSourceAfterBreak.slice(0, insertedBreakIndex),
              ].filter((character) => character === '\n').length;
        const repairedDocument = materializeMathLiveEditorDocument(
          canonicalSourceAfterBreak,
          activeInputMode,
        );
        replaceFieldDocument(
          repairedDocument.value,
          repairedDocument.defaultMode,
        );
        insertedBreak = lineBreakOffsets()[repairedBreakOrdinal];
        decorateSpecialText();
      }
      if (insertedBreak !== undefined) {
        const positionAfterBreak = trappedInTerminalEmptyText
          ? field.lastOffset
          : Math.min(insertedBreak + 1, field.lastOffset);
        lineBreakCaretAffinity = {
          breakOffset: insertedBreak,
          position: positionAfterBreak,
        };
        field.position = positionAfterBreak;
      }
      ensureActiveMode();
      scheduleLineBreakDecoration();
      reportMode();
      publishChange();
    };
    replayLineBreak = insertLineBreak;
    // Keyboard handling is a command state machine: history, structured LaTeX
    // completion, mode transitions, navigation, and ordinary character input.
    const handleKeyDown = (event: KeyboardEvent) => {
      consumeLineBreakCaretAffinity();
      scheduleCommandEntryPresentation();
      if (
        (event.ctrlKey || event.metaKey) &&
        !(event.ctrlKey && event.metaKey) &&
        !event.altKey &&
        (event.key.toLowerCase() === 'z' ||
          (!event.shiftKey && event.key.toLowerCase() === 'y'))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const direction =
          event.shiftKey || event.key.toLowerCase() === 'y' ? 1 : -1;
        window.setTimeout(() => requestEditorHistory(direction), 0);
        return;
      }

      const unmodifiedKey = !event.metaKey && !event.ctrlKey && !event.altKey;
      const characterInputKey =
        event.key.length === 1 &&
        !event.metaKey &&
        ((!event.ctrlKey && !event.altKey) ||
          event.getModifierState('AltGraph'));
      const terminalBreak = terminalPlaceholderBreak();
      if (
        editorReady &&
        characterInputKey &&
        activeInputMode === 'math' &&
        event.key === '\\' &&
        terminalBreak !== null
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        field.selection = {
          direction: 'none',
          ranges: [[terminalBreak + 1, field.lastOffset]],
        };
        field.insert('', {
          insertionMode: 'replaceSelection',
          mode: 'math',
          selectionMode: 'after',
          silenceNotifications: true,
        });
        field.position = Math.min(terminalBreak + 1, field.lastOffset);
        selectionController.invalidateDocument();
        switchFieldMode('math');
        emptyMathRegion = false;
        const commandAnchor = field.position;
        editorHistory?.beginGroup(
          selectionController.logicalPositionFromField(commandAnchor),
        );
        latexCommandTransaction.begin(commandAnchor);
        field.executeCommand(['switchMode', 'latex', '', '\\']);
        scheduleCommandEntryPresentation();
        return;
      }
      if (
        characterInputKey &&
        activeInputMode === 'math' &&
        event.key === '\\' &&
        field.mode !== 'latex' &&
        bufferedCommandState === null &&
        deferredCommandTemplate === null
      ) {
        const selectedRange = field.selection.ranges[0];
        const commandAnchor = field.selectionIsCollapsed
          ? field.position
          : (selectedRange?.[0] ?? field.position);
        const logicalCommandAnchor =
          selectionController.logicalPositionFromField(commandAnchor);
        editorHistory?.beginGroup(logicalCommandAnchor);
        if (!field.selectionIsCollapsed) {
          field.insert('', {
            insertionMode: 'replaceSelection',
            mode: 'math',
            selectionMode: 'after',
            silenceNotifications: true,
          });
          field.position = commandAnchor;
        }
        latexCommandTransaction.begin(commandAnchor);
      }
      if (
        !editorReady &&
        (characterInputKey ||
          (unmodifiedKey &&
            (event.key === 'Enter' || event.key === 'Backspace')))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        earlyInputs.push({
          bold: activeRequestedTextStyle.bold,
          color: typingColorValueRef.current,
          italic: activeRequestedTextStyle.italic,
          key: event.key,
          kind: 'key',
          mode: activeInputMode,
        });
        return;
      }
      if (
        characterInputKey ||
        (unmodifiedKey &&
          (event.key === 'Backspace' ||
            event.key === 'Delete' ||
            event.key === 'Enter'))
      ) {
        editorHistory?.markBeforeEdit(historyPosition());
      }
      if (bufferedCommandState !== null) {
        if (unmodifiedKey && event.key === 'Tab') {
          event.preventDefault();
          event.stopImmediatePropagation();
          finishBufferedArgument('advance');
          return;
        }
        if (unmodifiedKey && event.key === 'Enter') {
          event.preventDefault();
          event.stopImmediatePropagation();
          finishBufferedArgument('complete');
        }
        if (
          unmodifiedKey &&
          (event.key === 'Backspace' || event.key === 'Delete')
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (bufferedCommandState.argument.length === 0) {
            bufferedCommandState = null;
            field.insert('', {
              insertionMode: 'replaceSelection',
              mode: 'math',
            });
            editorHistory?.finishGroup();
          } else {
            bufferedCommandState.argument = bufferedCommandState.argument.slice(
              0,
              -1,
            );
            renderBufferedArgument();
          }
          return;
        }
        if (unmodifiedKey && event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
          bufferedCommandState = null;
          field.insert('', {
            insertionMode: 'replaceSelection',
            mode: 'math',
          });
          editorHistory?.finishGroup();
          return;
        }
        if (characterInputKey) {
          const argumentMode =
            bufferedCommandState.completion.argumentModes[
              bufferedCommandState.argumentIndex
            ];
          const latex =
            argumentMode === 'raw'
              ? event.key === '{'
                ? '\\{'
                : event.key === '}'
                  ? '\\}'
                  : event.key
              : event.key === '{'
                ? '\\{'
                : event.key === '}'
                  ? '\\}'
                  : event.key === '$'
                    ? '\\$'
                    : event.key === '\\'
                      ? '\\backslash '
                      : event.key;
          event.preventDefault();
          event.stopImmediatePropagation();
          bufferedCommandState.argument += latex;
          renderBufferedArgument();
          return;
        }
        finishBufferedArgument('complete');
      }
      if (
        deferredCommandTemplate !== null &&
        unmodifiedKey &&
        ['Backspace', 'Delete', 'Escape'].includes(event.key)
      ) {
        deferredCommandTemplate = null;
        if (event.key !== 'Escape') editorHistory?.finishGroup();
      }
      if (unmodifiedKey && event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        commandCompletionPending = false;
        latexCommandTransaction.clear();
        unselectableCommandCompletion = null;
        if (field.mode === 'latex') {
          field.executeCommand(['complete', 'reject']);
        }
        editorHistory?.finishGroup();
        return;
      }
      if (
        deferredCommandTemplate !== null &&
        characterInputKey &&
        event.key !== ' '
      ) {
        const escapedKey =
          event.key === '{'
            ? '\\{'
            : event.key === '}'
              ? '\\}'
              : event.key === '$'
                ? '\\$'
                : event.key === '\\'
                  ? '\\backslash'
                  : event.key;
        event.preventDefault();
        event.stopImmediatePropagation();
        const completion = fillDeferredCommandCompletion(
          deferredCommandTemplate,
          escapedKey,
        );
        deferredCommandTemplate = null;
        field.insert(completion, {
          focus: true,
          format: 'latex',
          insertionMode: 'replaceSelection',
          mode: 'math',
          selectionMode: 'after',
        });
        finishCommandHistoryOnKeyUp = true;
        return;
      }
      if (
        event.key === ' ' &&
        unmodifiedKey &&
        activeInputMode === 'math' &&
        field.mode === 'latex'
      ) {
        const command = activeLatexCommand();
        const buffered =
          command === null ? null : bufferedCommandCompletion(command);
        if (buffered !== null) {
          event.preventDefault();
          event.stopImmediatePropagation();
          field.executeCommand(['complete', 'reject']);
          restoreLatexCommandStartPosition();
          field.insert('\\placeholder{}', {
            focus: true,
            format: 'latex',
            mode: 'math',
            selectionMode: 'item',
            silenceNotifications: true,
          });
          bufferedCommandState = {
            argument: '',
            argumentIndex: 0,
            arguments: [],
            completion: buffered,
          };
          commandCompletionPending = false;
          deferredCommandTemplate = null;
          unselectableCommandCompletion = null;
          return;
        }
        const immediate =
          command === null
            ? null
            : (immediateCommandCompletion(command) ??
              macroCommandCompletion(command));
        if (immediate !== null) {
          event.preventDefault();
          event.stopImmediatePropagation();
          field.executeCommand(['complete', 'reject']);
          restoreLatexCommandStartPosition();
          field.insert(immediate, {
            focus: true,
            format: 'latex',
            mode: 'math',
            selectionMode: 'placeholder',
          });
          commandCompletionPending = false;
          deferredCommandTemplate = null;
          unselectableCommandCompletion = null;
          return;
        }
        const deferred =
          command === null ? null : deferredCommandCompletion(command);
        if (deferred !== null) {
          event.preventDefault();
          event.stopImmediatePropagation();
          field.executeCommand(['complete', 'reject']);
          restoreLatexCommandStartPosition();
          field.insert('\\placeholder{}', {
            focus: true,
            format: 'latex',
            mode: 'math',
            selectionMode: 'placeholder',
            silenceNotifications: true,
          });
          commandCompletionPending = false;
          deferredCommandTemplate = deferred.template;
          unselectableCommandCompletion = null;
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        field.executeCommand(['complete', 'accept-all']);
        unselectableCommandCompletion = null;
        const selectedCompletionArgument = repairEmptyCommandArguments();
        commandCompletionPending =
          !selectedCompletionArgument && unselectableCommandCompletion !== null;
        if (!selectedCompletionArgument && !commandCompletionPending) {
          finishCommandHistoryOnKeyUp = true;
        }
      } else if (commandCompletionPending && characterInputKey) {
        if (
          unselectableCommandCompletion !== null &&
          /^[A-Za-z0-9]$/.test(event.key)
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          field.insert(
            unselectableCommandCompletion.replace('\\placeholder{}', event.key),
            {
              focus: true,
              format: 'latex',
              insertionMode: 'replaceSelection',
              mode: 'math',
              selectionMode: 'after',
            },
          );
          commandCompletionPending = false;
          unselectableCommandCompletion = null;
          return;
        }
        repairEmptyCommandArguments();
        commandCompletionPending = false;
        unselectableCommandCompletion = null;
        finishCommandHistoryOnKeyUp = true;
      } else if (
        commandCompletionPending &&
        !['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)
      ) {
        commandCompletionPending = false;
        latexCommandTransaction.clear();
        unselectableCommandCompletion = null;
        editorHistory?.finishGroup();
      }
      if (editorReady && characterInputKey && activeInputMode === 'text') {
        // MathLive can clear a collapsed selection's pending style while a
        // clicked caret is being restored. Reapply every requested typing
        // style for each character rather than relying on stale style state.
        field.applyStyle({
          ...(typingColorValueRef.current === initialBaseColorRef.current
            ? {}
            : { color: typingColorValueRef.current }),
          fontSeries: activeRequestedTextStyle.bold ? 'b' : 'auto',
          fontShape: activeRequestedTextStyle.italic ? 'it' : 'auto',
        });
      }
      if (editorReady && characterInputKey && activeInputMode === 'text') {
        event.preventDefault();
        event.stopImmediatePropagation();
        field.insert(
          event.key === '\\'
            ? MATHLIVE_LITERAL_BACKSLASH
            : event.key === '$'
              ? MATHLIVE_LITERAL_DOLLAR
              : event.key,
          {
            insertionMode: 'replaceSelection',
            mode: 'text',
            selectionMode: 'after',
          },
        );
        return;
      }

      if (
        editorReady &&
        characterInputKey &&
        activeInputMode === 'math' &&
        event.key !== ' ' &&
        event.key !== '\\' &&
        event.key !== '$' &&
        terminalBreak !== null
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        field.insert(event.key, {
          insertionMode: 'replaceSelection',
          mode: 'math',
          selectionMode: 'after',
        });
        return;
      }

      if (
        (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
        unmodifiedKey &&
        !event.shiftKey &&
        field.selectionIsCollapsed &&
        moveVertically(event.key === 'ArrowUp' ? -1 : 1)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      verticalColumn = null;

      if (
        unmodifiedKey &&
        field.selectionIsCollapsed &&
        (event.key === 'Backspace' || event.key === 'Delete')
      ) {
        const adjacentBreak = lineBreakOffsets().find((offset) =>
          event.key === 'Backspace'
            ? field.position === offset + 1
            : field.position === offset,
        );
        if (adjacentBreak !== undefined) {
          event.preventDefault();
          event.stopImmediatePropagation();
          field.selection = {
            direction: 'none',
            ranges: [[adjacentBreak, adjacentBreak + 1]],
          };
          field.insert('', {
            insertionMode: 'replaceSelection',
            mode: 'text',
            selectionMode: 'after',
          });
          field.position = Math.min(adjacentBreak, field.lastOffset);
          selectionController.invalidateDocument();
          ensureActiveMode();
          const joinedSource = source();
          recordEditorHistory(joinedSource);
          publishChange(joinedSource);
          return;
        }
      }

      if (
        event.key === 'Backspace' &&
        unmodifiedKey &&
        activeInputMode === 'math' &&
        field.selectionIsCollapsed
      ) {
        preserveMathAfterDeletion = true;
      }

      if (event.key === '$' && characterInputKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        ensureActiveMode();
        field.insert('\\$', { mode: 'math' });
        return;
      }

      if (event.key === 'Enter' && field.mode === 'latex' && unmodifiedKey) {
        finishCommandHistoryOnKeyUp = true;
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopImmediatePropagation();
        insertLineBreak();
        return;
      }
      if (
        event.key === ' ' &&
        activeInputMode === 'math' &&
        field.mode !== 'latex' &&
        unmodifiedKey
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        editorHistory?.clearPendingEdit();
        return;
      }
      if (
        characterInputKey ||
        (unmodifiedKey && (event.key === 'Backspace' || event.key === 'Delete'))
      ) {
        ensureActiveMode();
      }
      if (activeInputMode === 'math') emptyMathRegion = false;
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      updateCommandEntryPresentation();
      if (finishCommandHistoryOnKeyUp) {
        finishCommandHistoryOnKeyUp = false;
        commandCompletionPending = false;
        latexCommandTransaction.clear();
        recordEditorHistory();
        editorHistory?.finishGroup();
      }
      if (
        event.key === ' ' &&
        commandCompletionPending &&
        repairEmptyCommandArguments()
      ) {
        commandCompletionPending = false;
      }
      if (event.key === ' ' && field.mode !== 'latex') {
        latexCommandTransaction.clear();
        const selectionContainsPlaceholder =
          !field.selectionIsCollapsed &&
          field.getValue(field.selection).includes('\\placeholder{}');
        if (
          bufferedCommandState === null &&
          deferredCommandTemplate === null &&
          !selectionContainsPlaceholder
        ) {
          editorHistory?.finishGroup();
        }
      }
      if (
        event.key.startsWith('Arrow') ||
        event.key === 'Home' ||
        event.key === 'End'
      ) {
        editorHistory?.finishGroup();
        reportTextStyle();
      }
      if (event.key === 'Tab') {
        const selectionContainsPlaceholder =
          !field.selectionIsCollapsed &&
          field.getValue(field.selection).includes('\\placeholder{}');
        if (!selectionContainsPlaceholder) editorHistory?.finishGroup();
      }
      const characterInputKey =
        event.key.length === 1 &&
        !event.metaKey &&
        ((!event.ctrlKey && !event.altKey) ||
          event.getModifierState('AltGraph'));
      const unmodifiedKey = !event.metaKey && !event.ctrlKey && !event.altKey;
      if (
        editorReady &&
        (characterInputKey ||
          (unmodifiedKey &&
            ['Backspace', 'Delete', 'Enter', 'Escape', 'Space', 'Tab'].includes(
              event.key,
            )))
      ) {
        selectionController.invalidateDocument();
        const sourceAfterKey = source();
        if (sourceAfterKey !== publicationController.source) {
          recordEditorHistory(sourceAfterKey);
          publishChange(sourceAfterKey);
        }
      }
    };
    const handleSelectionChange = () => {
      scheduleCommandEntryPresentation();
      // A drag paints itself from the pointer, which is the only account of the
      // selection that survives MathLive rebuilding the field underneath it.
      // Everything else - a keyboard selection, select-all, a command
      // transaction claiming its argument - is drawn from the marked glyphs,
      // because MathLive's own selection boxes are switched off. The event
      // announces the model's new selection, which the markup has not been
      // marked for yet, so the glyphs are read on the next frame.
      if (pointerSelection === null) {
        if (field.selectionIsCollapsed) {
          clearPointerSelection();
        } else if (selectionFrame === null) {
          selectionFrame = window.requestAnimationFrame(() => {
            selectionFrame = null;
            if (
              !field.isConnected ||
              pointerSelection !== null ||
              field.selectionIsCollapsed
            ) {
              return;
            }
            selectionController.showSelection();
          });
        }
      }
      onCaretChangeRef.current(historyPosition());
    };
    const preventMathFieldContextMenu = (event: MouseEvent) => {
      if (!event.composedPath().includes(field)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const handlePrepareSourceView = () => {
      finalizePendingInput();
    };
    const handleSourceLocalEdit = () => {
      localSourceEditPending = true;
    };
    const handleSourceCaretChange = (event: Event) => {
      const sourceOffset = (event as CustomEvent<{ sourceOffset?: unknown }>)
        .detail?.sourceOffset;
      if (
        typeof sourceOffset === 'number' &&
        Number.isInteger(sourceOffset) &&
        sourceOffset >= 0
      ) {
        sourceHistoryPosition = sourceOffset;
      }
    };
    const sourceCaretSynchronization = installSourceCaretSynchronization({
      field,
      getFieldOffset: semanticFieldPosition,
      getSource: () => publicationController.source,
      onFieldOffset: (fieldOffset) => {
        lineBreakCaretAffinity = null;
        requestedCaretPoint = null;
        requestedCaretOffset = null;
        clickedPositionAdjusted = true;
        field.position = fieldOffset;
        clearPointerSelection();
        focusDeliberately(field);
        scheduleFocusCheck();
      },
      onSourceOffset: (sourceOffset) => {
        sourceHistoryPosition = sourceOffset;
      },
    });
    const handleCaretPointRequest = (event: Event) => {
      const detail = (
        event as CustomEvent<{ offset?: unknown; point?: unknown }>
      ).detail;
      const point = detail?.point;
      if (
        typeof point !== 'object' ||
        point === null ||
        !('x' in point) ||
        !('y' in point) ||
        typeof point.x !== 'number' ||
        typeof point.y !== 'number'
      ) {
        return;
      }
      requestedCaretPoint = { x: point.x, y: point.y };
      requestedCaretOffset =
        typeof detail?.offset === 'number' &&
        Number.isInteger(detail.offset) &&
        detail.offset >= 0
          ? detail.offset
          : null;
      requestedCaretPointQueued = false;
      requestedCaretPointAttempts = 0;
      focusDeliberately(field);
      // Static and active MathLive DOM can be in different replacement frames
      // after an input. Reuse the readiness loop so point mapping waits for two
      // stable animation frames instead of accepting a transient offset 0.
      scheduleFocusCheck();
    };

    const handleVirtualLineBreak = (event: PointerEvent) => {
      const path = event.composedPath();
      const comesFromVirtualKeyboard = path.some(
        (target) =>
          target instanceof Element &&
          target.matches('math-virtual-keyboard, .ML__keyboard'),
      );
      const requestsLineBreak = path.some(
        (target) =>
          target instanceof Element &&
          target.classList.contains('chalkboard-line-break-key'),
      );
      if (!comesFromVirtualKeyboard || !requestsLineBreak) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finishBufferedArgument('complete');
      editorHistory?.markBeforeEdit(historyPosition());
      insertLineBreak();
    };

    // Install all browser listeners together so teardown is complete and ordered.
    toggleModeRef.current = toggleMode;
    window.addEventListener('pointerdown', handleVirtualLineBreak, true);
    const removeEditorEventLifecycle = installEditorEventLifecycle({
      field,
      handlers: {
        beforeInput: handleBeforeInput,
        blur: handleBlur,
        caretPointRequest: handleCaretPointRequest,
        contextMenu: preventMathFieldContextMenu,
        compositionEnd: handleCompositionEnd,
        compositionStart: handleCompositionStart,
        copy: handleCopy,
        cut: handleCut,
        fieldCompatibilityClick: handleFieldCompatibilityClick,
        fieldPointerDown: handleFieldPointerDown,
        fieldPointerMove: handleFieldPointerMove,
        fieldPointerSelectionEnd: finishFieldPointerSelection,
        historyExternalActor: handleHistoryExternalActor,
        historyRequest: handleHistoryRequest,
        input: handleInput,
        keyDown: handleKeyDown,
        keyUp: handleKeyUp,
        mount: handleMount,
        outsidePointerDown: handleOutsidePointerDown,
        pageHide: persist,
        paste: handlePaste,
        prepareSourceView: handlePrepareSourceView,
        remeasureForFont,
        selectionChange: handleSelectionChange,
        sourceCaretChange: handleSourceCaretChange,
        sourceLocalEdit: handleSourceLocalEdit,
        textStyleRequest: handleTextStyleRequest,
        typingColorRequest: handleTypingColorRequest,
      },
    });
    parent.append(field);
    // Inside the editor's own positioned box, so the camera moves and scales
    // the highlights with the writing they mark.
    parent.append(selectionOverlay);

    // Teardown cancels deferred work before disconnecting the active MathLive field.
    return () => {
      disposed = true;
      selectionController.dispose();
      applyExternalSourceRef.current = () => undefined;
      applyPendingRawSourceRef.current = () => undefined;
      resumeEditorReadinessRef.current = () => undefined;
      handleEditingViewTransitionRef.current = () => undefined;
      toggleModeRef.current = () => undefined;
      setTypingColorRef.current = () => undefined;
      if (blurTimer !== null) window.clearTimeout(blurTimer);
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
      if (fontMeasureFrame !== null) {
        window.cancelAnimationFrame(fontMeasureFrame);
      }
      if (selectionFrame !== null) {
        window.cancelAnimationFrame(selectionFrame);
        selectionFrame = null;
      }
      if (lineSelectionRestoreFrame !== null) {
        window.cancelAnimationFrame(lineSelectionRestoreFrame);
        lineSelectionRestoreFrame = null;
      }
      if (lineSelectionClickResetTimer !== null) {
        window.clearTimeout(lineSelectionClickResetTimer);
        lineSelectionClickResetTimer = null;
      }
      lineBreakObserver?.disconnect();
      field.removeAttribute('data-latex-command-active');
      window.removeEventListener('pointerdown', handleVirtualLineBreak, true);
      removeEditorEventLifecycle();
      sourceCaretSynchronization.dispose();
      if (window.mathVirtualKeyboard.visible) {
        window.mathVirtualKeyboard.hide();
      }
      selectionOverlay.remove();
      // MathLive keeps a module-level active field reference. Blur before
      // disconnecting so an immediately mounted replacement never inherits a
      // stale or already-destroyed model.
      field.blur();
      field.remove();
    };
  }, [
    caretPoint,
    caretPosition,
    element.id,
    initialLatex,
    publicationController,
  ]);

  const className = [
    'inline-math-editor',
    ...(isReady ? ['is-ready'] : []),
    ...(sourceView ? ['is-source-view'] : []),
  ].join(' ');

  return (
    <div
      aria-hidden={sourceView || undefined}
      className={className}
      inert={sourceView ? true : undefined}
      ref={containerRef}
      style={
        {
          '--mixed-line-spacing': `${element.lineSpacing ?? 1.2}em`,
          fontSize: element.fontSize,
          left: position.x,
          lineHeight: element.lineSpacing ?? 1.2,
          top: position.y,
          transform: `scale(${camera.zoom})`,
        } as CSSProperties
      }
    />
  );
}
