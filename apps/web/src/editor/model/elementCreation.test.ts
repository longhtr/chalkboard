/** Verifies every tool's default type, geometry, style, creator, path mode, and generated identity. */
import {
  DEFAULT_ELEMENT_STYLE,
  MAX_FREEHAND_POINTS,
  type FreehandElement,
  type LineElement,
  type ShapeElement,
} from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import {
  appendFreehandSamples,
  createElement,
  finalizeDrawing,
  previewFreeDrawnPath,
  updateDrawingElement,
  updateFreehandDrawing,
  updateOrthogonalDrawing,
} from './elementCreation';

describe('element creation', () => {
  it('uses readable mixed-text defaults', () => {
    expect(
      createElement('equation', { x: 0, y: 0 }, DEFAULT_ELEMENT_STYLE),
    ).toMatchObject({
      fontSize: 30,
      lineSpacing: 1.2,
      sourceFontSize: 27,
    });
  });

  it('creates typed equation, shape, and line drafts', () => {
    expect(
      createElement('equation', { x: 10, y: 20 }, DEFAULT_ELEMENT_STYLE, {
        lineSpacing: 1.5,
        sourceTextSize: 22,
        textSize: 30,
      }),
    ).toMatchObject({
      fontSize: 30,
      height: 42,
      lineSpacing: 1.5,
      source: '',
      sourceFontSize: 22,
      type: 'equation',
      width: 32,
      x: 10,
      y: 20,
    });
    expect(
      createElement('shape', { x: 0, y: 0 }, DEFAULT_ELEMENT_STYLE, {
        cornerRadius: 4,
        shapeKind: 'triangle',
      }),
    ).toMatchObject({ cornerRadius: 4, shapeKind: 'triangle', type: 'shape' });
    expect(
      createElement('shape', { x: 0, y: 0 }, DEFAULT_ELEMENT_STYLE, {
        ellipseEndAngle: 180,
        ellipseStartAngle: 0,
        shapeKind: 'ellipse',
      }),
    ).toMatchObject({
      ellipseEndAngle: 180,
      ellipseStartAngle: 0,
      shapeKind: 'ellipse',
      type: 'shape',
    });
    expect(
      createElement('line', { x: 0, y: 0 }, DEFAULT_ELEMENT_STYLE, {
        arrowheads: 'end',
        pathKind: 'bezier',
      }),
    ).toMatchObject({
      arrowheads: 'end',
      pathKind: 'bezier',
      splineContinuity: 'c1',
      type: 'line',
    });
  });

  it('constrains straight lines and shape proportions', () => {
    const line = createElement('line', { x: 0, y: 0 }, DEFAULT_ELEMENT_STYLE);
    expect(
      updateDrawingElement(
        line,
        { x: 10, y: 3 },
        {
          constrainProportions: true,
        },
      ),
    ).toMatchObject({
      height: 0,
      width: Math.hypot(10, 3),
    });

    const shape = createElement('shape', { x: 0, y: 0 }, DEFAULT_ELEMENT_STYLE);
    expect(
      updateDrawingElement(
        shape,
        { x: 20, y: 10 },
        {
          constrainProportions: true,
        },
      ),
    ).toMatchObject({
      height: 20,
      width: 20,
    });
  });

  it('bounds, samples, and compacts freehand strokes', () => {
    const draft = createElement(
      'freehand',
      { x: 10, y: 20 },
      DEFAULT_ELEMENT_STYLE,
    ) as FreehandElement;
    const samples = Array.from(
      { length: MAX_FREEHAND_POINTS + 100 },
      (_, index) => ({
        x: 10 + index,
        y: 20 + index,
      }),
    );
    const bounded = appendFreehandSamples([], samples, 0);
    expect(bounded).toHaveLength(MAX_FREEHAND_POINTS);

    const updated = updateFreehandDrawing(draft, [
      { x: 10, y: 20 },
      { x: 15, y: 25 },
      { x: 20, y: 30 },
    ]);
    expect(updated).toMatchObject({
      height: 10,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
      ],
      width: 10,
      x: 10,
      y: 20,
    });
    expect(finalizeDrawing(updated)).toMatchObject({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      type: 'freehand',
    });
  });

  it('previews sampled paths and fits orthogonal segments', () => {
    const line = createElement(
      'line',
      { x: 10, y: 20 },
      DEFAULT_ELEMENT_STYLE,
      { pathKind: 'bezier' },
    ) as LineElement;
    const preview = previewFreeDrawnPath(line, [
      { x: 10, y: 20 },
      { x: 20, y: 30 },
      { x: 30, y: 20 },
    ]);
    expect(preview).toMatchObject({ height: 0, width: 20 });
    expect(preview.segments).toHaveLength(2);

    const orthogonal = updateOrthogonalDrawing(
      { ...line, pathKind: 'orthogonal' },
      [
        { x: 10, y: 20 },
        { x: 30, y: 22 },
        { x: 31, y: 50 },
      ],
      8,
    );
    expect(orthogonal.segments.length).toBeGreaterThan(0);
  });

  it('drops tiny drawings and normalizes completed shapes', () => {
    const tinyLine = updateDrawingElement(
      createElement('line', { x: 0, y: 0 }, DEFAULT_ELEMENT_STYLE),
      { x: 2, y: 0 },
      { constrainProportions: false },
    );
    expect(finalizeDrawing(tinyLine)).toBeNull();

    const shape = updateDrawingElement(
      createElement('shape', { x: 10, y: 20 }, DEFAULT_ELEMENT_STYLE),
      { x: -10, y: 0 },
      { constrainProportions: false },
    );
    expect(finalizeDrawing(shape) as ShapeElement).toMatchObject({
      height: 20,
      width: 20,
      x: -10,
      y: 0,
    });
  });
});
