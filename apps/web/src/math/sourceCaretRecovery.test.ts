/**
 * The caret mapping must stay usable when its two inputs disagree.
 *
 * Alignment is an assumption, and assumptions fail: a block can be restored
 * from an older archive, arrive from a collaborator running a different
 * version, carry sentinels a paste left behind, or meet a MathLive whose
 * serialization has changed. The mapping cannot tell any of those from writing
 * it has not reached, so the answer cannot be to detect them -- it is to make
 * the result safe no matter how badly the match went.
 *
 * These feed deliberately disagreeing inputs and demand the properties a caret
 * depends on anyway: an offset inside the document, order that follows the
 * positions, and every position reachable while the document has room. A
 * degraded mapping puts the caret in a duller place; it must never put it
 * outside the document, behind its neighbour, or nowhere at all.
 */
import { describe, expect, it } from 'vitest';

import {
  fieldOffsetForSourceOffset,
  sourceOffsetForFieldOffset,
  type SerializedCaretBoundary,
} from './sourceCaretMapping';

function boundariesFrom(
  serializations: readonly (readonly [string, string])[],
): SerializedCaretBoundary[] {
  return serializations.map(([left, right], fieldOffset) => ({
    fieldOffset,
    left,
    right,
  }));
}

/** Splits a value at every offset, the way a real field's table is built. */
function tableFor(value: string): SerializedCaretBoundary[] {
  return boundariesFrom(
    Array.from(
      { length: value.length + 1 },
      (_entry, offset) =>
        [value.slice(0, offset), value.slice(offset)] as const,
    ),
  );
}

const document = String.raw`Let $u=1+e^{-z}$ and note $\frac{a}{b}$.`;

const disagreements: Record<string, SerializedCaretBoundary[]> = {
  'a table describing an entirely different document': tableFor(
    String.raw`Nothing $\alpha$ in common $\beta$ whatsoever.`,
  ),
  'boundaries whose halves contradict each other': boundariesFrom([
    ['zzz', 'zzz'],
    ['Let $ u $', 'aaa'],
    ['qqq', String.raw`$ \frac{a}{b} $.`],
    ['', ''],
  ]),
  'empty serializations throughout': boundariesFrom([
    ['', ''],
    ['', ''],
    ['', ''],
  ]),
  'one boundary only': boundariesFrom([['', '']]),
  'raw sentinels left in by a paste': boundariesFrom([
    ['', 'Let ⁣⁦ something ⁫'],
    ['Let ⁥', '⁤ something'],
    ['Let ⁣⁦ something ⁫', ''],
  ]),
  'reversed and duplicated serializations': boundariesFrom([
    [String.raw`Let $ u=1+e^{-z} $ and note $ \frac{a}{b} $.`, ''],
    ['Let', ' and note'],
    ['Let', ' and note'],
    ['', String.raw`Let $ u=1+e^{-z} $ and note $ \frac{a}{b} $.`],
  ]),
};

describe('caret mapping when source and serialization disagree', () => {
  for (const [name, boundaries] of Object.entries(disagreements)) {
    describe(name, () => {
      it('answers inside the document and in order', () => {
        const offsets = boundaries.map((boundary) =>
          sourceOffsetForFieldOffset(
            document,
            boundaries,
            boundary.fieldOffset,
          ),
        );
        for (const offset of offsets) {
          expect(Number.isInteger(offset)).toBe(true);
          expect(offset).toBeGreaterThanOrEqual(0);
          expect(offset).toBeLessThanOrEqual(document.length);
        }
        expect(offsets).toStrictEqual([...offsets].sort((a, b) => a - b));
      });

      it('reaches as many positions as the document can address', () => {
        const offsets = boundaries.map((boundary) =>
          sourceOffsetForFieldOffset(
            document,
            boundaries,
            boundary.fieldOffset,
          ),
        );
        // A document of n characters addresses n+1 places, so it cannot
        // separate more positions than that however good the match was. Short
        // of that ceiling every position must still get its own.
        expect(new Set(offsets).size).toBe(
          Math.min(boundaries.length, document.length + 1),
        );
        const reachable = new Set<number>();
        for (let offset = 0; offset <= document.length; offset += 1) {
          reachable.add(
            fieldOffsetForSourceOffset(document, boundaries, offset),
          );
        }
        expect(reachable.size).toBe(new Set(offsets).size);
      });

      it('returns a caret to a position describing the same place', () => {
        for (const boundary of boundaries) {
          const offset = sourceOffsetForFieldOffset(
            document,
            boundaries,
            boundary.fieldOffset,
          );
          const returned = fieldOffsetForSourceOffset(
            document,
            boundaries,
            offset,
          );
          // Identity where the document had room to separate the two, and
          // otherwise a position resolving to the same offset, which is the
          // most a document that cannot tell them apart can promise.
          expect(
            sourceOffsetForFieldOffset(document, boundaries, returned),
          ).toBe(offset);
        }
      });
    });
  }

  it('stays inside a document with fewer offsets than positions', () => {
    const tiny = 'ab';
    const boundaries = boundariesFrom(
      Array.from({ length: 12 }, () => ['x', 'y'] as const),
    );
    const offsets = boundaries.map((boundary) =>
      sourceOffsetForFieldOffset(tiny, boundaries, boundary.fieldOffset),
    );
    for (const offset of offsets) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(tiny.length);
    }
    expect(offsets).toStrictEqual([...offsets].sort((a, b) => a - b));
  });

  it('answers for an empty document', () => {
    const boundaries = tableFor('abc');
    for (const boundary of boundaries) {
      expect(
        sourceOffsetForFieldOffset('', boundaries, boundary.fieldOffset),
      ).toBe(0);
    }
    expect(
      fieldOffsetForSourceOffset('', boundaries, 5),
    ).toBeGreaterThanOrEqual(0);
  });

  it('keeps its promises on a block too long to measure exactly', () => {
    // Past the search budget most positions are interpolated rather than
    // matched, so this is the path a very long block actually takes. The caret
    // lands less precisely there; it must still land somewhere real, in order,
    // and on a position of its own.
    const long = Array.from(
      { length: 120 },
      (_entry, row) =>
        String.raw`Row ${row} with $\frac{a_{${row}}}{b}$ in it.`,
    ).join('\n');
    const boundaries = tableFor(long);
    expect(boundaries.length * long.length).toBeGreaterThan(400_000);

    const offsets = boundaries.map((boundary) =>
      sourceOffsetForFieldOffset(long, boundaries, boundary.fieldOffset),
    );
    for (const offset of offsets) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(long.length);
    }
    expect(offsets).toStrictEqual([...offsets].sort((a, b) => a - b));
    expect(new Set(offsets).size).toBe(
      Math.min(boundaries.length, long.length + 1),
    );
  });

  it('answers when there are no boundaries at all', () => {
    expect(sourceOffsetForFieldOffset(document, [], 3)).toBe(0);
    expect(fieldOffsetForSourceOffset(document, [], 3)).toBe(0);
  });

  it('clamps a caret request from outside the document', () => {
    const boundaries = tableFor(document);
    for (const request of [-100, -1, document.length + 50, 1e9]) {
      const field = fieldOffsetForSourceOffset(document, boundaries, request);
      expect(field).toBeGreaterThanOrEqual(0);
      expect(field).toBeLessThanOrEqual(boundaries.length - 1);
    }
  });
});
