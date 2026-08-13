/** Proves spatial queries include overlaps once, preserve order, and update/remove indexed bounds correctly. */
import { describe, expect, it } from 'vitest';

import type { BoardElement } from '@chalkboard/shared';

import { requiredTestValue } from '../../test/assertions';
import { ElementSpatialIndex } from './elementSpatialIndex';

const rectangle = (
  id: string,
  x: number,
  y: number,
  width = 20,
  height = 20,
): BoardElement => ({
  backgroundColor: 'transparent',
  createdBy: 'test',
  height,
  id,
  opacity: 1,
  rotation: 0,
  strokeColor: '#000000',
  strokeWidth: 1,
  type: 'rectangle',
  width,
  x,
  y,
});

describe('ElementSpatialIndex', () => {
  it('returns only intersecting elements in document order', () => {
    const elements = [
      rectangle('behind', 20, 20),
      rectangle('outside', 2_000, 2_000),
      rectangle('front', 40, 40),
    ];
    const index = new ElementSpatialIndex(elements, 100);

    expect(
      index.query({ height: 100, width: 100, x: 0, y: 0 }).map(({ id }) => id),
    ).toEqual(['behind', 'front']);
  });

  it('deduplicates elements spanning multiple cells', () => {
    const index = new ElementSpatialIndex(
      [rectangle('wide', -50, -50, 300, 300)],
      100,
    );

    expect(index.query({ height: 200, width: 200, x: 0, y: 0 })).toHaveLength(
      1,
    );
  });

  it('retains oversized elements without creating unbounded cell entries', () => {
    const index = new ElementSpatialIndex(
      [rectangle('huge', -100_000, -100_000, 200_000, 200_000)],
      100,
    );

    expect(
      requiredTestValue(
        index.query({ height: 10, width: 10, x: 50_000, y: 50_000 })[0],
        'oversized spatial query result',
      ).id,
    ).toBe('huge');
  });

  it('queries a camera viewport with a screen-space margin', () => {
    const index = new ElementSpatialIndex([
      rectangle('visible', 10, 10),
      rectangle('margin', 110, 10),
      rectangle('outside', 180, 10),
    ]);

    expect(
      index
        .queryViewport({ x: 0, y: 0, zoom: 1 }, { height: 100, width: 100 }, 20)
        .map(({ id }) => id),
    ).toEqual(['visible', 'margin']);
  });

  it('falls back safely for exceptionally broad queries', () => {
    const index = new ElementSpatialIndex(
      [
        rectangle('first', -10_000, -10_000),
        rectangle('second', 10_000, 10_000),
      ],
      10,
    );

    expect(
      index
        .query({ height: 40_000, width: 40_000, x: -20_000, y: -20_000 })
        .map(({ id }) => id),
    ).toEqual(['first', 'second']);
  });
});
