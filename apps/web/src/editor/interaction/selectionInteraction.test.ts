/** Proves ordered selection transforms, proportional resize, minimum bounds, and document reordering. */
import type { BoardElement, ShapeElement } from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import { requiredTestValue } from '../../test/assertions';
import {
  applyElementChanges,
  moveSelectedElementsTo,
  reorderSelectedElements,
  translateSelectedElements,
  updateDraggingInteraction,
  updateResizingInteraction,
  type DraggingInteraction,
  type ResizingInteraction,
} from './selectionInteraction';

const shape: ShapeElement = {
  backgroundColor: 'transparent',
  cornerRadius: 0,
  createdBy: 'local',
  height: 50,
  id: 'shape',
  opacity: 1,
  rotation: 0,
  shapeKind: 'rectangle',
  strokeColor: '#1f2937',
  strokeStyle: 'solid',
  strokeWidth: 2,
  type: 'shape',
  width: 100,
  x: 10,
  y: 20,
};

function dragging(elements: BoardElement[]): DraggingInteraction {
  return {
    baseElements: elements,
    baseSelectedElements: elements.filter(({ id }) => id === 'shape'),
    changed: false,
    kind: 'dragging',
    latestElements: [],
    pointerId: 1,
    start: { x: 0, y: 0 },
  };
}

describe('selection interaction controller', () => {
  it('applies the drag threshold and restores a prior preview', () => {
    const current = dragging([shape]);
    expect(updateDraggingInteraction(current, { x: 2, y: 0 }, 1)).toBeNull();
    const preview = requiredTestValue(
      updateDraggingInteraction(current, { x: 10, y: 5 }, 1),
      'drag preview',
    );
    expect(preview[0]).toMatchObject({ x: 20, y: 25 });
    expect(current.changed).toBe(true);
    expect(updateDraggingInteraction(current, { x: 1, y: 0 }, 1)).toEqual([]);
    expect(current.changed).toBe(false);
  });

  it('bounds maximum-board drag previews by the 1,000-object selection', () => {
    const selected = Array.from({ length: 1_000 }, (_, index) => ({
      ...shape,
      id: `selected-${index}`,
      x: index,
    }));
    const stable = Array.from({ length: 9_000 }, (_, index) => ({
      ...shape,
      id: `stable-${index}`,
      x: 2_000 + index,
    }));
    const baseElements = [...selected, ...stable];
    const current: DraggingInteraction = {
      baseElements,
      baseSelectedElements: selected,
      changed: false,
      kind: 'dragging',
      latestElements: [],
      pointerId: 1,
      start: { x: 0, y: 0 },
    };

    const preview = requiredTestValue(
      updateDraggingInteraction(current, { x: 20, y: 10 }, 1),
      'maximum-selection drag preview',
    );
    expect(preview).toHaveLength(1_000);
    expect(preview[999]).toMatchObject({ x: 1_019, y: 30 });
    const committed = applyElementChanges(baseElements, preview);
    expect(committed).toHaveLength(10_000);
    expect(committed[1_000]).toBe(stable[0]);
  });

  it('materializes a sparse preview once without replacing stable objects', () => {
    const stable = { ...shape, id: 'stable', x: 500 };
    const moved = { ...shape, x: 50 };
    const materialized = applyElementChanges([shape, stable], [moved]);

    expect(materialized).toEqual([moved, stable]);
    expect(materialized[1]).toBe(stable);
  });

  it('translates a multi-selection while preserving stable objects and order', () => {
    const stable = { ...shape, id: 'stable', x: 500 };
    const second = { ...shape, id: 'second', x: 200, y: 100 };
    const elements = [shape, stable, second];

    const translated = translateSelectedElements(
      elements,
      new Set(['shape', 'second']),
      { x: -10, y: 1 },
    );
    expect(translated.map(({ id }) => id)).toEqual([
      'shape',
      'stable',
      'second',
    ]);
    expect(translated[0]).toMatchObject({ x: 0, y: 21 });
    expect(translated[1]).toBe(stable);
    expect(translated[2]).toMatchObject({ x: 190, y: 101 });
    expect(translateSelectedElements(elements, new Set(), { x: 1, y: 0 })).toBe(
      elements,
    );
    expect(
      translateSelectedElements(elements, new Set(['missing']), { x: 1, y: 0 }),
    ).toBe(elements);
  });

  it('moves one or more selected objects through bottom-to-top order', () => {
    const layers = ['bottom', 'lower', 'upper', 'top'].map((id) => ({
      ...shape,
      id,
    }));
    const selected = new Set(['lower', 'upper']);

    expect(
      reorderSelectedElements(layers, selected, 'forward').map(({ id }) => id),
    ).toEqual(['bottom', 'top', 'lower', 'upper']);
    expect(
      reorderSelectedElements(layers, selected, 'backward').map(({ id }) => id),
    ).toEqual(['lower', 'upper', 'bottom', 'top']);
    expect(
      reorderSelectedElements(layers, selected, 'to-front').map(({ id }) => id),
    ).toEqual(['bottom', 'top', 'lower', 'upper']);
    expect(
      reorderSelectedElements(layers, selected, 'to-back').map(({ id }) => id),
    ).toEqual(['lower', 'upper', 'bottom', 'top']);
  });

  it('places a dragged selection before or after a navigator target', () => {
    const layers = ['bottom', 'lower', 'upper', 'top'].map((id) => ({
      ...shape,
      id,
    }));
    const selected = new Set(['lower', 'upper']);

    expect(
      moveSelectedElementsTo(layers, selected, 'top', 'before').map(
        ({ id }) => id,
      ),
    ).toEqual(['bottom', 'top', 'lower', 'upper']);
    expect(
      moveSelectedElementsTo(layers, selected, 'bottom', 'after').map(
        ({ id }) => id,
      ),
    ).toEqual(['lower', 'upper', 'bottom', 'top']);
  });

  it('returns the existing array when an order command cannot move anything', () => {
    const layers = ['bottom', 'top'].map((id) => ({ ...shape, id }));
    expect(reorderSelectedElements(layers, new Set(['top']), 'forward')).toBe(
      layers,
    );
    expect(
      moveSelectedElementsTo(layers, new Set(['top']), 'top', 'before'),
    ).toBe(layers);
  });

  it('previews constrained selection resizing', () => {
    const elements = [shape];
    const current: ResizingInteraction = {
      baseElements: elements,
      baseSelectedElements: elements,
      changed: false,
      handle: 'south-east',
      kind: 'resizing',
      latestElements: [],
      pointerId: 1,
      selectedIds: new Set(['shape']),
      start: { x: 110, y: 70 },
      startFrame: {
        bounds: { height: 100, width: 100, x: 0, y: 0 },
        center: { x: 50, y: 50 },
        rotation: 0,
      },
      startBounds: { x: 10, y: 20, width: 100, height: 50 },
    };
    const preview = requiredTestValue(
      updateResizingInteraction(current, { x: 210, y: 170 }, 1, {
        preserveAspectRatio: true,
      }),
      'proportional resize preview',
    );
    expect(preview[0]).toMatchObject({
      height: 150,
      width: 300,
      x: 10,
      y: 20,
    });
    expect(current.changed).toBe(true);
  });
});
