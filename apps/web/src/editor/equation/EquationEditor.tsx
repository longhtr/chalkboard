/**
 * Connects one workspace equation session to `InlineMathEditor`, translating
 * camera geometry and editor callbacks without owning source transactions.
 */
import { useLayoutEffect, useRef } from 'react';

import type { EquationEditingView } from './useEquationEditingView';
import { InlineMathEditor } from '../../math/InlineMathEditor';
import type { InlineMathEditorProps } from '../../math/InlineMathEditor.types';
import { SourceEquationEditor } from '../../math/SourceEquationEditor';

interface EquationEditorProps extends Omit<
  InlineMathEditorProps,
  'sourceView'
> {
  editingView: EquationEditingView;
}

/** Selects the rendered or source editor for one active equation session. */
export function EquationEditor({
  editingView,
  ...editorProps
}: EquationEditorProps) {
  const previousViewRef = useRef(editingView);
  const sourceCaretOffsetRef = useRef(editorProps.element.source.length);

  useLayoutEffect(() => {
    const previous = previousViewRef.current;
    previousViewRef.current = editingView;
    const field = document.querySelector<HTMLElement>('math-field');
    if (previous === 'rendered' && editingView === 'source') {
      field?.dispatchEvent(
        new CustomEvent('chalkboard-source-caret-query', {
          detail: {
            respond: (sourceOffset: number) => {
              sourceCaretOffsetRef.current = sourceOffset;
            },
          },
        }),
      );
      const textarea = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Block source"]',
      );
      const offset = Math.min(
        sourceCaretOffsetRef.current,
        editorProps.element.source.length,
      );
      textarea?.setSelectionRange(offset, offset);
      textarea?.focus({ preventScroll: true });
      return;
    }
    if (previous !== 'source' || editingView !== 'rendered') return;
    let focusFrame: number | null = null;
    const focusRenderedEditor = (remainingAttempts: number) => {
      const activeField = document.querySelector<HTMLElement>('math-field');
      activeField?.focus({ preventScroll: true });
      if (remainingAttempts === 0) return;
      focusFrame = window.requestAnimationFrame(() =>
        focusRenderedEditor(remainingAttempts - 1),
      );
    };
    focusFrame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('math-field')?.dispatchEvent(
        new CustomEvent('chalkboard-source-caret-request', {
          detail: { sourceOffset: sourceCaretOffsetRef.current },
        }),
      );
      focusRenderedEditor(60);
    });
    return () => {
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
    };
  }, [editingView, editorProps.element.source.length]);

  return (
    <>
      <InlineMathEditor
        {...editorProps}
        sourceView={editingView === 'source'}
      />
      <SourceEquationEditor
        camera={editorProps.camera}
        element={editorProps.element}
        onCaretChange={(offset) => {
          sourceCaretOffsetRef.current = offset;
          document.querySelector<HTMLElement>('math-field')?.dispatchEvent(
            new CustomEvent('chalkboard-source-caret-change', {
              detail: { sourceOffset: offset },
            }),
          );
        }}
        onChange={(source, width, height) => {
          document
            .querySelector<HTMLElement>('math-field')
            ?.dispatchEvent(new CustomEvent('chalkboard-source-local-edit'));
          editorProps.onChange(source, width, height);
        }}
        visible={editingView === 'source'}
      />
    </>
  );
}
