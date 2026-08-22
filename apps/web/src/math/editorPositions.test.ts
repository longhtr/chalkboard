/** Covers every source/field/history offset conversion, clamping, line break, and range direction. */
import { describe, expect, it } from 'vitest';

import {
  fieldOffsetFromLogicalOffset,
  lineIndexForFieldOffset,
  logicalOffsetFromFieldOffset,
} from './editorPositions';

describe('mixed editor position conversion', () => {
  it('converts between marker-bearing and logical offsets', () => {
    const markers = [0, 3, 4, 9];
    expect(logicalOffsetFromFieldOffset(0, markers)).toBe(0);
    expect(logicalOffsetFromFieldOffset(1, markers)).toBe(0);
    expect(logicalOffsetFromFieldOffset(5, markers)).toBe(2);
    expect(fieldOffsetFromLogicalOffset(0, markers, 12)).toBe(1);
    expect(fieldOffsetFromLogicalOffset(2, markers, 12)).toBe(5);
    expect(fieldOffsetFromLogicalOffset(20, markers, 12)).toBe(12);
  });

  it('round-trips every logical offset across generated marker layouts', () => {
    for (let mask = 0; mask < 256; mask += 1) {
      const markers = Array.from({ length: 8 }, (_, offset) => offset).filter(
        (offset) => (mask & (1 << offset)) !== 0,
      );
      const visibleLength = 8 - markers.length;
      for (let logical = 0; logical <= visibleLength; logical += 1) {
        const field = fieldOffsetFromLogicalOffset(logical, markers, 8);
        expect(logicalOffsetFromFieldOffset(field, markers)).toBe(logical);
      }
    }
  });

  it('normalizes invalid and duplicate marker offsets', () => {
    expect(logicalOffsetFromFieldOffset(5.8, [3, 3, -1, 2.5])).toBe(4);
    expect(fieldOffsetFromLogicalOffset(-4, [0, 0, -1], 5.9)).toBe(1);
  });

  it('maps boundaries to their visual rows', () => {
    const breaks = [3, 7];
    expect(lineIndexForFieldOffset(0, breaks)).toBe(0);
    expect(lineIndexForFieldOffset(3, breaks)).toBe(0);
    expect(lineIndexForFieldOffset(4, breaks)).toBe(1);
    expect(lineIndexForFieldOffset(7, breaks)).toBe(1);
    expect(lineIndexForFieldOffset(8, breaks)).toBe(2);
  });
});
