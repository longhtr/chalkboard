/**
 * Uniform-grid index for nearby-element lookup. Elements spanning multiple cells
 * retain one canonical record and query results are deduplicated in board order.
 */
import {
  boundsIntersect,
  elementBounds,
  type BoardElement,
  type Bounds,
  type Camera,
} from '@chalkboard/shared';

import { worldViewportBounds, type ViewportSize } from './viewportCulling';

const DEFAULT_CELL_SIZE = 512;
const MAX_CELLS_PER_ELEMENT = 256;
const MAX_CELLS_PER_QUERY = 1_024;

interface IndexedElement {
  bounds: Bounds;
  element: BoardElement;
  order: number;
}

function cellRange(bounds: Bounds, cellSize: number) {
  const minimumX = Math.floor(bounds.x / cellSize);
  const minimumY = Math.floor(bounds.y / cellSize);
  const maximumX = Math.floor((bounds.x + bounds.width) / cellSize);
  const maximumY = Math.floor((bounds.y + bounds.height) / cellSize);
  return {
    cells: (maximumX - minimumX + 1) * (maximumY - minimumY + 1),
    maximumX,
    maximumY,
    minimumX,
    minimumY,
  };
}

function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

/**
 * Immutable uniform-grid index for committed board elements. It preserves
 * document order and falls back to a bounded full scan for unusually large
 * viewports or elements instead of allocating an unbounded number of cells.
 */
export class ElementSpatialIndex {
  private readonly cells = new Map<string, number[]>();
  private readonly entries: IndexedElement[];
  private readonly oversized: number[] = [];

  constructor(
    elements: readonly BoardElement[],
    private readonly cellSize = DEFAULT_CELL_SIZE,
  ) {
    this.entries = elements.map((element, order) => ({
      bounds: elementBounds(element),
      element,
      order,
    }));

    for (const entry of this.entries) {
      const range = cellRange(entry.bounds, this.cellSize);
      if (range.cells > MAX_CELLS_PER_ELEMENT) {
        this.oversized.push(entry.order);
        continue;
      }
      for (let x = range.minimumX; x <= range.maximumX; x += 1) {
        for (let y = range.minimumY; y <= range.maximumY; y += 1) {
          const key = cellKey(x, y);
          const bucket = this.cells.get(key);
          if (bucket === undefined) this.cells.set(key, [entry.order]);
          else bucket.push(entry.order);
        }
      }
    }
  }

  query(bounds: Bounds): BoardElement[] {
    const range = cellRange(bounds, this.cellSize);
    if (range.cells > MAX_CELLS_PER_QUERY) {
      return this.entries
        .filter((entry) => boundsIntersect(entry.bounds, bounds))
        .map(({ element }) => element);
    }

    const candidates = new Set(this.oversized);
    for (let x = range.minimumX; x <= range.maximumX; x += 1) {
      for (let y = range.minimumY; y <= range.maximumY; y += 1) {
        for (const order of this.cells.get(cellKey(x, y)) ?? []) {
          candidates.add(order);
        }
      }
    }

    return [...candidates]
      .sort((first, second) => first - second)
      .map((order) => this.entries[order])
      .filter(
        (entry): entry is IndexedElement =>
          entry !== undefined && boundsIntersect(entry.bounds, bounds),
      )
      .map(({ element }) => element);
  }

  queryViewport(
    camera: Camera,
    viewport: ViewportSize,
    screenMargin = 0,
  ): BoardElement[] {
    return this.query(worldViewportBounds(camera, viewport, screenMargin));
  }
}
