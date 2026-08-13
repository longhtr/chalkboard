/** Records listener registration/removal to prove complete, symmetric active-editor teardown. */
import type { MathfieldElement } from 'mathlive';
import { describe, expect, it, vi } from 'vitest';

import {
  installEditorEventLifecycle,
  type EditorEventHandlers,
} from './editorEventLifecycle';
import { WORKSPACE_FONT_READY_EVENT } from './mathLiveRuntime';

function eventHandlers(): EditorEventHandlers {
  return {
    beforeInput: vi.fn(),
    blur: vi.fn(),
    caretPointRequest: vi.fn(),
    contextMenu: vi.fn(),
    copy: vi.fn(),
    fieldPointerDown: vi.fn(),
    fieldPointerMove: vi.fn(),
    fieldPointerSelectionEnd: vi.fn(),
    historyRequest: vi.fn(),
    input: vi.fn(),
    keyDown: vi.fn(),
    keyUp: vi.fn(),
    mount: vi.fn(),
    outsidePointerDown: vi.fn(),
    pageHide: vi.fn(),
    paste: vi.fn(),
    remeasureForFont: vi.fn(),
    selectionChange: vi.fn(),
    textStyleRequest: vi.fn(),
    typingColorRequest: vi.fn(),
  };
}

function dispatchEditorEvents(
  field: EventTarget,
  documentTarget: EventTarget,
  windowTarget: EventTarget,
): void {
  field.dispatchEvent(new Event('chalkboard-history-request'));
  field.dispatchEvent(new Event('chalkboard-caret-point-request'));
  field.dispatchEvent(new Event('chalkboard-typing-color-request'));
  field.dispatchEvent(new Event('chalkboard-text-style-request'));
  field.dispatchEvent(new Event('beforeinput'));
  field.dispatchEvent(new Event('input'));
  field.dispatchEvent(new Event('selection-change'));
  documentTarget.dispatchEvent(new Event('pointerdown'));
  windowTarget.dispatchEvent(new Event('contextmenu'));
  windowTarget.dispatchEvent(new Event('pagehide'));
  windowTarget.dispatchEvent(new Event(WORKSPACE_FONT_READY_EVENT));
  field.dispatchEvent(new Event('blur'));
  field.dispatchEvent(new Event('pointerdown'));
  field.dispatchEvent(new Event('pointermove'));
  field.dispatchEvent(new Event('pointerup'));
  field.dispatchEvent(new Event('pointercancel'));
  field.dispatchEvent(new Event('copy'));
  field.dispatchEvent(new Event('paste'));
  field.dispatchEvent(new Event('keydown'));
  field.dispatchEvent(new Event('keyup'));
}

describe('active editor event lifecycle', () => {
  it('installs each listener once and removes every listener idempotently', () => {
    const fieldTarget = new EventTarget();
    const documentTarget = new EventTarget();
    const windowTarget = new EventTarget();
    const handlers = eventHandlers();
    const remove = installEditorEventLifecycle({
      documentTarget,
      field: fieldTarget as MathfieldElement,
      handlers,
      windowTarget,
    });

    fieldTarget.dispatchEvent(new Event('mount'));
    fieldTarget.dispatchEvent(new Event('mount'));
    dispatchEditorEvents(fieldTarget, documentTarget, windowTarget);

    expect(handlers.mount).toHaveBeenCalledTimes(1);
    expect(handlers.fieldPointerSelectionEnd).toHaveBeenCalledTimes(2);
    for (const [name, handler] of Object.entries(handlers)) {
      if (name === 'mount' || name === 'fieldPointerSelectionEnd') continue;
      expect(handler, name).toHaveBeenCalledTimes(1);
    }

    const callsBeforeRemoval = Object.fromEntries(
      Object.entries(handlers).map(([name, handler]) => [
        name,
        vi.mocked(handler).mock.calls.length,
      ]),
    );
    remove();
    remove();
    fieldTarget.dispatchEvent(new Event('mount'));
    dispatchEditorEvents(fieldTarget, documentTarget, windowTarget);

    expect(
      Object.fromEntries(
        Object.entries(handlers).map(([name, handler]) => [
          name,
          vi.mocked(handler).mock.calls.length,
        ]),
      ),
    ).toEqual(callsBeforeRemoval);
  });
});
