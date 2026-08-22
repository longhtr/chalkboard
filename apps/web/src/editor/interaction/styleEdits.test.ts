/** Proves inspector transformations target only selected elements and preserve no-op identity. */
import {
  DEFAULT_ELEMENT_STYLE,
  type FreehandElement,
  type LineElement,
  type ShapeElement,
} from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import { requiredTestValue } from '../../test/assertions';
import {
  updateBezierContinuity,
  updateElementStyles,
  updateEllipseArc,
  updateLineArrowheads,
  updateLinePathKind,
  updateShapeProperties,
} from './styleEdits';

const shape: ShapeElement = {
  ...DEFAULT_ELEMENT_STYLE,
  cornerRadius: 0,
  createdBy: 'test',
  height: 40,
  id: 'shape',
  opacity: 1,
  rotation: 0,
  shapeKind: 'rectangle',
  type: 'shape',
  width: 60,
  x: 0,
  y: 0,
};

const line: LineElement = {
  ...DEFAULT_ELEMENT_STYLE,
  arrowheads: 'none',
  createdBy: 'test',
  height: 30,
  id: 'line',
  opacity: 1,
  pathKind: 'straight',
  rotation: 0,
  segments: [
    {
      control1: { x: 20, y: 10 },
      control2: { x: 40, y: 20 },
      end: { x: 60, y: 30 },
    },
  ],
  type: 'line',
  width: 60,
  x: 0,
  y: 0,
};

const freehand: FreehandElement = {
  ...DEFAULT_ELEMENT_STYLE,
  arrowheads: 'none',
  createdBy: 'test',
  height: 0,
  id: 'freehand',
  opacity: 1,
  points: [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
  ],
  rotation: 0,
  type: 'freehand',
  width: 40,
  x: 0,
  y: 0,
};

const selectedLine = new Set(['line']);
const selectedShape = new Set(['shape']);
const selectedFreehand = new Set(['freehand']);

describe('selected element style edits', () => {
  it('updates only targeted styles and returns null for an identical request', () => {
    const updated = updateElementStyles([shape, line], selectedShape, {
      strokeColor: '#e03131',
    });

    const elements = requiredTestValue(updated, 'updated style elements');
    expect(elements[0]).toMatchObject({
      id: 'shape',
      strokeColor: '#e03131',
    });
    expect(elements[1]).toBe(line);
    expect(
      updateElementStyles(elements, selectedShape, {
        strokeColor: '#e03131',
      }),
    ).toBeNull();
  });

  it('updates only modern shape properties', () => {
    const updated = updateShapeProperties([shape, line], selectedShape, {
      cornerRadius: 8,
      shapeKind: 'diamond',
    });

    const elements = requiredTestValue(updated, 'updated shape elements');
    expect(elements[0]).toMatchObject({
      cornerRadius: 8,
      shapeKind: 'diamond',
    });
    expect(elements[1]).toBe(line);
  });

  it('applies arc ranges only to selected ellipses', () => {
    const ellipse = { ...shape, shapeKind: 'ellipse' as const };
    const rectangle = { ...shape, id: 'rectangle' };
    const updated = updateEllipseArc(
      [ellipse, rectangle],
      new Set(['shape', 'rectangle']),
      { ellipseEndAngle: 180, ellipseStartAngle: 0 },
    );

    const elements = requiredTestValue(updated, 'updated ellipse elements');
    expect(elements[0]).toMatchObject({
      ellipseEndAngle: 180,
      ellipseStartAngle: 0,
    });
    expect(elements[1]).toBe(rectangle);
  });

  it('converts line paths and removes curve continuity when leaving Bézier mode', () => {
    const curved = updateLinePathKind(
      [shape, line],
      selectedLine,
      'bezier',
      'c1',
    );
    const curvedElements = requiredTestValue(curved, 'curved line elements');
    expect(curvedElements[1]).toMatchObject({
      pathKind: 'bezier',
      splineContinuity: 'c1',
    });

    const straight = updateLinePathKind(
      curvedElements,
      selectedLine,
      'straight',
      'c1',
    );
    const straightElements = requiredTestValue(
      straight,
      'straight line elements',
    );
    expect(straightElements[1]).toMatchObject({ pathKind: 'straight' });
    expect(straightElements[1]).not.toHaveProperty('splineContinuity');
  });

  it('updates Bézier continuity and arrowheads without replacing other elements', () => {
    const curved = { ...line, pathKind: 'bezier' as const };
    const continuous = updateBezierContinuity(
      [shape, curved],
      selectedLine,
      'c1',
    );
    const continuousElements = requiredTestValue(
      continuous,
      'continuous line elements',
    );
    expect(continuousElements[1]).toMatchObject({ splineContinuity: 'c1' });
    expect(continuousElements[0]).toBe(shape);

    const decorated = updateLineArrowheads(
      continuousElements,
      selectedLine,
      'both',
    );
    const decoratedElements = requiredTestValue(
      decorated,
      'decorated line elements',
    );
    expect(decoratedElements[1]).toMatchObject({ arrowheads: 'both' });
    expect(decoratedElements[0]).toBe(shape);
  });

  it('decorates a selected freehand stroke and leaves other paths alone', () => {
    const decorated = updateLineArrowheads(
      [line, freehand],
      selectedFreehand,
      'end',
    );
    const elements = requiredTestValue(decorated, 'decorated elements');

    expect(elements[1]).toMatchObject({ arrowheads: 'end', type: 'freehand' });
    expect(elements[0]).toBe(line);
    expect(updateLineArrowheads(elements, selectedFreehand, 'end')).toBeNull();
  });
});
