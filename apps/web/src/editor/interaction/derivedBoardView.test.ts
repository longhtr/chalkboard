/** Proves index reuse, ordered lookup, viewport queries, sparse overlays, and active-equation projection. */
import { describe, expect, it } from 'vitest';

import type { BoardElement, EquationElement } from '@chalkboard/shared';

import {
  createEditorDocumentModel,
  DerivedBoardView,
  editorDocumentModelReducer,
} from './derivedBoardView';

const rectangle = (id: string, x: number, y = 10): BoardElement => ({
  backgroundColor: 'transparent',
  createdBy: 'test',
  height: 20,
  id,
  opacity: 1,
  rotation: 0,
  strokeColor: '#000000',
  strokeWidth: 1,
  type: 'rectangle',
  width: 20,
  x,
  y,
});

const equation = (id: string, x: number): EquationElement => ({
  backgroundColor: 'transparent',
  createdBy: 'test',
  fontSize: 30,
  height: 20,
  id,
  lineSpacing: 1.2,
  opacity: 1,
  rotation: 0,
  source: id,
  strokeColor: '#000000',
  strokeWidth: 1,
  type: 'equation',
  width: 20,
  x,
  y: 10,
});

const camera = { x: 0, y: 0, zoom: 1 };
const viewport = { height: 100, width: 100 };

describe('DerivedBoardView', () => {
  it('updates committed indexes without rebuilding unchanged records', () => {
    const first = rectangle('one', 0);
    const second = rectangle('two', 100);
    const initial = createEditorDocumentModel([first, second]);
    const previewed = editorDocumentModelReducer(initial, {
      type: 'preview',
      elements: [{ ...first, x: 20 }],
    });
    const replacement = [{ ...first }, { ...second, x: 120 }];
    const replaced = editorDocumentModelReducer(previewed, {
      type: 'replace',
      elements: replacement,
    });

    expect(previewed.derivedBoardView).toBe(initial.derivedBoardView);
    expect(replaced.derivedBoardView).not.toBe(initial.derivedBoardView);
    expect(replaced.derivedBoardView.get('one')).toBe(first);
    expect(replaced.derivedBoardView.get('two')).toBe(replacement[1]);
  });

  it('reuses ID lookup and returns selected elements in document order', () => {
    const first = rectangle('first', 10);
    const second = rectangle('second', 20);
    const view = new DerivedBoardView([first, second]);

    expect(view.get('second')).toBe(second);
    expect(
      view
        .elementsForIds(['second', 'missing', 'first', 'second'])
        .map(({ id }) => id),
    ).toEqual(['first', 'second']);
  });

  it('overlays an edited element without scanning away document order', () => {
    const view = new DerivedBoardView([
      rectangle('first', 10),
      equation('edited', 500),
      rectangle('last', 30),
    ]);
    const replacement = { ...equation('edited', 20), source: 'draft' };

    expect(
      view
        .queryViewport(camera, viewport, 0, { replacement })
        .map(({ id }) => id),
    ).toEqual(['first', 'edited', 'last']);
    expect(
      view
        .queryViewport(camera, viewport, 0, {
          replacement: { ...replacement, x: 500 },
        })
        .map(({ id }) => id),
    ).toEqual(['first', 'last']);
  });

  it('overlays sparse moved and new previews in committed z-order', () => {
    const first = rectangle('first', 10);
    const moving = rectangle('moving', 500);
    const last = rectangle('last', 30);
    const view = new DerivedBoardView([first, moving, last]);
    const movedIn = { ...moving, x: 20 };
    const movedOut = { ...first, x: 500 };
    const draft = rectangle('new-draft', 40);

    expect(
      view
        .queryViewport(camera, viewport, 0, {
          replacements: [movedIn, movedOut, draft],
        })
        .map(({ id }) => id),
    ).toEqual(['moving', 'last', 'new-draft']);
    expect(
      view.elementsForIds(['moving', 'first'], [movedIn, movedOut]),
    ).toEqual([movedOut, movedIn]);
  });

  it('appends new drafts and can retain an offscreen active editor', () => {
    const view = new DerivedBoardView([rectangle('committed', 10)]);
    const draft = equation('new-draft', 500);

    expect(
      view
        .queryViewport(camera, viewport, 0, { replacement: draft })
        .map(({ id }) => id),
    ).toEqual(['committed']);
    expect(
      view
        .queryViewport(camera, viewport, 0, {
          replacement: draft,
          retainReplacement: true,
        })
        .map(({ id }) => id),
    ).toEqual(['committed', 'new-draft']);
  });

  it('incrementally overlays one semantic change on a cloned maximum-size board', () => {
    const elements = Array.from({ length: 10_000 }, (_, index) =>
      rectangle(`large-${index}`, 20_000 + index * 30),
    );
    const original = new DerivedBoardView(elements);
    const next = elements.map((element) => ({ ...element }));
    const finalElement = next[9_999];
    if (finalElement === undefined) {
      throw new Error('Expected the maximum-size board fixture to be complete');
    }
    next[9_999] = { ...finalElement, x: 20 };

    const derived = DerivedBoardView.derive(next, original);

    expect(derived).not.toBe(original);
    expect(derived.get('large-0')).toBe(elements[0]);
    expect(derived.get('large-9999')).toBe(next[9_999]);
    expect(derived.queryViewport(camera, viewport).map(({ id }) => id)).toEqual(
      ['large-9999'],
    );
  });

  it('updates equation lookup and order without replacing unchanged equations', () => {
    const first = equation('first-equation', 10);
    const later = equation('later-equation', 30);
    const elements = [first, rectangle('middle', 20), later];
    const original = new DerivedBoardView(elements);
    const changed = { ...first, source: 'changed' };
    const middle = elements[1];
    if (middle === undefined)
      throw new Error('Expected middle element fixture');
    const next = [changed, { ...middle }, { ...later }];

    const derived = DerivedBoardView.derive(next, original);

    expect(derived.equationElements()).toEqual([changed, later]);
    expect(derived.equationElements()[1]).toBe(later);
    expect(
      derived.elementsForIds(['later-equation', 'first-equation']),
    ).toEqual([changed, later]);
  });

  it('falls back to a full rebuild after the incremental overlay bound', () => {
    const elements = Array.from({ length: 514 }, (_, index) =>
      rectangle(`bounded-${index}`, index * 30),
    );
    const original = new DerivedBoardView(elements);
    const next = elements.map((element, index) => ({
      ...element,
      x: index < 513 ? element.x + 1 : element.x,
    }));

    const derived = DerivedBoardView.derive(next, original);

    expect(derived.get('bounded-513')).toBe(next[513]);
  });

  it('reuses a derived view when cloned records are semantically unchanged', () => {
    const elements = [
      rectangle('rectangle', 10),
      {
        ...rectangle('freehand', 20),
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        type: 'freehand' as const,
      },
    ];
    const original = new DerivedBoardView(elements);
    const clones = structuredClone(elements);

    expect(DerivedBoardView.derive(clones, original)).toBe(original);
  });

  it('materializes one active draft for every derived collection', () => {
    const original = equation('equation', 10);
    const later = equation('later-equation', 30);
    const view = new DerivedBoardView([
      original,
      rectangle('middle', 20),
      later,
    ]);
    const draft = view.activeEquation({
      draft: original,
      height: 40,
      id: original.id,
      isNew: false,
      source: 'updated',
      width: 80,
    });

    expect(draft).toMatchObject({
      height: 40,
      source: 'updated',
      width: 80,
    });
    if (draft === undefined) throw new Error('Active draft is required');
    expect(view.overlayDraft([original, later], draft)).toEqual([draft, later]);
    expect(view.elementsForIds(['equation'], [draft])).toEqual([draft]);
    expect(view.equationElements(draft).map(({ source }) => source)).toEqual([
      'updated',
      'later-equation',
    ]);
  });
});
