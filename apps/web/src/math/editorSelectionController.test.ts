/** Proves selection/history conversion, nearest pointer offsets, line constraints, overlay, and clearing. */
import type { MathfieldElement } from 'mathlive';
import { describe, expect, it } from 'vitest';

import { EditorSelectionController } from './editorSelectionController';
import { MATHLIVE_BOLD_ON, MATHLIVE_LINE_BREAK } from './mixedMath';

interface FakeBounds {
  bottom: number;
  depth?: number;
  left: number;
  right: number;
  top: number;
}

const ROW_TOP = 100;
const ROW_BOTTOM = 120;

/**
 * One row of fixed-width cells starting at x=0. MathLive's rect for an offset
 * belongs to the element before it, so offset N's caret sits at N*width and
 * offset 0 carries the degenerate box that precedes the first character.
 */
function rowBounds(tokens: string[], width = 10): (FakeBounds | undefined)[] {
  return tokens.map((_token, index) => ({
    bottom: ROW_BOTTOM,
    left: Math.max(0, (index - 1) * width),
    right: index * width,
    top: ROW_TOP,
  }));
}

/** A `.ML__base` wide enough for the horizontal hit-test probe to be decisive. */
function fakeShadowRoot(width: number): ShadowRoot {
  const root = document.createElement('div');
  const base = document.createElement('span');
  base.className = 'ML__base';
  base.getBoundingClientRect = () =>
    ({
      bottom: ROW_BOTTOM,
      height: ROW_BOTTOM - ROW_TOP,
      left: 0,
      right: width,
      top: ROW_TOP,
      width,
      x: 0,
      y: ROW_TOP,
    }) as DOMRect;
  root.append(base);
  return root as unknown as ShadowRoot;
}

function controllerFor(
  tokens: string[],
  position = 0,
  bounds: (FakeBounds | undefined)[] = rowBounds(tokens),
  // Gecko's defect by default: one fixed offset regardless of the point, which
  // is what the probe detects and what routes mapping through the geometry.
  hitTest: (x: number, y: number) => number = () => tokens.length,
) {
  const listeners = new Map<string, Set<EventListener>>();
  const field = {
    addEventListener: (type: string, listener: EventListener) => {
      const existing = listeners.get(type) ?? new Set<EventListener>();
      existing.add(listener);
      listeners.set(type, existing);
    },
    dispatchEvent: (event: Event) => {
      listeners.get(event.type)?.forEach((listener) => listener(event));
      return true;
    },
    removeEventListener: (type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    },
    getElementInfo: (offset: number) => {
      const box = bounds[offset];
      return box === undefined
        ? undefined
        : { bounds: box, depth: box.depth ?? 0 };
    },
    getOffsetFromPoint: hitTest,
    getValue: ([start]: [number, number]) => tokens[start] ?? '',
    get lastOffset() {
      return tokens.length;
    },
    position,
    shadowRoot: fakeShadowRoot(tokens.length * 10 + 40),
    value: tokens.join(''),
  } as unknown as MathfieldElement;
  const selectionOverlay = document.createElement('div');
  const controller = new EditorSelectionController({
    elementId: 'equation-1',
    field,
    getSource: () => tokens.join(''),
    selectionOverlay,
  });
  return { controller, field, selectionOverlay };
}

describe('active editor selection controller', () => {
  it('rescans sentinels after the document changes', () => {
    const tokens = ['a', MATHLIVE_BOLD_ON, 'b'];
    const { controller, field } = controllerFor(tokens);
    expect(controller.invisibleFormattingMarkerOffsets()).toEqual([1]);

    // Gaining an atom changes `lastOffset`, which is the scan's identity.
    tokens.push(MATHLIVE_LINE_BREAK);
    expect(controller.lineBreakOffsets()).toEqual([3]);

    // Replacing a sentinel in place keeps the count, so the field's own input
    // event is what has to drop the scan.
    tokens[1] = 'x';
    expect(controller.invisibleFormattingMarkerOffsets()).toEqual([1]);
    field.dispatchEvent(new Event('input'));
    expect(controller.invisibleFormattingMarkerOffsets()).toEqual([]);

    // And an explicit replacement of the whole document does the same.
    tokens[0] = MATHLIVE_BOLD_ON;
    expect(controller.invisibleFormattingMarkerOffsets()).toEqual([]);
    controller.invalidateDocument();
    expect(controller.invisibleFormattingMarkerOffsets()).toEqual([0]);

    // Nothing survives the task that filled it.
    tokens[2] = MATHLIVE_BOLD_ON;
    return Promise.resolve().then(() => {
      expect(controller.invisibleFormattingMarkerOffsets()).toEqual([0, 2]);
    });
  });

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

  it('places the caret at the character boundary nearest the point', () => {
    const { controller, field } = controllerFor(['a', 'b', 'c']);

    controller.positionAtPoint({ x: 2, y: 110 });
    expect(field.position).toBe(0);

    controller.positionAtPoint({ x: 12, y: 110 });
    expect(field.position).toBe(1);

    controller.positionAtPoint({ x: 22, y: 110 });
    expect(field.position).toBe(2);
  });

  it('resolves every horizontal position on a row rather than one fixed offset', () => {
    // Gecko's `getOffsetFromPoint` answered a single near-final offset for every
    // point on a row, which dropped the caret at the end of the line no matter
    // where the click landed. Distinct columns must resolve to distinct offsets.
    const tokens = Array.from({ length: 12 }, (_item, index) => `${index}`);
    const { controller } = controllerFor(tokens);

    const offsets = [5, 25, 45, 65, 85].map((x) =>
      controller.offsetForPoint({ x, y: 110 }),
    );

    expect(offsets).toEqual([0, 2, 4, 6, 8]);
  });

  it('keeps the engine hit-test when it reads the horizontal coordinate', () => {
    // MathLive resolves structure the geometry cannot reach, such as an empty
    // fraction branch that holds a caret but has no element of its own, so a
    // working hit-test stays authoritative.
    const tokens = Array.from({ length: 12 }, (_item, index) => `${index}`);
    const { controller } = controllerFor(tokens, 0, undefined, (x) =>
      Math.round(x / 10),
    );

    expect(controller.offsetForPoint({ x: 74, y: 110 })).toBe(7);
  });

  it('prefers the stacked row the point falls in over a nearer column', () => {
    // A fraction's numerator and denominator share a horizontal span, so the
    // vertical coordinate has to decide between them.
    const { controller } = controllerFor(['n', 'd'], 0, [
      { bottom: 100, left: 0, right: 20, top: 80 },
      { bottom: 140, left: 0, right: 22, top: 120 },
    ]);

    expect(controller.offsetForPoint({ x: 21, y: 90 })).toBe(0);
    expect(controller.offsetForPoint({ x: 21, y: 130 })).toBe(1);
  });

  it('prefers a nested empty branch away from an outer container edge', () => {
    const { controller } = controllerFor(['', 'a', '', '', ''], 0, [
      { bottom: 128, depth: 0, left: -1, right: 0, top: 86 },
      { bottom: 113, depth: 1, left: 2, right: 4, top: 71 },
      { bottom: 113, depth: 1, left: 4, right: 22, top: 71 },
      { bottom: 117, depth: 1, left: 4, right: 22, top: 80 },
      { bottom: 137, depth: 0, left: 0, right: 25, top: 80 },
    ]);

    controller.positionAtPoint({ x: 14, y: 121 });
    expect(controller.historyPosition()).toBe(3);
    controller.positionAtPoint({ x: 24, y: 110 });
    expect(controller.historyPosition()).toBe(4);
  });

  it('falls back to the line start when no offset can be measured', () => {
    const { controller } = controllerFor(['a', 'b'], 0, [undefined, undefined]);

    expect(controller.offsetForPoint({ x: 40, y: 110 })).toBe(0);
  });

  it('clears custom pointer-selection geometry', () => {
    const { controller, selectionOverlay } = controllerFor(['a']);
    selectionOverlay.append(document.createElement('span'));

    controller.clearPointerSelection();

    expect(selectionOverlay.childElementCount).toBe(0);
  });
});
