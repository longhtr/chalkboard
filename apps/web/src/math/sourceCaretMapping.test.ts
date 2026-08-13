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
});
