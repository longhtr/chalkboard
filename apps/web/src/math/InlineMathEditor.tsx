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
import {
  clipboardTextFromMathLiveSelection,
  editorClipboardInsertions,
} from './editorClipboard';
import { installEditorEventLifecycle } from './editorEventLifecycle';
import { EditorSelectionController } from './editorSelectionController';
import { decorateExcalifontLayout } from './excalifontLayout';
import { EditorPublicationController } from './editorPublication';
import { MixedEditorHistory } from './editorHistory';
import type { InlineMathEditorProps } from './InlineMathEditor.types';
import { INLINE_MATH_EDITOR_SHADOW_CSS } from './inlineMathEditorShadowCss';
import {
  getWorkspaceFontChoice,
  waitForWorkspaceFonts,
} from './mathLiveRuntime';
import { mathArrayStretch } from './mathLineSpacing';
import { mergeEquationSourceEdit } from './mergeEquationSourceEdit';
import { installSourceCaretSynchronization } from './sourceCaretSynchronization';
import {
  canonicalizeMathLiveEditorValue,
  expandTextColors,
  expandTextStyles,
  fromMathLiveMultilineSource,
  isTextColorMarker,
  isTextStyleMarker,
  MATHLIVE_BOLD_OFF,
  MATHLIVE_BOLD_ON,
  MATHLIVE_ITALIC_OFF,
  MATHLIVE_ITALIC_ON,
  MATHLIVE_LINE_BREAK,
  MATHLIVE_LITERAL_BACKSLASH,
  MATHLIVE_LITERAL_DOLLAR,
  mathSegments,
  mixedSourceFromMathLiveEditor,
  parseMixedText,
  toMathLiveEditorSource,
} from './mixedMath';

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
  isReady,
  initialMode,
  modeToggleToken,
  onCaretChange,
  onChange,
  onCommit,
  onModeChange,
  onPersist,
  onReady,
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
  const onCaretChangeRef = useRef(onCaretChange);
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const onModeChangeRef = useRef(onModeChange);
  const onTextStyleChangeRef = useRef(onTextStyleChange);
  const onPersistRef = useRef(onPersist);
  const onReadyRef = useRef(onReady);
  const toggleModeRef = useRef<() => void>(() => undefined);
  const setTypingColorRef = useRef<(color: string) => void>(() => undefined);
  const typingColorValueRef = useRef(typingColor);
  const previousModeToggleTokenRef = useRef(modeToggleToken);
  const initialModeRef = useRef(initialMode);
  const initialBaseColorRef = useRef(element.strokeColor);
  const spacingRef = useRef(element.lineSpacing);
  const sourceViewRef = useRef(sourceView);
  const renderedEntrySourceRef = useRef<string | null>(null);
  const renderedViewEditedRef = useRef(false);
  const viewTransitionRef = useRef(false);
  const initialTextStyleRef = useRef({ bold: textBold, italic: textItalic });
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
    onModeChangeRef.current = onModeChange;
    onTextStyleChangeRef.current = onTextStyleChange;
    onPersistRef.current = onPersist;
    onReadyRef.current = onReady;
  }, [
    onCaretChange,
    onChange,
    onCommit,
    onModeChange,
    onPersist,
    onReady,
    onTextStyleChange,
  ]);

  useLayoutEffect(() => {
    if (sourceViewRef.current === sourceView) return;
    const previousSourceView = sourceViewRef.current;
    sourceViewRef.current = sourceView;
    if (previousSourceView && !sourceView) {
      renderedViewEditedRef.current = false;
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
    const earlyKeys: {
      bold: boolean;
      color: string;
      italic: boolean;
      key: string;
    }[] = [];
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
    let lineBreakObserver: MutationObserver | null = null;
    let emptyMathRegion = false;
    let preserveMathAfterDeletion = false;
    let verticalColumn: number | null = null;
    let activeInputMode = initialModeRef.current;
    let activeRequestedTextStyle = { ...initialTextStyleRef.current };
    const expandedInitialLatex = expandTextStyles(
      expandTextColors(initialLatex, initialBaseColorRef.current),
    );
    const initialSegments = parseMixedText(expandedInitialLatex);
    const initialMathSegments = mathSegments(expandedInitialLatex);
    const hasMixedText = initialSegments.some(
      (segment) => segment.kind === 'text' && segment.source.trim() !== '',
    );
    const isMathOnly = initialMathSegments.length === 1 && !hasMixedText;
    let retainsMathOnlySource = isMathOnly;
    let hasExplicitMath = initialMathSegments.length > 0;
    let editorHistory: MixedEditorHistory | null = null;
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
    let deferredCommandTemplate: string | null = null;
    let unselectableCommandCompletion: string | null = null;
    let requestedCaretPoint: Point | null = null;
    let requestedCaretOffset: number | null = null;
    let requestedCaretPointQueued = false;
    let requestedCaretPointAttempts = 0;

    // Construct the field and every controller that shares its exact lifetime.
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
    field.defaultMode = isMathOnly ? 'math' : 'text';
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
    const historyPosition = () => selectionController.historyPosition();
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
    // Focus and caret placement wait for MathLive's shadow DOM to settle.
    const scheduleFocusCheck = () => {
      focusFrame = window.requestAnimationFrame(focusWhenReady);
    };
    const focusWhenReady = () => {
      if (disposed) return;
      if (!positionInitialized) {
        positionInitialized = true;
        field.position =
          initialLatex === ''
            ? 0
            : caretPoint !== null
              ? field.getOffsetFromPoint(caretPoint.x, caretPoint.y)
              : caretPosition === null
                ? field.lastOffset
                : fieldPositionFromHistory(caretPosition);
        constrainPositionToClickedLine();
        scheduleFocusCheck();
        return;
      }
      if (!field.selectionIsCollapsed) {
        const currentPosition = field.position;
        field.position = currentPosition;
      }
      field.focus();
      const keyboardSink =
        field.shadowRoot?.querySelector('.ML__keyboard-sink');
      if (
        document.hasFocus() &&
        keyboardSink instanceof HTMLElement &&
        field.shadowRoot?.activeElement !== keyboardSink
      ) {
        keyboardSink.focus({ preventScroll: true });
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
      if (!(caret instanceof HTMLElement)) {
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
      if (earlyKeys.length > 0) {
        editorHistory?.markBeforeEdit(historyPosition());
      }
      let appliedStyle: Omit<(typeof earlyKeys)[number], 'key'> | null = null;
      for (const entry of earlyKeys.splice(0)) {
        if (entry.key === 'Backspace') {
          field.executeCommand('deleteBackward');
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
        if (entry.key === 'Enter') {
          field.insert(MATHLIVE_LINE_BREAK, { mode: 'text' });
        } else if (activeInputMode === 'text') {
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
      editorReady = true;
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
      const position = field.position;
      if (selection !== null) field.position = position;
      field.applyStyle({ color });
      if (selection !== null) field.selection = selection;
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
          element.textContent === MATHLIVE_LITERAL_DOLLAR,
        );
        element.classList.toggle(
          'mixed-text-literal-backslash',
          element.textContent === MATHLIVE_LITERAL_BACKSLASH,
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
        decorateExcalifontLayout(field.shadowRoot);
      }
    };
    const restoreExpandedTextStyles = () => {
      const selection = field.selection;
      let bold = false;
      let italic = false;
      let runStart = 0;
      restoringTextStyles = true;
      try {
        for (let offset = 0; offset <= field.lastOffset; offset += 1) {
          const value =
            offset < field.lastOffset
              ? field.getValue([offset, offset + 1])
              : '';
          if (offset < field.lastOffset && !isTextStyleMarker(value)) continue;
          if (offset > runStart && (bold || italic)) {
            field.selection = {
              direction: 'none',
              ranges: [[runStart, offset]],
            };
            field.applyStyle({
              ...(bold ? { fontSeries: 'b' as const } : {}),
              ...(italic ? { fontShape: 'it' as const } : {}),
            });
          }
          if (value === MATHLIVE_BOLD_ON) bold = true;
          else if (value === MATHLIVE_BOLD_OFF) bold = false;
          else if (value === MATHLIVE_ITALIC_ON) italic = true;
          else if (value === MATHLIVE_ITALIC_OFF) italic = false;
          runStart = offset + 1;
        }
      } finally {
        field.selection = selection;
        restoringTextStyles = false;
      }
    };
    const scheduleLineBreakDecoration = () => {
      window.requestAnimationFrame(() => {
        if (!disposed) decorateSpecialText();
      });
    };
    const handleMount = () => {
      if (mounted) return;
      mounted = true;
      field.registers.arraystretch = mathArrayStretch(spacingRef.current);
      field.setValue(
        isMathOnly
          ? (initialMathSegments[0]?.latex ?? '')
          : toMathLiveEditorSource(expandedInitialLatex),
        {
          mode: isMathOnly ? 'math' : 'text',
          silenceNotifications: true,
        },
      );
      restoreExpandedTextStyles();
      renderedEntrySourceRef.current = source();
      editorHistory = new MixedEditorHistory({
        hasExplicitMath,
        position: historyPosition(),
        retainsMathOnlySource,
        source: initialLatex,
      });
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
    const source = () =>
      mixedSourceFromMathLiveEditor(field.value, {
        baseColor: initialBaseColorRef.current,
        emptyMathRegion,
        hasExplicitMath,
        mode: field.mode,
        retainsMathOnlySource,
      });
    const selectionController = new EditorSelectionController({
      decorateSpecialText,
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
    applyExternalSourceRef.current = (nextSource) => {
      const currentSource = source();
      if (currentSource === nextSource) return;
      // MathLive can paint a local keystroke before delivering its input event.
      // Capture unknown current state before rebasing a genuinely new remote
      // value. Concurrent model notifications can transiently revisit a known
      // undo snapshot; applying it may update presentation, but must not
      // destructively rebase every local history entry to that stale value.
      if (sourceViewRef.current) {
        editorHistory?.markBeforeEdit(historyPosition());
      } else {
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
      }
      const wasAtEnd = field.position === field.lastOffset;
      const previousPosition = field.position;
      const expandedSource = expandTextStyles(
        expandTextColors(nextSource, initialBaseColorRef.current),
      );
      const nextSegments = parseMixedText(expandedSource);
      const nextMathSegments = mathSegments(expandedSource);
      const nextIsMathOnly =
        nextMathSegments.length === 1 &&
        !nextSegments.some(
          (segment) => segment.kind === 'text' && segment.source.trim() !== '',
        );
      hasExplicitMath = nextMathSegments.length > 0;
      retainsMathOnlySource = nextIsMathOnly;
      applyingExternalSource = true;
      try {
        field.setValue(
          nextIsMathOnly
            ? (nextMathSegments[0]?.latex ?? '')
            : toMathLiveEditorSource(expandedSource),
          {
            mode: nextIsMathOnly ? 'math' : 'text',
            silenceNotifications: true,
          },
        );
        restoreExpandedTextStyles();
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
      if (sourceViewRef.current) {
        editorHistory?.record({
          hasExplicitMath,
          position: historyPosition(),
          retainsMathOnlySource,
          source: nextSource,
        });
        const [width, height] = dimensions();
        if (publicationController.accept(nextSource, width, height)) {
          onChangeRef.current(nextSource, width, height);
        }
      } else {
        publicationController.synchronizeSource(nextSource);
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
      const [width, height] = dimensions();
      onCommitRef.current(stableSource(), width, height);
    };
    const persist = () => {
      const [width, height] = dimensions();
      onPersistRef.current(stableSource(), width, height);
    };
    const isEmptyMathRegion = () =>
      field.mode === 'math' &&
      (field.value.trim() === '' ||
        field.value.trim() === '\\placeholder{}' ||
        mathSegments(field.value).some(
          (segment) => segment.latex.trim() === '\\placeholder{}',
        ));
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
    const restoreLatexCommandStartPosition = () =>
      commandController.restoreTransactionStartPosition();
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
        hasExplicitMath,
        position: historyPosition(),
        retainsMathOnlySource,
        source: nextSource,
      });
    };
    const restoreEditorHistory = (direction: -1 | 1) => {
      const restoration = editorHistory?.step(direction);
      if (restoration === null || restoration === undefined) return;
      const { position: restoredPosition, snapshot } = restoration;
      const expandedSnapshotSource = expandTextStyles(
        expandTextColors(snapshot.source, initialBaseColorRef.current),
      );
      const snapshotSegments = parseMixedText(expandedSnapshotSource);
      const snapshotMathSegments = mathSegments(expandedSnapshotSource);
      const restoresMathOnly =
        snapshotMathSegments.length === 1 &&
        !snapshotSegments.some(
          (segment) => segment.kind === 'text' && segment.source.trim() !== '',
        );
      retainsMathOnlySource = snapshot.retainsMathOnlySource;
      hasExplicitMath = snapshot.hasExplicitMath;
      field.setValue(
        restoresMathOnly
          ? (snapshotMathSegments[0]?.latex ?? '')
          : toMathLiveEditorSource(expandedSnapshotSource),
        {
          mode: restoresMathOnly ? 'math' : 'text',
          silenceNotifications: true,
        },
      );
      restoreExpandedTextStyles();
      // Restore the global input mode at the root before moving into the
      // snapshot. Switching modes before the restored formula, or from a
      // caret nested inside it, can make MathLive reinterpret the surrounding
      // LaTeX as literal text.
      field.position = field.lastOffset;
      ensureActiveMode();
      field.position = fieldPositionFromHistory(restoredPosition);
      emptyMathRegion = isEmptyMathRegion();
      clearPointerSelection();
      decorateSpecialText();
      publishChange(snapshot.source);
    };
    const requestEditorHistory = (direction: -1 | 1) => {
      if (direction < 0) recordEditorHistory(publicationController.source);
      restoreEditorHistory(direction);
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
    const handleInput = (event: Event) => {
      // Ignore MathLive's keyboard-sink event and accept its host transaction.
      if (event.composedPath()[0] !== field || applyingExternalSource) return;
      scheduleCommandEntryPresentation();
      clearPointerSelection();
      if (restoringTextStyles) return;
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
      field.focus();
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
    const handleFieldPointerMove = (event: PointerEvent) => {
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
    const handlePaste = (event: ClipboardEvent) => {
      editorHistory?.markBeforeEdit(historyPosition());
      const clipboard = event.clipboardData;
      if (clipboard === null) return;
      const text = clipboard.getData('text/plain');

      event.preventDefault();
      event.stopImmediatePropagation();
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
      ensureActiveMode();
      scheduleLineBreakDecoration();
      reportMode();
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
    // Keyboard handling is a command state machine: history, structured LaTeX
    // completion, mode transitions, navigation, and ordinary character input.
    const handleKeyDown = (event: KeyboardEvent) => {
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
      if (
        unmodifiedKey &&
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
        unmodifiedKey &&
        (event.key.length === 1 ||
          event.key === 'Enter' ||
          event.key === 'Backspace')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        earlyKeys.push({
          bold: activeRequestedTextStyle.bold,
          color: typingColorValueRef.current,
          italic: activeRequestedTextStyle.italic,
          key: event.key,
        });
        return;
      }
      if (
        unmodifiedKey &&
        (event.key.length === 1 ||
          event.key === 'Backspace' ||
          event.key === 'Delete' ||
          event.key === 'Enter')
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
        if (unmodifiedKey && event.key.length === 1) {
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
        unmodifiedKey &&
        event.key.length === 1 &&
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
        commandCompletionPending = true;
        unselectableCommandCompletion = null;
      } else if (
        commandCompletionPending &&
        unmodifiedKey &&
        event.key.length === 1
      ) {
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
      if (
        editorReady &&
        unmodifiedKey &&
        activeInputMode === 'text' &&
        event.key.length === 1
      ) {
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
      if (
        unmodifiedKey &&
        activeInputMode === 'text' &&
        (event.key === '\\' || event.key === '$')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        field.insert(
          event.key === '\\'
            ? MATHLIVE_LITERAL_BACKSLASH
            : MATHLIVE_LITERAL_DOLLAR,
          {
            insertionMode: 'replaceSelection',
            mode: 'text',
            selectionMode: 'after',
          },
        );
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
        event.key === 'Backspace' &&
        unmodifiedKey &&
        activeInputMode === 'math' &&
        field.selectionIsCollapsed
      ) {
        preserveMathAfterDeletion = true;
      }

      if (event.key === '$' && unmodifiedKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        ensureActiveMode();
        field.insert('\\$', { mode: 'math' });
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const sourceBeforeBreak = canonicalizeMathLiveEditorValue(field.value, {
          wrapUndelimitedMath:
            hasExplicitMath && mathSegments(field.value).length === 0,
        });
        if (activeInputMode === 'math') {
          for (let depth = 0; depth < 16; depth += 1) {
            const positionBeforeMove = field.position;
            field.executeCommand('moveAfterParent');
            if (field.position === positionBeforeMove) break;
          }
        }
        retainsMathOnlySource = false;
        field.insert(MATHLIVE_LINE_BREAK, { mode: 'text' });

        const sourceAfterBreak = fromMathLiveMultilineSource(field.value);
        const canonicalSourceAfterBreak = canonicalizeMathLiveEditorValue(
          field.value,
          {
            wrapUndelimitedMath:
              hasExplicitMath && mathSegments(field.value).length === 0,
          },
        );
        if (canonicalSourceAfterBreak !== sourceAfterBreak) {
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
          const insertedBreakOrdinal =
            insertedBreakIndex === undefined
              ? canonicalSourceAfterBreak.split('\n').length - 2
              : [
                  ...canonicalSourceAfterBreak.slice(0, insertedBreakIndex),
                ].filter((character) => character === '\n').length;
          field.setValue(toMathLiveEditorSource(canonicalSourceAfterBreak), {
            mode: 'text',
            silenceNotifications: true,
          });
          restoreExpandedTextStyles();
          const repairedBreak = lineBreakOffsets()[insertedBreakOrdinal];
          field.position =
            repairedBreak === undefined
              ? field.lastOffset
              : Math.min(repairedBreak + 1, field.lastOffset);
          decorateSpecialText();
          publishChange();
        }
        ensureActiveMode();
        scheduleLineBreakDecoration();
        reportMode();
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
        unmodifiedKey &&
        (event.key.length === 1 ||
          event.key === 'Backspace' ||
          event.key === 'Delete')
      ) {
        ensureActiveMode();
      }
      if (activeInputMode === 'math') emptyMathRegion = false;
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      updateCommandEntryPresentation();
      if (finishCommandHistoryOnKeyUp) {
        finishCommandHistoryOnKeyUp = false;
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
        reportTextStyle();
      }
    };
    const handleSelectionChange = () => {
      scheduleCommandEntryPresentation();
      if (pointerSelection === null && field.selectionIsCollapsed) {
        clearPointerSelection();
      }
      onCaretChangeRef.current(historyPosition());
    };
    const preventMathFieldContextMenu = (event: MouseEvent) => {
      if (!event.composedPath().includes(field)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const removeSourceCaretSynchronization = installSourceCaretSynchronization({
      field,
      getSource: () => publicationController.source,
      onFieldOffset: (fieldOffset) => {
        requestedCaretPoint = null;
        requestedCaretOffset = null;
        clickedPositionAdjusted = true;
        field.position = fieldOffset;
        clearPointerSelection();
        field.focus();
        scheduleFocusCheck();
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
      field.focus();
      // Static and active MathLive DOM can be in different replacement frames
      // after an input. Reuse the readiness loop so point mapping waits for two
      // stable animation frames instead of accepting a transient offset 0.
      scheduleFocusCheck();
    };

    // Install all browser listeners together so teardown is complete and ordered.
    toggleModeRef.current = toggleMode;
    const removeEditorEventLifecycle = installEditorEventLifecycle({
      field,
      handlers: {
        beforeInput: handleBeforeInput,
        blur: handleBlur,
        caretPointRequest: handleCaretPointRequest,
        contextMenu: preventMathFieldContextMenu,
        copy: handleCopy,
        fieldPointerDown: handleFieldPointerDown,
        fieldPointerMove: handleFieldPointerMove,
        fieldPointerSelectionEnd: finishFieldPointerSelection,
        historyRequest: handleHistoryRequest,
        input: handleInput,
        keyDown: handleKeyDown,
        keyUp: handleKeyUp,
        mount: handleMount,
        outsidePointerDown: handleOutsidePointerDown,
        pageHide: persist,
        paste: handlePaste,
        remeasureForFont,
        selectionChange: handleSelectionChange,
        textStyleRequest: handleTextStyleRequest,
        typingColorRequest: handleTypingColorRequest,
      },
    });
    parent.append(field);
    parent.parentElement?.append(selectionOverlay);

    // Teardown cancels deferred work before disconnecting the active MathLive field.
    return () => {
      disposed = true;
      applyExternalSourceRef.current = () => undefined;
      toggleModeRef.current = () => undefined;
      setTypingColorRef.current = () => undefined;
      if (blurTimer !== null) window.clearTimeout(blurTimer);
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
      if (fontMeasureFrame !== null) {
        window.cancelAnimationFrame(fontMeasureFrame);
      }
      lineBreakObserver?.disconnect();
      field.removeAttribute('data-latex-command-active');
      removeEditorEventLifecycle();
      removeSourceCaretSynchronization();
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
