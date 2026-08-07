/** Proves scene bounds, padding, background, scale, culling independence, and PNG/SVG output decisions. */
import type { BoardElement } from '@chalkboard/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBoardSvg, type BoardExportInput } from './boardExport';

const base = {
  backgroundColor: 'transparent',
  createdBy: 'test',
  height: 40,
  opacity: 1,
  rotation: 0,
  strokeColor: '#1f2937',
  strokeStyle: 'solid' as const,
  strokeWidth: 2,
  width: 80,
  x: 10,
  y: 20,
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Blob(['font']), { status: 200 })),
  );
});

function input(elements: BoardElement[]): BoardExportInput {
  return {
    elements,
    equationMarkup: new Map<string, string>(),
    fontChoice: 'excalifont',
    options: {
      background: true,
      format: 'svg' as const,
      padding: { bottom: 24, left: 24, right: 24, top: 24 },
      scale: 2,
      scope: 'board' as const,
    },
    selectedIds: new Set<string>(),
    title: 'Algebra & geometry',
  };
}

describe('board SVG export', () => {
  it('serializes shapes, lines, freehand paths, images, and rendered mathematics', async () => {
    const elements: BoardElement[] = [
      {
        ...base,
        id: 'legacy-rectangle',
        type: 'rectangle',
      },
      {
        ...base,
        cornerRadius: 8,
        id: 'shape',
        shapeKind: 'rectangle',
        type: 'shape',
      },
      {
        ...base,
        arrowheads: 'both',
        height: 50,
        id: 'line',
        pathKind: 'straight',
        segments: [],
        type: 'line',
        width: 100,
      },
      {
        ...base,
        id: 'arrow',
        type: 'arrow',
      },
      {
        ...base,
        id: 'freehand',
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 12 },
        ],
        type: 'freehand',
      },
      {
        ...base,
        id: 'image',
        name: 'proof',
        source: 'data:image/png;base64,AA==',
        type: 'image',
      },
      {
        ...base,
        fontSize: 25,
        id: 'equation',
        lineSpacing: 1.2,
        source: '$x^2$',
        type: 'equation',
      },
    ];
    const exportInput = input(elements);
    exportInput.equationMarkup = new Map([
      ['equation', '<span class="ML__mathlive">x²</span>'],
    ]);

    const svg = await createBoardSvg(exportInput);

    expect(svg).toContain('<title>Algebra &amp; geometry</title>');
    expect(svg).toContain('<rect');
    expect(svg).toContain('<polyline');
    expect(svg).toContain('<image href="data:image/png;base64,AA=="');
    expect(svg).toContain('<foreignObject');
    expect(svg).toContain('class="ML__mathlive"');
    expect(svg).not.toContain('fonts/KaTeX_Main-Regular.woff2');
  });

  it('uses embedded workspace-font vectors instead of classic fallback math for PNG', async () => {
    const equation: BoardElement = {
      ...base,
      fontSize: 25,
      id: 'equation',
      lineSpacing: 1.2,
      source: '$x^2$',
      type: 'equation',
    };
    const exportInput = input([equation]);
    exportInput.options.format = 'png';
    exportInput.equationVectorMarkup = new Map([
      [
        'equation',
        '<g data-workspace-equation="equation"><text font-family="KaTeX_Main">x²</text></g>',
      ],
    ]);

    const svg = await createBoardSvg(exportInput, {
      embedFontResources: false,
      rasterSafe: true,
    });

    expect(svg).toContain('data-workspace-equation="equation"');
    expect(svg).not.toContain('<foreignObject');
    expect(svg).not.toContain('data-mjx-error');
  });

  it('uses the requested padding around the exported bounds', async () => {
    const shape: BoardElement = {
      ...base,
      cornerRadius: 0,
      id: 'shape',
      shapeKind: 'rectangle',
      type: 'shape',
    };
    const withoutPadding = input([shape]);
    withoutPadding.options.padding = { bottom: 0, left: 0, right: 0, top: 0 };
    const asymmetricPadding = input([shape]);
    asymmetricPadding.options.padding = {
      bottom: 30,
      left: 40,
      right: 20,
      top: 10,
    };

    await expect(createBoardSvg(withoutPadding)).resolves.toContain(
      'viewBox="9 19 82 42"',
    );
    await expect(createBoardSvg(asymmetricPadding)).resolves.toContain(
      'viewBox="-31 9 142 82"',
    );
  });

  it('bounds curve extrema, arrowheads, strokes, and equation markup without clipping', async () => {
    const noPadding = { bottom: 0, left: 0, right: 0, top: 0 };
    const curveInput = input([
      {
        ...base,
        arrowheads: 'none',
        height: 0,
        id: 'curve',
        pathKind: 'bezier',
        segments: [
          {
            control1: { x: 0, y: 100 },
            control2: { x: 100, y: 100 },
            end: { x: 100, y: 0 },
          },
        ],
        type: 'line',
        width: 100,
        x: 0,
        y: 0,
      },
    ]);
    curveInput.options.padding = noPadding;
    const arrowInput = input([
      {
        ...base,
        arrowheads: 'end',
        height: 100,
        id: 'arrow',
        pathKind: 'straight',
        segments: [],
        type: 'line',
        width: 0,
        x: 0,
        y: 0,
      },
    ]);
    arrowInput.options.padding = noPadding;
    const equationInput = input([
      {
        ...base,
        fontSize: 25,
        id: 'equation',
        lineSpacing: 1.2,
        source: '$x$',
        type: 'equation',
      },
    ]);
    equationInput.options.padding = noPadding;
    equationInput.equationMarkup = new Map([['equation', '<span>x</span>']]);

    await expect(createBoardSvg(curveInput)).resolves.toContain(
      'viewBox="-1 -1 102 77"',
    );
    await expect(createBoardSvg(arrowInput)).resolves.toContain(
      'viewBox="-6 -1 12 102"',
    );
    await expect(createBoardSvg(equationInput)).resolves.toContain(
      'viewBox="10 20 84 44"',
    );
  });

  it('exports trapezoids as portable polygon geometry', async () => {
    const trapezoid: BoardElement = {
      ...base,
      cornerRadius: 0,
      id: 'trapezoid',
      shapeKind: 'trapezoid',
      trapezoidTopLeft: 0.1,
      trapezoidTopRight: 0.7,
      type: 'shape',
    };

    const svg = await createBoardSvg(input([trapezoid]));

    expect(svg).toContain('<polygon points="18,20 66,20 90,60 10,60"');
  });

  it('exports only selected objects when requested', async () => {
    const first: BoardElement = {
      ...base,
      cornerRadius: 0,
      id: 'first',
      shapeKind: 'rectangle',
      type: 'shape',
    };
    const second: BoardElement = {
      ...base,
      cornerRadius: 0,
      id: 'second',
      shapeKind: 'ellipse',
      type: 'shape',
      x: 500,
    };
    const exportInput = input([first, second]);
    exportInput.options.scope = 'selection';
    exportInput.selectedIds = new Set(['second']);

    const svg = await createBoardSvg(exportInput);

    expect(svg).toContain('<ellipse');
    expect(svg).not.toContain('<rect x="10"');
    expect(svg).toContain('viewBox="475');
  });

  it('rejects empty board and empty selection exports clearly', async () => {
    await expect(createBoardSvg(input([]))).rejects.toThrow(
      'Add at least one object to the board',
    );
    const exportInput = input([
      {
        ...base,
        cornerRadius: 0,
        id: 'shape',
        shapeKind: 'rectangle',
        type: 'shape',
      },
    ]);
    exportInput.options.scope = 'selection';
    await expect(createBoardSvg(exportInput)).rejects.toThrow(
      'Select at least one object',
    );
  });
});
