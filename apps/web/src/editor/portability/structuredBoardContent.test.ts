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

  it('keeps a source its structured form cannot reproduce', () => {
    // A colour command with an unbalanced brace is read as plain text, and
    // serializing that text back escapes the backslash. Reconciliation used to
    // publish that rewrite, so `\\textcolor{...}` became a literal
    // `\\textbackslash textcolor{...}` on screen and stayed that way.
    const unbalanced: EquationElement = {
      ...equation,
      source:
        '\\textcolor{#373064}{Title\\textcolor{#5f5a68}{ subtitle}\nSecond',
    };

    const result = reconcileStructuredBoardContent([unbalanced]);

    expect(result.elements).toEqual([unbalanced]);
    expect(result.sourceChanged).toBe(false);
    // The lossy representation must not be stored either: kept, it would become
    // authoritative on the next load and rewrite the source after all.
    expect(result.mixedContentByElementId[unbalanced.id]).toBeUndefined();
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
