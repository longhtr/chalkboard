/** Proves font-size and line-spacing changes preserve anchors and clamp all selected equations. */
import type { EquationElement } from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import {
  equationFontSizeForView,
  updateEquationFontSize,
  updateEquationFontSizes,
  materializeSourceFontSize,
  materializeSourceFontSizes,
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
  it('answers with the rendered size until a source size exists', () => {
    expect(equationFontSizeForView(equation, 'rendered')).toBe(30);
    expect(equationFontSizeForView(equation, 'source')).toBe(27);
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

describe('source font size materialization', () => {
  const block: EquationElement = {
    backgroundColor: 'transparent',
    createdBy: 'local',
    fontSize: 32,
    height: 100,
    id: 'block',
    lineSpacing: 1.2,
    opacity: 1,
    rotation: 0,
    source: 'x',
    strokeColor: '#1f2937',
    strokeWidth: 2,
    type: 'equation',
    width: 200,
    x: 0,
    y: 0,
  };

  it('starts the source view three smaller', () => {
    expect(equationFontSizeForView(block, 'source')).toBe(29);
    expect(equationFontSizeForView(block, 'rendered')).toBe(32);
  });

  it('writes the size down on the first view change', () => {
    const fixed = materializeSourceFontSize(block);
    expect(fixed.sourceFontSize).toBe(29);
    // Already fixed blocks keep the size they were given, identity included.
    expect(materializeSourceFontSize(fixed)).toBe(fixed);
    expect(
      materializeSourceFontSize({ ...block, sourceFontSize: 12 })
        .sourceFontSize,
    ).toBe(12);
  });

  it('stops the rendered size from dragging the source size with it', () => {
    const fixed = materializeSourceFontSize(block);
    const larger = updateEquationFontSize(fixed, 'rendered', 48);
    expect(larger.fontSize).toBe(48);
    expect(equationFontSizeForView(larger, 'source')).toBe(29);

    // Until the block has changed view the source size still follows.
    const untouched = updateEquationFontSize(block, 'rendered', 48);
    expect(equationFontSizeForView(untouched, 'source')).toBe(45);
  });

  it('keeps each view editable on its own once fixed', () => {
    const fixed = materializeSourceFontSize(block);
    const smallerSource = updateEquationFontSize(fixed, 'source', 18);
    expect(smallerSource.sourceFontSize).toBe(18);
    expect(smallerSource.fontSize).toBe(32);
  });

  it('fixes only the block being edited', () => {
    const other = { ...block, id: 'other' };
    const [edited, untouched] = materializeSourceFontSizes(
      [block, other],
      'block',
    ) as EquationElement[];
    expect(edited?.sourceFontSize).toBe(29);
    expect(untouched?.sourceFontSize).toBeUndefined();
    expect(materializeSourceFontSizes([block, other], null)).toEqual([
      block,
      other,
    ]);
  });
});
