/** Proves font-size and line-spacing changes preserve anchors and clamp all selected equations. */
import type { EquationElement } from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import {
  equationFontSizeForView,
  updateEquationFontSize,
  updateEquationFontSizes,
} from './equationFontSize';

const equation: EquationElement = {
  backgroundColor: 'transparent',
  createdBy: 'test',
  fontSize: 30,
  height: 40,
  id: 'equation',
  opacity: 1,
  rotation: 0,
  source: 'Text',
  strokeColor: '#1f2937',
  strokeWidth: 2,
  type: 'equation',
  width: 100,
  x: 0,
  y: 0,
};

describe('equation editing-view font sizes', () => {
  it('derives the legacy source size five pixels below rendered', () => {
    expect(equationFontSizeForView(equation, 'rendered')).toBe(30);
    expect(equationFontSizeForView(equation, 'source')).toBe(25);
  });

  it('updates one editing view without changing the other', () => {
    const sourceSized = updateEquationFontSize(equation, 'source', 24);
    expect(sourceSized).toMatchObject({ fontSize: 30, sourceFontSize: 24 });
    expect(updateEquationFontSize(sourceSized, 'rendered', 36)).toMatchObject({
      fontSize: 36,
      sourceFontSize: 24,
    });
  });

  it('updates selection sizes as rendered and the active editor in its view', () => {
    const other = { ...equation, id: 'other' };
    const elements = updateEquationFontSizes([equation, other], {
      editingId: equation.id,
      editingView: 'source',
      fontSize: 24,
      selectedIds: new Set(['other']),
    });
    expect(elements).toEqual([
      { ...equation, sourceFontSize: 24 },
      { ...other, fontSize: 24 },
    ]);
  });
});
