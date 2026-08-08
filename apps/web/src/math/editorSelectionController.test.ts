/** Proves selection/history conversion, nearest pointer offsets, line constraints, overlay, and clearing. */
import type { MathfieldElement } from 'mathlive';
import { describe, expect, it, vi } from 'vitest';

import { EditorSelectionController } from './editorSelectionController';
import { MATHLIVE_BOLD_ON, MATHLIVE_LINE_BREAK } from './mixedMath';

function controllerFor(tokens: string[], position = 0) {
  const getOffsetFromPoint = vi.fn(() => 2);
  const field = {
    getOffsetFromPoint,
    getValue: ([start]: [number, number]) => tokens[start] ?? '',
    lastOffset: tokens.length,
    position,
    value: tokens.join(''),
  } as unknown as MathfieldElement;
  const selectionOverlay = document.createElement('div');
  const controller = new EditorSelectionController({
    decorateSpecialText: vi.fn(),
    elementId: 'equation-1',
    field,
    getSource: () => tokens.join(''),
    selectionOverlay,
  });
  return { controller, field, getOffsetFromPoint, selectionOverlay };
}

describe('active editor selection controller', () => {
  it('maps field positions around formatting markers and identifies line breaks', () => {
    const { controller } = controllerFor(
      ['a', MATHLIVE_BOLD_ON, 'b', MATHLIVE_LINE_BREAK, 'c'],
      3,
    );

    expect(controller.invisibleFormattingMarkerOffsets()).toEqual([1]);
    expect(controller.lineBreakOffsets()).toEqual([3]);
    expect(controller.historyPosition()).toBe(2);
    expect(controller.fieldPositionFromHistory(2)).toBe(3);
  });

  it('maps a point directly when there are no decorated line breaks', () => {
    const { controller, field, getOffsetFromPoint } = controllerFor([
      'a',
      'b',
      'c',
    ]);

    controller.positionAtPoint({ x: 12, y: 34 });

    expect(getOffsetFromPoint).toHaveBeenCalledWith(12, 34);
    expect(field.position).toBe(2);
  });

  it('clears custom pointer-selection geometry', () => {
    const { controller, selectionOverlay } = controllerFor(['a']);
    selectionOverlay.append(document.createElement('span'));

    controller.clearPointerSelection();

    expect(selectionOverlay.childElementCount).toBe(0);
  });
});
