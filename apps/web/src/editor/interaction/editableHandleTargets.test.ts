/** Proves direct handles appear only for the eligible single selection and retain preview identity. */
import type { ShapeElement } from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import { editableHandleTargets } from './editableHandleTargets';

const trapezoid: ShapeElement = {
  backgroundColor: 'transparent',
  cornerRadius: 0,
  createdBy: 'test',
  height: 80,
  id: 'trapezoid',
  opacity: 1,
  rotation: 0,
  shapeKind: 'trapezoid',
  strokeColor: '#1f2937',
  strokeWidth: 2,
  type: 'shape',
  width: 120,
  x: 0,
  y: 0,
};

describe('editable handle targets', () => {
  it('exposes a new trapezoid while the shape tool remains active', () => {
    expect(
      editableHandleTargets({
        activeTool: 'shape',
        recentlyCreated: trapezoid,
        selectedCount: 0,
        selectedElements: [],
        splinePreview: undefined,
      }),
    ).toEqual({
      elementsForManipulation: [trapezoid],
      trapezoidHandlePreview: trapezoid,
    });
  });

  it('gives an explicit selection priority over creation previews', () => {
    const selected = { ...trapezoid, id: 'selected' };
    expect(
      editableHandleTargets({
        activeTool: 'selection',
        recentlyCreated: trapezoid,
        selectedCount: 1,
        selectedElements: [selected],
        splinePreview: undefined,
      }),
    ).toEqual({
      elementsForManipulation: [selected],
      trapezoidHandlePreview: undefined,
    });
  });
});
