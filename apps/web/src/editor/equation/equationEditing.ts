/**
 * Commits one active equation transaction into board elements. Empty drafts are
 * discarded, empty existing equations are deleted, and whole-block color is
 * normalized before storage.
 */
import {
  isEquationElement,
  type BoardElement,
  type EquationElement,
} from '@chalkboard/shared';

import { isEmptyMixedSource, unwrapWholeTextColor } from '../../math/mixedMath';
import { hoistWholeTextColor } from '../model/boardSerialization';

/** Active equation session including its original/draft identity and measured view. */
export interface EditingEquation {
  /** Latest collaborative source over which this active draft was rebased. */
  collaborationBaseSource?: string;
  draft: EquationElement;
  height: number;
  id: string;
  initialSource: string;
  isNew: boolean;
  sessionId: string;
  source: string;
  width: number;
}

/** Commits measured canonical source into a new or existing equation element. */
export function applyEquationEdit(
  elements: BoardElement[],
  editing: EditingEquation,
  result: { height: number; source: string; width: number },
): BoardElement[] {
  const { height, source, width } = result;
  const unwrapped = unwrapWholeTextColor(source);
  const editedSource = unwrapped?.source ?? source;
  const isEmpty = isEmptyMixedSource(editedSource);
  if (editing.isNew) {
    return isEmpty
      ? elements
      : [
          ...elements,
          hoistWholeTextColor({ ...editing.draft, height, width }, source),
        ];
  }
  if (isEmpty) return elements.filter(({ id }) => id !== editing.id);
  if (source === editing.initialSource && unwrapped === null) return elements;
  return elements.map((element) =>
    element.id === editing.id && isEquationElement(element)
      ? hoistWholeTextColor({ ...element, height, width }, source)
      : element,
  );
}
