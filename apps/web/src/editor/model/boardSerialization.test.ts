/**
 * Covers current/legacy element reconstruction and rejection of malformed,
 * non-finite, oversized, duplicate, or unsupported persisted board data.
 */
import { MAX_FREEHAND_POINTS, type EquationElement } from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import localBoardV1 from '../../test/fixtures/local-board-v1.json';
import { requiredTestValue } from '../../test/assertions';
import {
  decodeBoardSnapshot,
  encodeBoardSnapshot,
  isStoredBoardElement,
  MAX_SHARED_BOARD_CHARACTERS,
  parseStoredElements,
} from './boardSerialization';

const baseElement = {
  backgroundColor: 'transparent',
  createdBy: 'local',
  height: 40,
  id: 'element-1',
  opacity: 1,
  rotation: 0,
  strokeColor: '#1f2937',
  strokeWidth: 2,
  width: 80,
  x: 10,
  y: 20,
};

describe('board serialization', () => {
  it('keeps the first element claiming a repeated id', () => {
    // Shared snapshot links and hand-edited storage can repeat an id. React
    // keys and id-keyed lookups assume uniqueness, so later copies are dropped.
    const elements = parseStoredElements(
      JSON.stringify([
        { ...baseElement, id: 'repeated', type: 'rectangle', x: 1 },
        { ...baseElement, id: 'repeated', type: 'rectangle', x: 2 },
        { ...baseElement, id: 'other', type: 'rectangle', x: 3 },
      ]),
    );

    expect(elements.map((element) => element.id)).toEqual([
      'repeated',
      'other',
    ]);
    expect(elements[0]?.x).toBe(1);
  });

  it('bounds fill spacing below without dropping wider boards', () => {
    const shape = {
      ...baseElement,
      cornerRadius: 0,
      fillStyle: 'hachure',
      shapeKind: 'rectangle',
      type: 'shape',
    };

    for (const fillSpacing of [4, 8, 100, 4_000]) {
      expect(isStoredBoardElement({ ...shape, fillSpacing })).toBe(true);
    }
    expect(isStoredBoardElement(shape)).toBe(true);
    for (const fillSpacing of [0, -1, Number.NaN, '8']) {
      expect(isStoredBoardElement({ ...shape, fillSpacing })).toBe(false);
    }
  });

  it('validates and migrates legacy board elements', () => {
    const elements = parseStoredElements(
      JSON.stringify([
        { ...baseElement, type: 'rectangle' },
        {
          ...baseElement,
          id: 'legacy-equation',
          fontSize: 25,
          latex: String.raw`\frac{a}{b}`,
          type: 'equation',
        },
        {
          ...baseElement,
          id: 'colored-equation',
          fontSize: 25,
          source: String.raw`\textcolor{#1971c2}{blue}`,
          type: 'equation',
        },
        {
          ...baseElement,
          id: 'legacy-line',
          endArrow: true,
          pathKind: 'arc',
          type: 'line',
        },
        { id: 'invalid' },
      ]),
    );

    expect(elements).toHaveLength(4);
    expect(elements[0]).toMatchObject({
      cornerRadius: 0,
      shapeKind: 'rectangle',
      strokeStyle: 'solid',
      type: 'shape',
    });
    expect(elements[1]).toMatchObject({
      lineSpacing: 1.2,
      source: String.raw`$\frac{a}{b}$`,
      type: 'equation',
    });
    expect(elements[2]).toMatchObject({
      source: 'blue',
      strokeColor: '#1971c2',
    });
    expect(elements[3]).toMatchObject({
      arrowheads: 'end',
      pathKind: 'bezier',
      splineContinuity: 'c0',
      type: 'line',
    });
  });

  it('drops stored mixed-text blocks that have no visible content', () => {
    const visible = {
      ...baseElement,
      fontSize: 25,
      id: 'visible',
      source: '$x$',
      sourceFontSize: 22,
      type: 'equation',
    } satisfies EquationElement;
    const empty = ['$ $', '   ', String.raw`\textbf{}`].map(
      (source, index) => ({
        ...visible,
        id: `empty-${index}`,
        source,
      }),
    );

    expect(parseStoredElements(JSON.stringify([...empty, visible]))).toEqual([
      expect.objectContaining({
        id: 'visible',
        source: '$x$',
        sourceFontSize: 22,
      }),
    ]);
    expect(
      decodeBoardSnapshot(encodeBoardSnapshot([...empty, visible])),
    ).toEqual([expect.objectContaining({ id: 'visible', source: '$x$' })]);
  });

  it('validates and round-trips trapezoid shapes', () => {
    const trapezoid = {
      ...baseElement,
      cornerRadius: 4,
      shapeKind: 'trapezoid',
      trapezoidTopLeft: 0.1,
      trapezoidTopRight: 0.7,
      type: 'shape',
    };

    const elements = parseStoredElements(JSON.stringify([trapezoid]));

    expect(elements).toEqual([{ ...trapezoid, strokeStyle: 'solid' }]);
    expect(decodeBoardSnapshot(encodeBoardSnapshot(elements))).toEqual(
      elements,
    );
  });

  it('round-trips freehand arrowheads and rejects unknown values', () => {
    const decorated = {
      ...baseElement,
      arrowheads: 'both',
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 10 },
      ],
      type: 'freehand',
    };
    expect(parseStoredElements(JSON.stringify([decorated]))).toEqual([
      { ...decorated, strokeStyle: 'solid' },
    ]);
    expect(
      decodeBoardSnapshot(
        encodeBoardSnapshot(parseStoredElements(JSON.stringify([decorated]))),
      ),
    ).toEqual([expect.objectContaining({ arrowheads: 'both' })]);
    // Strokes stored before endpoint decoration existed carry no field at all.
    expect(isStoredBoardElement({ ...decorated, arrowheads: undefined })).toBe(
      true,
    );
    expect(isStoredBoardElement({ ...decorated, arrowheads: 'start' })).toBe(
      false,
    );
  });

  it('round-trips shape fill styles and rejects unknown values', () => {
    const hatched = {
      ...baseElement,
      backgroundColor: '#a5d8ff',
      cornerRadius: 0,
      fillStyle: 'cross-hatch',
      shapeKind: 'rectangle',
      type: 'shape',
    };
    expect(parseStoredElements(JSON.stringify([hatched]))).toEqual([
      { ...hatched, strokeStyle: 'solid' },
    ]);
    expect(
      decodeBoardSnapshot(
        encodeBoardSnapshot(parseStoredElements(JSON.stringify([hatched]))),
      ),
    ).toEqual([expect.objectContaining({ fillStyle: 'cross-hatch' })]);
    // Shapes stored before fill styles existed carry no field and stay solid.
    expect(isStoredBoardElement({ ...hatched, fillStyle: undefined })).toBe(
      true,
    );
    expect(isStoredBoardElement({ ...hatched, fillStyle: 'dots' })).toBe(false);
  });

  it('validates and round-trips bounded freehand strokes', () => {
    const freehand = {
      ...baseElement,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 10 },
      ],
      type: 'freehand',
    };
    expect(parseStoredElements(JSON.stringify([freehand]))).toEqual([
      { ...freehand, strokeStyle: 'solid' },
    ]);
    expect(
      isStoredBoardElement({ ...freehand, points: [{ x: 0, y: 0 }] }),
    ).toBe(false);
    expect(
      isStoredBoardElement({
        ...freehand,
        points: Array.from({ length: MAX_FREEHAND_POINTS + 1 }, () => ({
          x: 0,
          y: 0,
        })),
      }),
    ).toBe(false);
  });

  it('imports the retained legacy snapshot fixture', () => {
    const encoded = btoa(JSON.stringify(localBoardV1.elements))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');

    const elements = requiredTestValue(
      decodeBoardSnapshot(encoded),
      'decoded legacy snapshot',
    );

    expect(elements).toHaveLength(3);
    expect(elements[0]).toMatchObject({
      shapeKind: 'rectangle',
      type: 'shape',
    });
    expect(elements[1]).toMatchObject({
      lineSpacing: 1.2,
      source: String.raw`$\frac{a}{b}$`,
      type: 'equation',
    });
    expect(elements[2]).toMatchObject({
      arrowheads: 'end',
      pathKind: 'bezier',
      splineContinuity: 'c0',
      type: 'line',
    });
  });

  it('round-trips spline continuity and rejects unknown levels', () => {
    const spline = {
      ...baseElement,
      pathKind: 'bezier',
      segments: [
        {
          control1: { x: 20, y: 10 },
          control2: { x: 40, y: 10 },
          end: { x: 60, y: 0 },
        },
      ],
      splineContinuity: 'c2',
      type: 'line',
    };

    expect(parseStoredElements(JSON.stringify([spline]))).toEqual([
      { ...spline, arrowheads: 'none', strokeStyle: 'solid' },
    ]);
    expect(
      parseStoredElements(
        JSON.stringify([{ ...spline, splineContinuity: 'unknown' }]),
      ),
    ).toEqual([]);
  });

  it('round-trips Unicode board snapshots', () => {
    const elements = parseStoredElements(
      JSON.stringify([
        {
          ...baseElement,
          fontSize: 25,
          lineSpacing: 1.4,
          source: 'Café $\\alpha$ — 東京',
          type: 'equation',
        },
      ]),
    );

    expect(decodeBoardSnapshot(encodeBoardSnapshot(elements))).toEqual(
      elements,
    );
  });

  it('rejects malformed, incomplete, and oversized snapshots', () => {
    expect(decodeBoardSnapshot('not-base64')).toBeNull();
    expect(
      decodeBoardSnapshot('a'.repeat(MAX_SHARED_BOARD_CHARACTERS + 1)),
    ).toBeNull();
    expect(() =>
      encodeBoardSnapshot([
        {
          ...baseElement,
          fontSize: 25,
          lineSpacing: 1.2,
          source: 'x'.repeat(MAX_SHARED_BOARD_CHARACTERS),
          type: 'equation',
        },
      ]),
    ).toThrow('too large for a snapshot link');
    expect(
      isStoredBoardElement({
        ...baseElement,
        name: 'cloud.png',
        source:
          '/api/boards/123e4567-e89b-12d3-a456-426614174000/assets/123e4567-e89b-12d3-a456-426614174001',
        type: 'image',
      }),
    ).toBe(true);
    for (const source of [
      'javascript:alert(1)',
      'https://example.com/image.png',
      '/api/boards/not-a-board/assets/not-an-asset',
    ]) {
      expect(
        isStoredBoardElement({
          ...baseElement,
          name: 'unsafe.svg',
          source,
          type: 'image',
        }),
      ).toBe(false);
    }
  });
});
