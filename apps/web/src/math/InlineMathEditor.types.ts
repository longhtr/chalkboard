/**
 * React boundary around the imperative MathLive field. Publications carry one
 * canonical source and its measured board dimensions as an atomic snapshot.
 */
import type { Camera, EquationElement, Point } from '@chalkboard/shared';

import type { MixedEditorHistory } from './editorHistory';

/** Board, view, publication, focus, and style contract for one active field. */
export interface InlineMathEditorProps {
  camera: Camera;
  caretPoint: Point | null;
  caretPosition: number | null;
  isReady: boolean;
  historyActorId: string;
  historySession: MixedEditorHistory | undefined;
  initialMode: 'math' | 'text';
  modeToggleToken: number;
  element: EquationElement;
  sourceView: boolean;
  textBold: boolean;
  textItalic: boolean;
  typingColor: string;
  onCaretChange(position: number): void;
  onChange(latex: string, width: number, height: number): void;
  onCommit(latex: string, width: number, height: number): void;
  onHistoryAvailabilityChange(availability: {
    canRedo: boolean;
    canUndo: boolean;
  }): void;
  onHistorySession(session: MixedEditorHistory): void;
  onModeChange(mode: 'math' | 'text'): void;
  onTextStyleChange(style: { bold: boolean; italic: boolean }): void;
  onPersist(latex: string, width: number, height: number): void;
  onReady(): void;
  /**
   * Raw source written in source view could not be parsed on the way back to
   * the rendered view. The source is kept exactly as typed; only the rendering
   * is missing.
   */
  onSourceRenderError(reason: string): void;
}
