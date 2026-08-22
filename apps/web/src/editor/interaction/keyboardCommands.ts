/**
 * Maps browser key events to semantic workspace commands. It rejects commands
 * while modal/input ownership applies and prevents default only after handling.
 */
import type { Tool } from './toolModel';

const isFormControl = (target: EventTarget | null): target is HTMLElement =>
  target instanceof HTMLElement && target.matches('input, textarea, select');

const editsText = (target: EventTarget | null): target is HTMLElement =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.matches('math-field, input, textarea, select'));

/** Reports whether the event path belongs to a native or MathLive text editor. */
export const keyboardEventEditsText = (event: KeyboardEvent): boolean =>
  event.composedPath().some(editsText);

/** Current command context plus semantic callbacks owned by the workspace. */
export interface KeyboardCommandOptions {
  activeTool: Tool;
  bezierHandlePreview: boolean;
  canDelete: boolean;
  canNudgeSelection: boolean;
  currentStrokeColor: string;
  editingEquation: boolean;
  modalOpen: boolean;
  readOnly: boolean;
  strokeColors: readonly string[];
  toolOrder: readonly Tool[];
  addStraightPoint(): boolean;
  adjustLineSpacing(direction: -1 | 1): void;
  adjustTextSize(direction: -1 | 1): void;
  cancelBezierPreview(): void;
  copySelectedObjects(): void;
  deleteSelection(): void;
  moveToEquation(
    direction: 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp',
  ): void;
  nudgeSelection(
    direction: 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp',
    distance: 1 | 10,
  ): void;
  pasteCopiedObjects(): void;
  requestHistory(direction: 'redo' | 'undo'): void;
  selectTool(tool: Tool): void;
  setTypingColor(color: string): void;
  toggleEquationEditingView(): void;
  toggleEquationInputMode(): void;
  toggleSelectionObjects(): void;
}

function directionForCodes(
  code: string,
  decrementCode: string,
  incrementCode: string,
): -1 | 1 | undefined {
  if (code === decrementCode) return -1;
  if (code === incrementCode) return 1;
  return undefined;
}

/** Handles at most one semantic workspace command for a browser key event. */
export function handleKeyboardCommand(
  event: KeyboardEvent,
  options: KeyboardCommandOptions,
): void {
  if (options.modalOpen) return;
  const viewerCopy =
    options.readOnly &&
    (event.ctrlKey || event.metaKey) &&
    !(event.ctrlKey && event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'c';
  if (options.readOnly && event.key !== 'Escape' && !viewerCopy) {
    if (!isFormControl(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
  }

  const primaryModifier =
    (event.ctrlKey || event.metaKey) &&
    !(event.ctrlKey && event.metaKey) &&
    !event.altKey;

  const metricControlFocused =
    event.target instanceof HTMLElement &&
    event.target.matches('.text-size-slider, .text-size-input');
  if (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    (!isFormControl(event.target) || metricControlFocused)
  ) {
    const textSizeDirection = directionForCodes(event.code, 'Minus', 'Equal');
    const lineSpacingDirection = directionForCodes(
      event.code,
      'BracketLeft',
      'BracketRight',
    );
    if (textSizeDirection !== undefined) {
      event.preventDefault();
      event.stopImmediatePropagation();
      options.adjustTextSize(textSizeDirection);
      return;
    }
    if (lineSpacingDirection !== undefined) {
      event.preventDefault();
      event.stopImmediatePropagation();
      options.adjustLineSpacing(lineSpacingDirection);
      return;
    }
  }

  if (
    options.activeTool === 'line' &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    (event.code === 'Space' || event.key === ' ') &&
    !keyboardEventEditsText(event) &&
    options.addStraightPoint()
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  if (
    options.activeTool === 'line' &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    (event.key === 'Enter' || event.key === 'Escape') &&
    options.bezierHandlePreview &&
    !isFormControl(event.target)
  ) {
    event.preventDefault();
    options.cancelBezierPreview();
    return;
  }

  if (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    (event.code === 'ArrowDown' ||
      event.code === 'ArrowLeft' ||
      event.code === 'ArrowRight' ||
      event.code === 'ArrowUp') &&
    options.activeTool === 'equation'
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
    options.moveToEquation(event.code);
    return;
  }

  if (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    (event.code === 'KeyJ' || event.code === 'KeyK') &&
    options.activeTool === 'equation'
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const currentIndex = options.strokeColors.indexOf(
      options.currentStrokeColor,
    );
    const direction = event.code === 'KeyK' ? 1 : -1;
    const nextIndex =
      (Math.max(0, currentIndex) + direction + options.strokeColors.length) %
      options.strokeColors.length;
    options.setTypingColor(
      options.strokeColors[nextIndex] ?? options.currentStrokeColor,
    );
    return;
  }

  if (
    primaryModifier &&
    (event.key.toLowerCase() === 'z' ||
      (!event.shiftKey && event.key.toLowerCase() === 'y'))
  ) {
    if (
      options.activeTool === 'hand' ||
      event.composedPath().some(isFormControl)
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const direction =
      event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo';
    options.requestHistory(direction);
    return;
  }

  // Switching between the rendered field and its canonical source. Only while
  // a block is being edited, so the key stays free everywhere else.
  if (
    primaryModifier &&
    !event.shiftKey &&
    options.editingEquation &&
    event.key.toLowerCase() === 'e'
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
    options.toggleEquationEditingView();
    return;
  }

  if (primaryModifier && event.key.toLowerCase() === 'm') {
    event.preventDefault();
    event.stopImmediatePropagation();
    options.toggleEquationInputMode();
    return;
  }

  if (
    primaryModifier &&
    !event.shiftKey &&
    (event.key.toLowerCase() === 'c' || event.key.toLowerCase() === 'v')
  ) {
    const isEditingText = keyboardEventEditsText(event);
    if (!isEditingText && !options.editingEquation) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key.toLowerCase() === 'c') options.copySelectedObjects();
      else options.pasteCopiedObjects();
      return;
    }
  }

  const shortcut = primaryModifier
    ? options.toolOrder[Number.parseInt(event.key, 10) - 1]
    : undefined;
  if (shortcut !== undefined) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (shortcut === 'selection' && options.activeTool === 'selection') {
      options.toggleSelectionObjects();
    } else {
      options.selectTool(shortcut);
    }
    return;
  }

  if (
    options.activeTool === 'selection' &&
    options.canNudgeSelection &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    (event.key === 'ArrowDown' ||
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'ArrowUp') &&
    !keyboardEventEditsText(event)
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
    options.nudgeSelection(event.key, event.shiftKey ? 10 : 1);
    return;
  }

  if (event.key !== 'Delete' && event.key !== 'Backspace') return;
  if (keyboardEventEditsText(event) || !options.canDelete) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  options.deleteSelection();
}
