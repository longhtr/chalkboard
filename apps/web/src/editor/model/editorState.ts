/**
 * Pure committed-document reducer. Semantic commits enter bounded undo history;
 * measurements and previews update presentation without creating history.
 */
import type { BoardElement } from '@chalkboard/shared';

/** Committed history plus a sparse non-durable interaction preview. */
export interface EditorDocumentState {
  future: BoardElement[][];
  past: BoardElement[][];
  present: BoardElement[];
  /** Changed or newly drawn elements only; committed elements remain authoritative. */
  preview: BoardElement[] | null;
}

/** Exhaustive semantic and presentation-only document transitions. */
export type EditorDocumentAction =
  | { elements: BoardElement[]; type: 'commit' }
  | { height: number; id: string; type: 'measure'; width: number }
  | {
      measurements: { height: number; id: string; width: number }[];
      type: 'measure-many';
    }
  | { elements: BoardElement[]; type: 'preview' }
  | { elements: BoardElement[]; type: 'replace' }
  | { type: 'cancel-preview' }
  | { type: 'redo' }
  | { type: 'undo' };

/** Empty document with no history or interaction preview. */
export const initialEditorDocumentState: EditorDocumentState = {
  future: [],
  past: [],
  present: [],
  preview: null,
};

/** Maximum complete committed snapshots retained in either history direction. */
export const DOCUMENT_HISTORY_LIMIT = 100;

/** Applies one document transition while preserving identity for measurement no-ops. */
export function editorDocumentReducer(
  state: EditorDocumentState,
  action: EditorDocumentAction,
): EditorDocumentState {
  switch (action.type) {
    case 'preview':
      return { ...state, preview: action.elements };
    case 'measure':
    case 'measure-many': {
      const measurements = new Map(
        (action.type === 'measure-many' ? action.measurements : [action]).map(
          ({ id, width, height }) => [id, { height, width }],
        ),
      );
      const updateSize = (elements: BoardElement[]) => {
        let changed = false;
        const updated = elements.map((element) => {
          const measurement = measurements.get(element.id);
          if (
            measurement === undefined ||
            (measurement.height === element.height &&
              measurement.width === element.width)
          ) {
            return element;
          }
          changed = true;
          return { ...element, ...measurement };
        });
        return changed ? updated : elements;
      };
      const present = updateSize(state.present);
      const preview = state.preview === null ? null : updateSize(state.preview);
      return present === state.present && preview === state.preview
        ? state
        : { ...state, present, preview };
    }
    case 'cancel-preview':
      return { ...state, preview: null };
    case 'replace':
      return { ...state, present: action.elements, preview: null };
    case 'commit':
      return {
        future: [],
        past: [...state.past, state.present].slice(-DOCUMENT_HISTORY_LIMIT),
        present: action.elements,
        preview: null,
      };
    case 'undo': {
      const previous = state.past.at(-1);
      if (previous === undefined) return { ...state, preview: null };
      return {
        future: [state.present, ...state.future],
        past: state.past.slice(0, -1),
        present: previous,
        preview: null,
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (next === undefined) return { ...state, preview: null };
      return {
        future: state.future.slice(1),
        past: [...state.past, state.present].slice(-DOCUMENT_HISTORY_LIMIT),
        present: next,
        preview: null,
      };
    }
  }
}
