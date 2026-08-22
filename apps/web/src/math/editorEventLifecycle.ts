/**
 * Installs every browser/MathLive listener owned by one active field and returns
 * one teardown that removes them in a deterministic order.
 */
import type { MathfieldElement } from 'mathlive';

import { WORKSPACE_FONT_READY_EVENT } from './mathLiveRuntime';

type EditorEventHandler<T extends Event = Event> = (event: T) => void;

/** Complete browser/document/MathLive event set owned by one editor lifetime. */
export interface EditorEventHandlers {
  beforeInput: EditorEventHandler;
  blur: EditorEventHandler;
  caretPointRequest: EditorEventHandler;
  contextMenu: EditorEventHandler<MouseEvent>;
  compositionEnd: EditorEventHandler<CompositionEvent>;
  compositionStart: EditorEventHandler<CompositionEvent>;
  copy: EditorEventHandler<ClipboardEvent>;
  cut: EditorEventHandler<ClipboardEvent>;
  fieldCompatibilityClick: EditorEventHandler<MouseEvent>;
  fieldPointerDown: EditorEventHandler<PointerEvent>;
  fieldPointerMove: EditorEventHandler<PointerEvent>;
  fieldPointerSelectionEnd: EditorEventHandler<PointerEvent>;
  historyExternalActor: EditorEventHandler;
  historyRequest: EditorEventHandler;
  input: EditorEventHandler;
  keyDown: EditorEventHandler<KeyboardEvent>;
  keyUp: EditorEventHandler<KeyboardEvent>;
  mount: EditorEventHandler;
  outsidePointerDown: EditorEventHandler<PointerEvent>;
  pageHide: EditorEventHandler;
  paste: EditorEventHandler<ClipboardEvent>;
  prepareSourceView: EditorEventHandler;
  remeasureForFont: EditorEventHandler;
  selectionChange: EditorEventHandler;
  sourceCaretChange: EditorEventHandler;
  sourceLocalEdit: EditorEventHandler;
  textStyleRequest: EditorEventHandler;
  typingColorRequest: EditorEventHandler;
}

interface EditorEventLifecycleOptions {
  documentTarget?: EventTarget;
  field: MathfieldElement;
  handlers: EditorEventHandlers;
  windowTarget?: EventTarget;
}

function listen<T extends Event>(
  target: EventTarget,
  type: string,
  handler: EditorEventHandler<T>,
  options?: AddEventListenerOptions | boolean,
): () => void {
  const listener = handler as EventListener;
  target.addEventListener(type, listener, options);
  return () => target.removeEventListener(type, listener, options);
}

/** Installs every editor listener and returns one complete idempotent teardown. */
export function installEditorEventLifecycle({
  documentTarget = document,
  field,
  handlers,
  windowTarget = window,
}: EditorEventLifecycleOptions): () => void {
  const removeListeners = [
    listen(field, 'mount', handlers.mount, { once: true }),
    listen(
      field,
      'chalkboard-history-external-actor',
      handlers.historyExternalActor,
    ),
    listen(field, 'chalkboard-history-request', handlers.historyRequest),
    listen(field, 'chalkboard-caret-point-request', handlers.caretPointRequest),
    listen(
      field,
      'chalkboard-typing-color-request',
      handlers.typingColorRequest,
    ),
    listen(field, 'chalkboard-text-style-request', handlers.textStyleRequest),
    listen(field, 'beforeinput', handlers.beforeInput),
    listen(field, 'compositionend', handlers.compositionEnd),
    listen(field, 'compositionstart', handlers.compositionStart),
    listen(field, 'input', handlers.input),
    listen(field, 'selection-change', handlers.selectionChange),
    listen(field, 'chalkboard-source-caret-change', handlers.sourceCaretChange),
    listen(field, 'chalkboard-source-local-edit', handlers.sourceLocalEdit),
    listen(field, 'chalkboard-prepare-source-view', handlers.prepareSourceView),
    listen(documentTarget, 'pointerdown', handlers.outsidePointerDown, {
      capture: true,
    }),
    listen(windowTarget, 'contextmenu', handlers.contextMenu, {
      capture: true,
    }),
    listen(windowTarget, 'pagehide', handlers.pageHide),
    listen(windowTarget, WORKSPACE_FONT_READY_EVENT, handlers.remeasureForFont),
    listen(field, 'blur', handlers.blur),
    listen(field, 'click', handlers.fieldCompatibilityClick, { capture: true }),
    listen(field, 'dblclick', handlers.fieldCompatibilityClick, {
      capture: true,
    }),
    listen(field, 'pointerdown', handlers.fieldPointerDown, { capture: true }),
    listen(field, 'pointermove', handlers.fieldPointerMove, { capture: true }),
    listen(field, 'pointerup', handlers.fieldPointerSelectionEnd, {
      capture: true,
    }),
    listen(field, 'pointercancel', handlers.fieldPointerSelectionEnd, {
      capture: true,
    }),
    listen(field, 'copy', handlers.copy, { capture: true }),
    listen(field, 'cut', handlers.cut, { capture: true }),
    listen(field, 'paste', handlers.paste, { capture: true }),
    listen(field, 'keydown', handlers.keyDown, { capture: true }),
    listen(field, 'keyup', handlers.keyUp, { capture: true }),
  ];

  return () => {
    for (const removeListener of removeListeners.splice(0).reverse()) {
      removeListener();
    }
  };
}
