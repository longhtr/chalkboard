/** Proves renderer grouping preserves document order and creates boundaries only when renderer kind changes. */
import {
  DEFAULT_ELEMENT_STYLE,
  type BoardElement,
  type EquationElement,
  type ImageElement,
} from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import { groupContentLayers } from './contentLayers';

const rectangle = (id: string): BoardElement => ({
  ...DEFAULT_ELEMENT_STYLE,
  createdBy: 'test',
  height: 40,
  id,
  rotation: 0,
  type: 'rectangle',
  width: 80,
  x: 10,
  y: 20,
});

const image: ImageElement = {
  ...DEFAULT_ELEMENT_STYLE,
  createdBy: 'test',
  height: 40,
  id: 'image',
  name: 'image.png',
  rotation: 0,
  source: 'data:image/png;base64,',
  type: 'image',
  width: 80,
  x: 10,
  y: 20,
};

const equation: EquationElement = {
  ...DEFAULT_ELEMENT_STYLE,
  createdBy: 'test',
  fontSize: 25,
  height: 40,
  id: 'equation',
  lineSpacing: 1.2,
  rotation: 0,
  source: 'x',
  type: 'equation',
  width: 80,
  x: 10,
  y: 20,
};

describe('contentLayers', () => {
  it('groups only consecutive vector objects and preserves global layer order', () => {
    const layers = groupContentLayers([
      rectangle('back'),
      image,
      rectangle('middle-1'),
      rectangle('middle-2'),
      equation,
      rectangle('front'),
    ]);

    expect(
      layers.map((layer) => ({
        ids:
          layer.kind === 'canvas'
            ? layer.elements.map(({ id }) => id)
            : [layer.element.id],
        kind: layer.kind,
        order: layer.order,
      })),
    ).toEqual([
      { ids: ['back'], kind: 'canvas', order: 1 },
      { ids: ['image'], kind: 'image', order: 2 },
      { ids: ['middle-1', 'middle-2'], kind: 'canvas', order: 3 },
      { ids: ['equation'], kind: 'equation', order: 5 },
      { ids: ['front'], kind: 'canvas', order: 6 },
    ]);
  });
});
