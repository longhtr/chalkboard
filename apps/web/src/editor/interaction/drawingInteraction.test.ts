/** Exercises creation, pointer updates, finalization, cancellation, freehand bounds, and fitted path modes. */
import {
  DEFAULT_ELEMENT_STYLE,
  linePathPoints,
  type BoardElement,
  type LineElement,
} from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import { createElement } from '../model/elementCreation';
import {
  finalizeDrawingInteraction,
  updateDrawingInteraction,
  worldPointerSamples,
  type DrawingInteraction,
} from './drawingInteraction';

function interaction(draft: BoardElement): DrawingInteraction {
  return {
    baseElements: [],
    draft,
    kind: 'drawing',
    pointerId: 1,
    points: [{ x: 0, y: 0 }],
    start: { x: 0, y: 0 },
  };
}

describe('drawing interaction controller', () => {
  it('converts coalesced pointer samples into world coordinates', () => {
    const event = {
      getCoalescedEvents: () => [{ clientX: 30, clientY: 50 }],
    } as unknown as PointerEvent;
    expect(
      worldPointerSamples(
        event,
        { left: 10, top: 20 },
        { x: 5, y: 10, zoom: 2 },
        { x: 40, y: 50 },
      ),
    ).toEqual([
      { x: 7.5, y: 10 },
      { x: 40, y: 50 },
    ]);
  });

  it('keeps canonical Bézier input while compacting only its preview', () => {
    const draft = createElement('line', { x: 0, y: 0 }, DEFAULT_ELEMENT_STYLE, {
      pathKind: 'bezier',
    });
    const current = interaction(draft);
    const samples = Array.from({ length: 200 }, (_, index) => ({
      x: index + 1,
      y: (index + 1) * 0.25,
    }));

    const worldPoint = samples.at(-1);
    if (worldPoint === undefined) throw new Error('Expected generated samples');
    const preview = updateDrawingInteraction(current, {
      constrain: false,
      samples,
      worldPoint,
      zoom: 1,
    }) as LineElement;

    expect(current.points).toHaveLength(201);
    expect(preview.segments).toHaveLength(1);
  });

  it('bounds exceptionally long canonical Bézier gestures', () => {
    const draft = createElement('line', { x: 0, y: 0 }, DEFAULT_ELEMENT_STYLE, {
      pathKind: 'bezier',
    });
    const current = interaction(draft);
    const samples = Array.from({ length: 9_000 }, (_, index) => ({
      x: index * 0.75,
      y: 80 * Math.sin(index / 40),
    }));
    const worldPoint = samples.at(-1);
    if (worldPoint === undefined) throw new Error('Expected generated samples');
    updateDrawingInteraction(current, {
      constrain: false,
      samples,
      worldPoint,
      zoom: 1,
    });

    expect(current.points.length).toBeGreaterThan(2);
    expect(current.points.length).toBeLessThanOrEqual(4_096);
  });

  it('fits the same curve for slow dense and faster sparse input', () => {
    const drawArc = (sampleCount: number) => {
      const draft = createElement(
        'line',
        { x: 0, y: 0 },
        DEFAULT_ELEMENT_STYLE,
        { pathKind: 'bezier' },
      );
      const current = interaction(draft);
      for (let index = 1; index < sampleCount; index += 1) {
        const progress = index / (sampleCount - 1);
        const point = {
          x: progress * 650,
          y: -120 * Math.sin(Math.PI * progress),
        };
        updateDrawingInteraction(current, {
          constrain: false,
          samples: [point],
          worldPoint: point,
          zoom: 1,
        });
      }
      return finalizeDrawingInteraction(current, {
        fit: { accuracy: 1, continuity: 'c1', maxSegments: 8 },
        point: { x: 650, y: 0 },
        zoom: 1,
      }) as LineElement;
    };

    const sparse = drawArc(101);
    const dense = drawArc(1_001);
    const sparsePeak = Math.min(
      ...linePathPoints(sparse, 64).map(({ y }) => y),
    );
    const densePeak = Math.min(...linePathPoints(dense, 64).map(({ y }) => y));
    expect(sparsePeak).toBeLessThan(-115);
    expect(densePeak).toBeLessThan(-115);
    expect(Math.abs(sparsePeak - densePeak)).toBeLessThan(1);
  });

  it('previews and finalizes sampled Bézier drawing', () => {
    const draft = createElement('line', { x: 0, y: 0 }, DEFAULT_ELEMENT_STYLE, {
      pathKind: 'bezier',
    });
    const current = interaction(draft);
    const preview = updateDrawingInteraction(current, {
      constrain: false,
      samples: [
        { x: 20, y: 20 },
        { x: 50, y: -10 },
        { x: 80, y: 20 },
      ],
      worldPoint: { x: 80, y: 20 },
      zoom: 1,
    }) as LineElement;
    expect(preview.pathKind).toBe('bezier');
    expect(current.points).toHaveLength(4);

    const finalized = finalizeDrawingInteraction(current, {
      fit: { accuracy: 1, continuity: 'c1', maxSegments: 2 },
      point: { x: 100, y: 0 },
      zoom: 1,
    }) as LineElement;
    expect(finalized.type).toBe('line');
    expect(finalized.pathKind).toBe('bezier');
    expect(finalized.splineContinuity).toBe('c1');
    expect(finalized.segments.length).toBeGreaterThan(0);
    expect(finalized.segments.length).toBeLessThanOrEqual(2);
  });
});
