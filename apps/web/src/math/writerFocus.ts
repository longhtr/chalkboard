/**
 * Decides whether MathLive may complete a focus move into the block.
 *
 * MathLive does not focus its keyboard sink when asked. It waits sixty
 * milliseconds and then focuses it, and that one deferred call carries both
 * the focus this editor asked for and a focus nobody asked for any more,
 * because it never rechecks whether the request still stands. Asking who holds
 * focus cannot tell the two apart: a writer who has just finished dragging the
 * size slider still holds that slider in the good case.
 *
 * What separates them is who asked last. Handing focus back to the block after
 * a control, opening a session, clicking into the block: each is a request,
 * recorded here. A writer moving to a control is a request too, and a later
 * one. MathLive's deferred call is not a request at all, only the delivery of
 * an older one, so it is refused once the writer has asked for somewhere else.
 */
let blockRequestedFocus = false;
let listening = false;

function noteWriterFocusChanges(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener(
    'focusin',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // Focus arriving in the block, however it got there, leaves the standing
      // request alone. Only the writer reaching a control overrides it.
      if (target.tagName === 'MATH-FIELD') return;
      if (isWriterControl(target)) blockRequestedFocus = false;
    },
    true,
  );
}

function isWriterControl(element: Element): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

/** Records a focus move the editor is making on purpose, then makes it. */
export function focusDeliberately(
  target: HTMLElement,
  options?: FocusOptions,
): void {
  noteWriterFocusChanges();
  blockRequestedFocus = true;
  target.focus(options);
}

export function writerHoldsAnotherControl(field: Element | null): boolean {
  noteWriterFocusChanges();
  if (blockRequestedFocus) return false;
  const active = document.activeElement;
  if (active === null || active === field) return false;
  // The source box is the control a view switch moves away from, not a place
  // the writer chose to be, so handing focus on from it is the intended move.
  if (active.getAttribute('aria-label') === 'Block source') return false;
  return isWriterControl(active);
}
