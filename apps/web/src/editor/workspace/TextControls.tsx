/**
 * Text/equation inspector for size, spacing, style, input mode, and future typing
 * color. Draft numeric fields commit through workspace semantic commands.
 */
import { useEffect, useRef } from 'react';

import type { EquationEditingView } from '../equation/useEquationEditingView';
import {
  MAX_LINE_SPACING,
  MAX_TEXT_SIZE,
  MIN_LINE_SPACING,
  MIN_TEXT_SIZE,
} from '../model/limits';

interface TextControlsProps {
  editingView: EquationEditingView;
  inputMode: 'math' | 'text';
  lineSpacing: number;
  lineSpacingInput: string;
  onCommitLineSpacingInput(): void;
  onCommitTextSizeInput(): void;
  onEditingViewChange(view: EquationEditingView): void;
  onFocusEditor(): void;
  onLineSpacingChange(value: number): void;
  onLineSpacingDraftChange(value: string): void;
  onLineSpacingGestureChange(phase: 'finish' | 'start'): void;
  onRegularText(): void;
  onTextSizeChange(value: number): void;
  onTextSizeDraftChange(value: string): void;
  onTextSizeGestureChange(phase: 'finish' | 'start'): void;
  onToggleTextStyle(style: 'bold' | 'italic'): void;
  showEditingView: boolean;
  showTextStyle: boolean;
  textSize: number;
  textSizeInput: string;
  textStyle: { bold: boolean; italic: boolean };
}

export function TextControls({
  editingView,
  inputMode,
  lineSpacing,
  lineSpacingInput,
  onCommitLineSpacingInput,
  onCommitTextSizeInput,
  onEditingViewChange,
  onFocusEditor,
  onLineSpacingChange,
  onLineSpacingDraftChange,
  onLineSpacingGestureChange,
  onRegularText,
  onTextSizeChange,
  onTextSizeDraftChange,
  onTextSizeGestureChange,
  onToggleTextStyle,
  showEditingView,
  showTextStyle,
  textSize,
  textSizeInput,
  textStyle,
}: TextControlsProps) {
  const focusTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current);
      }
    },
    [],
  );

  const finishTextSizeGesture = () => {
    onTextSizeGestureChange('finish');
    onFocusEditor();
  };
  const finishLineSpacingGesture = () => {
    onLineSpacingGestureChange('finish');
    onFocusEditor();
  };

  return (
    <>
      <span className="panel-label">Text size</span>
      <div className="text-size-control">
        <input
          type="range"
          className="text-size-slider"
          aria-label="Text size slider"
          min={MIN_TEXT_SIZE}
          max={MAX_TEXT_SIZE}
          step="1"
          value={Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, textSize))}
          onChange={(event) =>
            onTextSizeChange(Number(event.currentTarget.value))
          }
          onPointerDown={() => onTextSizeGestureChange('start')}
          onPointerUp={finishTextSizeGesture}
          onPointerCancel={finishTextSizeGesture}
          onKeyDown={(event) => {
            if (focusTimerRef.current !== null) {
              window.clearTimeout(focusTimerRef.current);
              focusTimerRef.current = null;
            }
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault();
              onFocusEditor();
            }
          }}
          onKeyUp={(event) => {
            if (!event.key.startsWith('Arrow')) return;
            focusTimerRef.current = window.setTimeout(() => {
              focusTimerRef.current = null;
              onFocusEditor();
            }, 400);
          }}
        />
        <input
          type="number"
          className="text-size-input"
          aria-label="Text size input"
          inputMode="numeric"
          min={MIN_TEXT_SIZE}
          max={MAX_TEXT_SIZE}
          step="1"
          value={textSizeInput}
          onChange={(event) => {
            const value = event.currentTarget.value;
            onTextSizeDraftChange(value);
            const fontSize = Number(value);
            if (
              value !== '' &&
              Number.isInteger(fontSize) &&
              fontSize >= MIN_TEXT_SIZE &&
              fontSize <= MAX_TEXT_SIZE
            ) {
              onTextSizeChange(fontSize);
            }
          }}
          onBlur={onCommitTextSizeInput}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault();
              event.currentTarget.blur();
              onFocusEditor();
            }
          }}
        />
      </div>
      <span className="panel-label">Line spacing</span>
      <div className="text-size-control">
        <input
          type="range"
          className="text-size-slider"
          aria-label="Line spacing slider"
          min={MIN_LINE_SPACING}
          max={MAX_LINE_SPACING}
          step="0.1"
          value={Math.min(
            MAX_LINE_SPACING,
            Math.max(MIN_LINE_SPACING, lineSpacing),
          )}
          onChange={(event) =>
            onLineSpacingChange(Number(event.currentTarget.value))
          }
          onPointerDown={() => onLineSpacingGestureChange('start')}
          onPointerUp={finishLineSpacingGesture}
          onPointerCancel={finishLineSpacingGesture}
        />
        <input
          type="number"
          className="text-size-input"
          aria-label="Line spacing input"
          inputMode="decimal"
          min={MIN_LINE_SPACING}
          max={MAX_LINE_SPACING}
          step="0.1"
          value={lineSpacingInput}
          onChange={(event) => {
            const value = event.currentTarget.value;
            onLineSpacingDraftChange(value);
            const nextLineSpacing = Number(value);
            if (
              value !== '' &&
              Number.isFinite(nextLineSpacing) &&
              nextLineSpacing >= MIN_LINE_SPACING &&
              nextLineSpacing <= MAX_LINE_SPACING
            ) {
              onLineSpacingChange(nextLineSpacing);
            }
          }}
          onBlur={onCommitLineSpacingInput}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault();
              event.currentTarget.blur();
              onFocusEditor();
            }
          }}
        />
      </div>
      {showTextStyle && inputMode === 'text' && editingView !== 'source' && (
        <>
          <span className="panel-label">Text style</span>
          <div
            className="input-mode-options"
            role="group"
            aria-label="Text style"
          >
            <button
              type="button"
              className={
                !textStyle.bold && !textStyle.italic
                  ? 'input-mode-option is-active'
                  : 'input-mode-option'
              }
              aria-label="Use regular text"
              aria-pressed={!textStyle.bold && !textStyle.italic}
              onClick={onRegularText}
            >
              Regular
            </button>
            <button
              type="button"
              className={
                textStyle.bold
                  ? 'input-mode-option is-active'
                  : 'input-mode-option'
              }
              aria-label="Toggle bold text"
              aria-pressed={textStyle.bold}
              onClick={() => onToggleTextStyle('bold')}
            >
              <strong>Bold</strong>
            </button>
            <button
              type="button"
              className={
                textStyle.italic
                  ? 'input-mode-option is-active'
                  : 'input-mode-option'
              }
              aria-label="Toggle italic text"
              aria-pressed={textStyle.italic}
              onClick={() => onToggleTextStyle('italic')}
            >
              <em>Italic</em>
            </button>
          </div>
        </>
      )}
      {showEditingView && (
        <>
          <span className="panel-label">Editing view</span>
          <div
            aria-label="Editing view"
            className="input-mode-options editing-view-options"
            role="group"
          >
            {(['rendered', 'source'] as const).map((view) => (
              <button
                aria-label={`Use ${view} editing view`}
                aria-pressed={editingView === view}
                className={
                  editingView === view
                    ? 'input-mode-option is-active'
                    : 'input-mode-option'
                }
                key={view}
                onClick={() => onEditingViewChange(view)}
                type="button"
              >
                {view === 'rendered' ? 'Rendered' : 'Source'}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
