/** Plain canonical-source editor used only in source view, with synchronized selection and commit behavior. */
import {
  equationSourceFontSize,
  worldToScreen,
  type EquationElement,
} from '@chalkboard/shared';
import { useLayoutEffect, useRef, type CSSProperties } from 'react';

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
        onChange(event.currentTarget.value, element.width, element.height);
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
