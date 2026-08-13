/** Proves structured/source reconciliation, deterministic regeneration, legacy fallback, and malformed rejection. */
import { describe, expect, it } from 'vitest';

import type { EquationElement } from '@chalkboard/shared';

import { mixedDocumentFromSource } from '../../math/mixedDocument';
import { reconcileStructuredBoardContent } from './structuredBoardContent';

const equation: EquationElement = {
  backgroundColor: 'transparent',
  createdBy: 'test',
  fontSize: 30,
  height: 50,
  id: 'equation',
  lineSpacing: 1.2,
  opacity: 1,
  rotation: 0,
  source: 'Stale compatibility source',
  strokeColor: '#111827',
  strokeStyle: 'solid',
  strokeWidth: 2,
  type: 'equation',
  width: 220,
  x: 0,
  y: 0,
};

describe('structured board content', () => {
  it('derives compatibility source from the authoritative structured document', () => {
    const document = mixedDocumentFromSource(
      'Structured $x^2$ winner',
      equation.strokeColor,
    );

    expect(
      reconcileStructuredBoardContent([equation], { [equation.id]: document }),
    ).toEqual({
      elements: [{ ...equation, source: 'Structured $x^2$ winner' }],
      mixedContentByElementId: { [equation.id]: document },
      sourceChanged: true,
    });
  });

  it('derives missing structured content from compatibility source', () => {
    const result = reconcileStructuredBoardContent([equation]);

    expect(result.elements).toEqual([equation]);
    expect(result.mixedContentByElementId[equation.id]).toEqual(
      mixedDocumentFromSource(equation.source, equation.strokeColor),
    );
    expect(result.sourceChanged).toBe(false);
  });
});
