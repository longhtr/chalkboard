/** Plain canonical-source editor used only in source view, with synchronized selection and commit behavior. */
import {
  equationSourceFontSize,
  worldToScreen,
  type EquationElement,
} from '@chalkboard/shared';
import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';

import type { InlineMathEditorProps } from './InlineMathEditor.types';

interface SourceEquationEditorProps {
  camera: InlineMathEditorProps['camera'];
  element: EquationElement;
  onCaretChange(offset: number): void;
  onChange: InlineMathEditorProps['onChange'];
  visible: boolean;
}

/** Canonical-source textarea synchronized with rendered caret and measurement state. */
export function SourceEquationEditor({
  camera,
  element,
  onCaretChange,
  onChange,
  visible,
}: SourceEquationEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasVisibleRef = useRef(false);
  const position = worldToScreen(element, camera);
  const reportCaret = (textarea: HTMLTextAreaElement) =>
    onCaretChange(
      textarea.selectionDirection === 'backward'
        ? textarea.selectionStart
        : textarea.selectionEnd,
    );

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!visible || textarea === null) {
      wasVisibleRef.current = visible;
      return;
    }
    textarea.style.whiteSpace = 'pre';
    textarea.style.width = '0px';
    const sourceWidth = Math.min(textarea.scrollWidth, 640 / camera.zoom);
    textarea.style.whiteSpace = 'pre-wrap';
    textarea.style.width = `${Math.max(24, element.width, sourceWidth)}px`;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.max(element.height, textarea.scrollHeight)}px`;
    if (!wasVisibleRef.current) {
      textarea.focus({ preventScroll: true });
      if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        textarea.setSelectionRange(
          element.source.length,
          element.source.length,
        );
      }
    }
    wasVisibleRef.current = true;
  }, [camera.zoom, element.height, element.source, element.width, visible]);

  return (
    <textarea
      aria-label="Block source"
      autoCapitalize="off"
      autoComplete="off"
      autoCorrect="off"
      className="equation-source-editor"
      data-keep-math-editor-open
      hidden={!visible}
      onChange={(event) => {
        reportCaret(event.currentTarget);
        const source = event.currentTarget.value;
        // Commit the controlled raw source before a following toolbar click can
        // switch views. Parsing remains deferred until rendered view resumes,
        // so this synchronizes state/history without rebuilding MathLive per
        // source keystroke.
        flushSync(() => onChange(source, element.width, element.height));
      }}
      onKeyDown={(event) => {
        const primaryModifier =
          (event.ctrlKey || event.metaKey) &&
          !(event.ctrlKey && event.metaKey) &&
          !event.altKey;
        const key = event.key.toLowerCase();
        if (
          primaryModifier &&
          (key === 'z' || (!event.shiftKey && key === 'y'))
        ) {
          event.preventDefault();
          event.stopPropagation();
          document.querySelector<HTMLElement>('math-field')?.dispatchEvent(
            new CustomEvent('chalkboard-history-request', {
              detail: {
                direction: event.shiftKey || key === 'y' ? 1 : -1,
              },
            }),
          );
        }
      }}
      onKeyUp={(event) => reportCaret(event.currentTarget)}
      onPointerUp={(event) => reportCaret(event.currentTarget)}
      onSelect={(event) => reportCaret(event.currentTarget)}
      ref={textareaRef}
      spellCheck={false}
      style={
        {
          color: element.strokeColor,
          fontSize: equationSourceFontSize(element),
          left: position.x,
          lineHeight: element.lineSpacing ?? 1.2,
          top: position.y,
          transform: `scale(${camera.zoom})`,
        } as CSSProperties
      }
      value={element.source}
    />
  );
}
