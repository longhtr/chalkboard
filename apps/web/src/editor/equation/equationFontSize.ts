/**
 * Applies equation font-size changes while preserving visual anchors and
 * provides bounded estimates until the rendered MathLive DOM is measured.
 */
import {
  equationSourceFontSize,
  isEquationElement,
  type BoardElement,
  type EquationElement,
} from '@chalkboard/shared';

import type { EquationEditingView } from './useEquationEditingView';

/** Returns the independent rendered or source font size for an equation. */
export function equationFontSizeForView(
  element: EquationElement,
  view: EquationEditingView,
): number {
  return view === 'source' ? equationSourceFontSize(element) : element.fontSize;
}

/**
 * Fixes the source view's own size onto the element.
 *
 * Until a block has been shown in both views its source size is only derived,
 * as the rendered size less a fixed offset, so later changes to the rendered
 * size silently dragged the source size along with them. Writing the derived
 * value down the first time a block changes view makes the two sizes
 * independent from that point, which is what the toolbar already implies by
 * offering a size per view.
 */
export function materializeSourceFontSize(
  element: EquationElement,
): EquationElement {
  return element.sourceFontSize === undefined
    ? { ...element, sourceFontSize: equationSourceFontSize(element) }
    : element;
}

/** Applies {@link materializeSourceFontSize} to the equation being edited. */
export function materializeSourceFontSizes(
  elements: BoardElement[],
  editingId: string | null,
): BoardElement[] {
  if (editingId === null) return elements;
  let changed = false;
  const updated = elements.map((element) => {
    if (!isEquationElement(element) || element.id !== editingId) return element;
    const next = materializeSourceFontSize(element);
    if (next !== element) changed = true;
    return next;
  });
  return changed ? updated : elements;
}

/** Updates one view's font size while preserving the equation's visual center. */
export function updateEquationFontSize(
  element: EquationElement,
  view: EquationEditingView,
  fontSize: number,
): EquationElement {
  if (equationFontSizeForView(element, view) === fontSize) return element;
  return view === 'source'
    ? { ...element, sourceFontSize: fontSize }
    : { ...element, fontSize };
}

/** Applies a centered font-size edit to selected and actively edited equations. */
export function updateEquationFontSizes(
  elements: BoardElement[],
  options: {
    editingId: string | null;
    editingView: EquationEditingView;
    fontSize: number;
    selectedIds: ReadonlySet<string>;
  },
): BoardElement[] {
  const { editingId, editingView, fontSize, selectedIds } = options;
  let changed = false;
  const updated = elements.map((element) => {
    if (
      !isEquationElement(element) ||
      (!selectedIds.has(element.id) && element.id !== editingId)
    ) {
      return element;
    }
    const next = updateEquationFontSize(
      element,
      element.id === editingId ? editingView : 'rendered',
      fontSize,
    );
    if (next !== element) changed = true;
    return next;
  });
  return changed ? updated : elements;
}

/** Restores editor focus only if the originating editing session remains active. */
export function focusEquationEditorAfterControl(
  activeSession: { current: string | null },
  sessionId: string,
  view: EquationEditingView,
): number {
  return window.requestAnimationFrame(() => {
    if (activeSession.current !== sessionId) return;
    document
      .querySelector<HTMLElement>(
        view === 'source'
          ? 'textarea[aria-label="Block source"]'
          : 'math-field',
      )
      ?.focus({ preventScroll: true });
  });
}
