/** A phone long press exposes only the clipboard actions for the touched context. */
import type { MathfieldElement } from 'mathlive';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import type { EquationEditingView } from '../equation/useEquationEditingView';
import type { Tool } from '../interaction/toolModel';

interface PasteDestination {
  insert(text: string): void;
  prepare(): boolean;
}

/** Keep the insertion point while a clipboard menu has focus. */
function pasteDestination(view: EquationEditingView): PasteDestination | null {
  if (view === 'source') {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Block source"]',
    );
    if (textarea === null || textarea.hidden) return null;
    const { selectionStart, selectionEnd, selectionDirection } = textarea;
    const source = textarea.value;
    const prepare = () => {
      if (!textarea.isConnected || textarea.hidden || textarea.value !== source)
        return false;
      textarea.setSelectionRange(
        selectionStart,
        selectionEnd,
        selectionDirection,
      );
      textarea.focus({ preventScroll: true });
      return true;
    };
    return {
      prepare,
      insert: (text) => {
        if (!prepare()) return;
        textarea.dispatchEvent(
          new CustomEvent('chalkboard-paste-text-request', {
            detail: { text },
          }),
        );
      },
    };
  }
  const field = document.querySelector<MathfieldElement>('math-field');
  if (field === null) return null;
  const selection = structuredClone(field.selection);
  const source = field.value;
  const visible = () => field.isConnected && field.closest('[inert]') === null;
  const prepare = () => {
    if (!visible() || field.value !== source) return false;
    field.selection = selection;
    field.dispatchEvent(new CustomEvent('chalkboard-focus-request'));
    return true;
  };
  return {
    prepare,
    insert: (text) => {
      if (!prepare()) return;
      field.dispatchEvent(
        new CustomEvent('chalkboard-paste-text-request', { detail: { text } }),
      );
    },
  };
}

function supportsNativePaste(): boolean {
  // Safari exposes its Paste callout through this command. Chromium does not
  // support it, so those browsers use the async clipboard API from a tap.
  return document.queryCommandSupported?.('paste') === true;
}

function nativePaste(destination: PasteDestination): boolean {
  if (!destination.prepare()) return false;
  // Safari owns the callout and delivers a normal paste event to the existing
  // editor. Cancelling it is a normal no-op, not a permission failure.
  return document.execCommand('paste');
}

interface ClipboardContextMenuProps {
  activeTool: Tool;
  disabled: boolean;
  editingView: EquationEditingView;
  viewportRef: RefObject<HTMLDivElement | null>;
  objectAt(point: { x: number; y: number }): 'selected' | 'empty' | null;
  onCopyObjects(): Promise<boolean>;
  onCutObjects(): boolean;
  onPasteObjects(): boolean;
  onCancelCanvasGesture(): void;
  onError(message: string): void;
}

interface ClipboardMenu {
  x: number;
  y: number;
  kind: 'objects' | 'paste';
  destination: PasteDestination | null;
}

export function ClipboardContextMenu(props: ClipboardContextMenuProps) {
  const [menu, setMenu] = useState<ClipboardMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pasteInFlight = useRef(false);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    let press: { pointerId: number; x: number; y: number } | null = null;
    let nativeDestination: PasteDestination | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const activePointers = new Set<number>();
    let suppressClick = false;
    const cancelPress = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      press = null;
      nativeDestination = null;
    };
    const insideViewport = (event: Event) => {
      const viewport = latest.current.viewportRef.current;
      return viewport !== null && event.composedPath().includes(viewport);
    };
    const pointerDown = (event: PointerEvent) => {
      // Any new press is deliberate, including a tap on the clipboard menu.
      suppressClick = false;
      if (
        menuRef.current !== null &&
        event.composedPath().includes(menuRef.current)
      )
        return;
      setMenu(null);
      cancelPress();
      if (event.pointerType !== 'touch') return;
      activePointers.add(event.pointerId);
      const { activeTool, disabled } = latest.current;
      if (
        activePointers.size !== 1 ||
        disabled ||
        !insideViewport(event) ||
        (activeTool !== 'equation' && activeTool !== 'selection')
      )
        return;
      const origin = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      press = origin;
      timer = setTimeout(() => {
        timer = null;
        if (press !== origin) return;
        const options = latest.current;
        if (options.disabled || options.activeTool !== activeTool) return;
        if (activeTool === 'equation') {
          const destination = pasteDestination(options.editingView);
          if (destination === null) return;
          if (supportsNativePaste()) {
            // A timer is not a user gesture. Request the native callout on the
            // matching pointerup, while Safari still has user activation.
            nativeDestination = destination;
          } else {
            setMenu({ ...origin, kind: 'paste', destination });
          }
        } else {
          const target = options.objectAt(origin);
          if (target === null) return;
          options.onCancelCanvasGesture();
          setMenu({
            ...origin,
            kind: target === 'selected' ? 'objects' : 'paste',
            destination: null,
          });
        }
        // Clear any browser range created before Safari delivered the hold.
        // MathLive's logical selection and the source textarea are independent.
        if (nativeDestination === null)
          window.getSelection()?.removeAllRanges();
        suppressClick = true;
      }, 450);
    };
    const pointerMove = (event: PointerEvent) => {
      if (
        press?.pointerId === event.pointerId &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10
      ) {
        cancelPress();
        setMenu(null);
      }
    };
    const pointerEnd = (event: PointerEvent) => {
      activePointers.delete(event.pointerId);
      if (press?.pointerId !== event.pointerId) return;
      const destination = nativeDestination;
      cancelPress();
      if (
        destination !== null &&
        event.type === 'pointerup' &&
        !latest.current.disabled &&
        latest.current.activeTool === 'equation'
      )
        nativePaste(destination);
    };
    const contextMenu = (event: Event) => {
      if (
        insideViewport(event) &&
        window.matchMedia('(pointer: coarse)').matches &&
        ['equation', 'selection'].includes(latest.current.activeTool)
      )
        event.preventDefault();
    };
    const selectStart = (event: Event) => {
      if (
        !insideViewport(event) ||
        !window.matchMedia('(pointer: coarse)').matches
      )
        return;
      if (
        event
          .composedPath()
          .some(
            (target) =>
              target instanceof Element &&
              target.matches('.equation-source-editor, .ML__keyboard-sink'),
          )
      )
        return;
      event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      // At the top edge the clamped menu can overlap the held finger. Chromium
      // retargets its compatibility click to that menu, outside the viewport.
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const dismiss = () => {
      suppressClick = false;
      cancelPress();
      setMenu(null);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('pointermove', pointerMove, true);
    window.addEventListener('pointerup', pointerEnd, true);
    window.addEventListener('pointercancel', pointerEnd, true);
    window.addEventListener('contextmenu', contextMenu, true);
    window.addEventListener('selectstart', selectStart, true);
    window.addEventListener('click', click, true);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('resize', dismiss);
    return () => {
      cancelPress();
      window.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('pointermove', pointerMove, true);
      window.removeEventListener('pointerup', pointerEnd, true);
      window.removeEventListener('pointercancel', pointerEnd, true);
      window.removeEventListener('contextmenu', contextMenu, true);
      window.removeEventListener('selectstart', selectStart, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('resize', dismiss);
    };
  }, []);

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (menu === null || element === null) return;
    const bounds = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    element.style.left = `${Math.max(left + 8, Math.min(menu.x - bounds.width / 2, left + width - bounds.width - 8))}px`;
    element.style.top = `${Math.max(top + 8, menu.y - bounds.height - 12)}px`;
  }, [menu]);

  const paste = async () => {
    if (menu === null || pasteInFlight.current) return;
    const { destination } = menu;
    if (destination === null) {
      setMenu(null);
      if (!props.onPasteObjects())
        props.onError('Copy or cut an object before pasting.');
      return;
    }
    pasteInFlight.current = true;
    try {
      // Restore focus BEFORE asking the browser. Moving focus while Safari's
      // Paste callout is open can dismiss it and reject the clipboard request.
      if (supportsNativePaste()) {
        if (nativePaste(destination)) setMenu(null);
        return;
      }
      if (!destination.prepare()) {
        setMenu(null);
        return;
      }
      if (navigator.clipboard?.readText === undefined) {
        props.onError('Use your keyboard’s Paste command.');
        setMenu(null);
        return;
      }
      const text = await navigator.clipboard.readText();
      if (text !== '') destination.insert(text);
      setMenu((current) => (current === menu ? null : current));
    } catch {
      // Dismissing a browser prompt or denying access must not disturb the
      // editor. Keep Paste available for another deliberate attempt; native
      // paste events from the keyboard continue to work without this API.
    } finally {
      pasteInFlight.current = false;
    }
  };

  if (menu === null || props.disabled) return null;
  return createPortal(
    <div
      ref={menuRef}
      className="clipboard-context-menu"
      role="toolbar"
      aria-label="Clipboard actions"
      data-keep-math-editor-open
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse') event.preventDefault();
      }}
    >
      {menu.kind === 'objects' ? (
        <>
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              void props.onCopyObjects();
            }}
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              props.onCutObjects();
            }}
          >
            Cut
          </button>
        </>
      ) : (
        <button type="button" onClick={() => void paste()}>
          Paste
        </button>
      )}
    </div>,
    document.body,
  );
}
