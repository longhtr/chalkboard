/** Covers source/rendered caret mapping through prose, math delimiters, escapes, styles, and multiline content. */
import { describe, expect, it } from 'vitest';

import {
  fieldOffsetForSourceOffset,
  sourceOffsetForFieldOffset,
  type SerializedCaretBoundary,
} from './sourceCaretMapping';

const source = String.raw`ab $\frac{x}{y}+z$ cd`;
const serializations: [string, string][] = [
  ['', String.raw`ab $ \frac{x}{y}+z $ cd`],
  ['a', String.raw`b $ \frac{x}{y}+z $ cd`],
  ['ab', String.raw` $ \frac{x}{y}+z $ cd`],
  ['ab ', String.raw`$ \frac{x}{y}+z $ cd`],
  ['ab ', String.raw`$ \frac{x}{y}+z $ cd`],
  ['ab $ x $', '$ y+z $ cd'],
  ['ab $ x $', '$ y+z $ cd'],
  ['ab $ xy $', '$ +z $ cd'],
  [String.raw`ab $ \frac{x}{y} $`, '$ +z $ cd'],
  [String.raw`ab $ \frac{x}{y}+ $`, '$ z $ cd'],
  [String.raw`ab $ \frac{x}{y}+z $`, ' cd'],
  [String.raw`ab $ \frac{x}{y}+z $ `, 'cd'],
  [String.raw`ab $ \frac{x}{y}+z $ c`, 'd'],
  [String.raw`ab $ \frac{x}{y}+z $ cd`, ''],
];
const boundaries: SerializedCaretBoundary[] = serializations.map(
  ([left, right], fieldOffset) => ({ fieldOffset, left, right }),
);

describe('source and rendered caret mapping', () => {
  it('maps plain-text boundaries exactly', () => {
    expect(fieldOffsetForSourceOffset(source, boundaries, 0)).toBe(0);
    expect(fieldOffsetForSourceOffset(source, boundaries, 2)).toBe(2);
    expect(sourceOffsetForFieldOffset(source, boundaries, 12)).toBe(
      source.indexOf('d'),
    );
  });

  it('maps LaTeX structure boundaries to their rendered atoms', () => {
    expect(
      fieldOffsetForSourceOffset(source, boundaries, source.indexOf('x')),
    ).toBe(4);
    expect(
      fieldOffsetForSourceOffset(source, boundaries, source.indexOf('y')),
    ).toBe(6);
    expect(
      fieldOffsetForSourceOffset(source, boundaries, source.indexOf('z')),
    ).toBe(9);
    expect(sourceOffsetForFieldOffset(source, boundaries, 6)).toBe(
      source.indexOf('y'),
    );
    expect(sourceOffsetForFieldOffset(source, boundaries, 9)).toBe(
      source.indexOf('z'),
    );
  });

  // The cases above name positions one at a time, which is how a mapping that
  // had stopped reaching most of its positions went on passing. These describe
  // the whole table instead. `equation-source-caret-reachability.spec.ts` runs
  // the same three against a real field, where the serialization is MathLive's
  // rather than this file's.
  it('gives every rendered position an offset of its own, in order', () => {
    const offsets = boundaries.map((boundary) =>
      sourceOffsetForFieldOffset(source, boundaries, boundary.fieldOffset),
    );
    expect(offsets).toStrictEqual([...offsets].sort((a, b) => a - b));
    expect(new Set(offsets).size).toBe(offsets.length);
    for (const offset of offsets) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(source.length);
    }
  });

  it('leaves no rendered position that source view cannot reach', () => {
    const reachable = new Set<number>();
    for (let offset = 0; offset <= source.length; offset += 1) {
      reachable.add(fieldOffsetForSourceOffset(source, boundaries, offset));
    }
    expect(
      boundaries
        .map((boundary) => boundary.fieldOffset)
        .filter((fieldOffset) => !reachable.has(fieldOffset)),
    ).toStrictEqual([]);
  });

  it('returns the caret to where it started after a round trip', () => {
    for (const boundary of boundaries) {
      const sourceOffset = sourceOffsetForFieldOffset(
        source,
        boundaries,
        boundary.fieldOffset,
      );
      expect(fieldOffsetForSourceOffset(source, boundaries, sourceOffset)).toBe(
        boundary.fieldOffset,
      );
    }
  });
});
