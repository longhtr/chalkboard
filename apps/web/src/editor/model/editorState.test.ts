/** Proves commit/preview/measurement identity and the exact bounded undo/redo transaction model. */
import type { EquationElement, RectangleElement } from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import { requiredTestValue } from '../../test/assertions';
import { MAX_BOARD_ELEMENTS } from './limits';
import {
  DOCUMENT_HISTORY_LIMIT,
  editorDocumentReducer,
  initialEditorDocumentState,
  type EditorDocumentState,
} from './editorState';

const element: RectangleElement = {
  backgroundColor: 'transparent',
  createdBy: 'local',
  height: 50,
  id: 'one',
  opacity: 1,
  rotation: 0,
  strokeColor: '#111827',
  strokeWidth: 2,
  type: 'rectangle',
  width: 80,
  x: 0,
  y: 0,
};

describe('editorDocumentReducer', () => {
  it('commits, undoes, and redoes document changes', () => {
    const committed = editorDocumentReducer(initialEditorDocumentState, {
      type: 'commit',
      elements: [element],
    });
    const undone = editorDocumentReducer(committed, { type: 'undo' });
    const redone = editorDocumentReducer(undone, { type: 'redo' });

    expect(committed.present).toEqual([element]);
    expect(undone.present).toEqual([]);
    expect(redone.present).toEqual([element]);
  });

  it('retains exactly the latest 100 history transactions', () => {
    let state = initialEditorDocumentState;
    for (let index = 1; index <= 101; index += 1) {
      state = editorDocumentReducer(state, {
        type: 'commit',
        elements: [{ ...element, x: index }],
      });
    }

    expect(state.past).toHaveLength(100);
    for (let index = 0; index < 100; index += 1) {
      state = editorDocumentReducer(state, { type: 'undo' });
    }
    expect(requiredTestValue(state.present[0], 'oldest retained state').x).toBe(
      1,
    );
    expect(
      requiredTestValue(
        editorDocumentReducer(state, { type: 'undo' }).present[0],
        'state after exhausted undo',
      ).x,
    ).toBe(1);
    for (let index = 0; index < 100; index += 1) {
      state = editorDocumentReducer(state, { type: 'redo' });
    }
    expect(requiredTestValue(state.present[0], 'latest redone state').x).toBe(
      101,
    );
  });

  it('bounds 1,000-object style history on a maximum-size board', () => {
    const styledCount = 1_000;
    const original: RectangleElement[] = Array.from(
      { length: MAX_BOARD_ELEMENTS },
      (_, index) => ({
        ...element,
        id: `large-history-${index}`,
      }),
    );
    let state: EditorDocumentState = {
      ...initialEditorDocumentState,
      present: original,
    };

    for (
      let revision = 1;
      revision <= DOCUMENT_HISTORY_LIMIT + 1;
      revision += 1
    ) {
      state = editorDocumentReducer(state, {
        type: 'commit',
        elements: state.present.map((candidate, index) =>
          index < styledCount
            ? {
                ...candidate,
                strokeColor: revision % 2 === 0 ? '#1971c2' : '#e03131',
              }
            : candidate,
        ),
      });
    }

    expect(state.past).toHaveLength(DOCUMENT_HISTORY_LIMIT);
    expect(
      state.past.every(
        (snapshot) => snapshot[styledCount] === original[styledCount],
      ),
    ).toBe(true);

    for (let index = 0; index < DOCUMENT_HISTORY_LIMIT; index += 1) {
      state = editorDocumentReducer(state, { type: 'undo' });
    }
    expect(
      requiredTestValue(state.present[0], 'earliest styled state').strokeColor,
    ).toBe('#e03131');
    const earliestRetained = state.present;
    state = editorDocumentReducer(state, { type: 'undo' });
    expect(state.present).toBe(earliestRetained);

    for (let index = 0; index < DOCUMENT_HISTORY_LIMIT; index += 1) {
      state = editorDocumentReducer(state, { type: 'redo' });
    }
    expect(
      requiredTestValue(state.present[0], 'latest styled state').strokeColor,
    ).toBe('#e03131');
    expect(state.future).toEqual([]);
  });

  it('updates measured equation bounds without adding history', () => {
    const equation: EquationElement = {
      ...element,
      fontSize: 32,
      id: 'equation',
      source: '$x^2$',
      type: 'equation',
    };
    const committed = editorDocumentReducer(initialEditorDocumentState, {
      type: 'commit',
      elements: [equation],
    });
    const measured = editorDocumentReducer(committed, {
      type: 'measure',
      id: equation.id,
      width: 120,
      height: 42,
    });

    expect(measured.present[0]).toMatchObject({ width: 120, height: 42 });
    expect(measured.past).toHaveLength(1);
  });

  it('preserves document identity for redundant equation measurements', () => {
    const equation: EquationElement = {
      ...element,
      fontSize: 32,
      id: 'stable-equation',
      source: '$x$',
      type: 'equation',
    };
    const state = {
      ...initialEditorDocumentState,
      present: [equation],
      preview: [equation],
    };

    const measured = editorDocumentReducer(state, {
      type: 'measure-many',
      measurements: [
        {
          height: equation.height,
          id: equation.id,
          width: equation.width,
        },
      ],
    });

    expect(measured).toBe(state);
    expect(measured.present).toBe(state.present);
    expect(measured.preview).toBe(state.preview);
  });

  it('applies a frame of equation measurements in one document pass', () => {
    const equations = ['first', 'second'].map((id): EquationElement => ({
      ...element,
      fontSize: 32,
      id,
      source: `$${id}$`,
      type: 'equation',
    }));
    const committed = editorDocumentReducer(initialEditorDocumentState, {
      type: 'commit',
      elements: equations,
    });
    const measured = editorDocumentReducer(committed, {
      type: 'measure-many',
      measurements: [
        { height: 41, id: 'first', width: 101 },
        { height: 42, id: 'second', width: 102 },
      ],
    });

    expect(measured.present).toMatchObject([
      { height: 41, id: 'first', width: 101 },
      { height: 42, id: 'second', width: 102 },
    ]);
    expect(measured.past).toHaveLength(1);
  });

  it('does not add previews to history', () => {
    const preview = editorDocumentReducer(initialEditorDocumentState, {
      type: 'preview',
      elements: [element],
    });

    expect(preview.preview).toEqual([element]);
    expect(preview.past).toEqual([]);
    expect(preview.present).toEqual([]);
  });
});
