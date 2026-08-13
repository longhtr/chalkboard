/** Covers equation SVG preparation, fallback, sanitization, font choice, positioning, and multiline export. */
import type { BoardElement } from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import { equationMarkupForExport } from './equationSvgExport';

const base = {
  backgroundColor: 'transparent',
  createdBy: 'test',
  height: 80,
  opacity: 1,
  rotation: 0,
  strokeColor: '#1f2937',
  strokeStyle: 'solid' as const,
  strokeWidth: 2,
  width: 240,
  x: 0,
  y: 0,
};

describe('equation SVG export', () => {
  it('prepares full static markup for every equation regardless of viewport DOM', () => {
    document.body.innerHTML = '';
    const elements: BoardElement[] = [
      {
        ...base,
        cornerRadius: 0,
        id: 'shape',
        shapeKind: 'rectangle',
        type: 'shape',
      },
      {
        ...base,
        fontSize: 32,
        id: 'mixed',
        lineSpacing: 1.4,
        source: String.raw`Area $A=\pi r^2$`,
        type: 'equation',
      },
      {
        ...base,
        fontSize: 32,
        id: 'math-only',
        lineSpacing: 1.2,
        source: String.raw`$\frac{x}{2}$`,
        type: 'equation',
      },
    ];

    const markup = equationMarkupForExport(elements);

    expect([...markup.keys()]).toEqual(['mixed', 'math-only']);
    expect(markup.get('mixed')).toContain('Area');
    expect(markup.get('math-only')).toContain('ML__mfrac');
  });

  it('decorates multiline and literal text before portable export', () => {
    const markup = equationMarkupForExport([
      {
        ...base,
        fontSize: 32,
        id: 'literal-text',
        lineSpacing: 1.3,
        source: String.raw`Price \$5
path\to\file`,
        type: 'equation',
      },
    ]).get('literal-text');

    expect(markup).toContain('mixed-text-line-break');
    expect(markup).toContain('mixed-text-literal-dollar');
    expect(markup).toContain('path\\to \\file');
  });
});
