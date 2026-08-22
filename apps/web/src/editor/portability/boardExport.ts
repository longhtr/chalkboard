/**
 * Computes one export scene and renders board content to PNG or portable SVG.
 * Export preparation includes offscreen equations rather than viewport-culling.
 */
import {
  boundsForPoints,
  elementBounds,
  isFreehandElement,
  isLinearElement,
  isShapeElement,
  linePathGeometry,
  normalizeBounds,
  type BoardElement,
  type Bounds,
  type ColorTheme,
  type Point,
} from '@chalkboard/shared';

import { themedElements } from '../interaction/themedElements';

import {
  workspaceFontCss,
  workspaceFontUrls,
  type WorkspaceFontChoice,
} from '../../math/workspaceFontAssets';
import { parseMixedText, stripTextColors } from '../../math/mixedMath';
import { sanitizeMathForStaticRender } from '../../math/renderSanitizer';
import staticCss from '../../vendor/excalifont/mathlive-static-no-fonts.css?raw';
import {
  escapeXml,
  svgNumber,
  vectorArrowheadPoints,
  vectorElementSvgMarkup,
} from './vectorSvgMarkup';

/** Download representation produced by the board image exporter. */
export type BoardExportFormat = 'png' | 'svg';
/** Paper painted behind exported content, matching each theme's canvas. */
const EXPORT_PAPER_LIGHT = '#f8f7f3';
const EXPORT_PAPER_DARK = '#121212';

/** Whether export includes the complete board or only selected elements. */
export type BoardExportScope = 'board' | 'selection';

interface BoardExportPadding {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

/** User-selected image representation, scope, background, and scale. */
export interface BoardExportOptions {
  background: boolean;
  format: BoardExportFormat;
  padding: BoardExportPadding;
  scale: number;
  scope: BoardExportScope;
}

/** Fully resolved content and appearance required for deterministic export. */
export interface BoardExportInput {
  elements: readonly BoardElement[];
  /**
   * Theme whose element colors and paper the export uses, so the file matches
   * what the board looked like on screen. Defaults to light.
   */
  theme?: ColorTheme;
  equationMarkup?: ReadonlyMap<string, string>;
  equationVectorMarkup?: ReadonlyMap<string, string>;
  fontChoice: WorkspaceFontChoice;
  options: BoardExportOptions;
  selectedIds: ReadonlySet<string>;
  title: string;
}

interface BoardExportResult {
  blob: Blob;
  filename: string;
}

async function dataUrl(source: string): Promise<string> {
  if (source.startsWith('data:')) return source;
  const response = await fetch(source, { credentials: 'same-origin' });
  if (!response.ok)
    throw new Error(`Could not load an exported image (${response.status})`);
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error('Could not encode an exported image'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

async function embeddedFonts(choice: WorkspaceFontChoice): Promise<string> {
  const entries = await Promise.all(
    [...workspaceFontUrls(choice)].map(
      async ([filename, url]) => [filename, await dataUrl(url)] as const,
    ),
  );
  return workspaceFontCss(choice, new Map(entries));
}

function expandBounds(bounds: Bounds, amount: number): Bounds {
  return {
    x: bounds.x - amount,
    y: bounds.y - amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2,
  };
}

function cubicCoordinate(
  start: number,
  control1: number,
  control2: number,
  end: number,
  t: number,
): number {
  const inverse = 1 - t;
  return (
    inverse ** 3 * start +
    3 * inverse * inverse * t * control1 +
    3 * inverse * t * t * control2 +
    t ** 3 * end
  );
}

function cubicExtremaParameters(
  start: number,
  control1: number,
  control2: number,
  end: number,
): number[] {
  const a = -start + 3 * control1 - 3 * control2 + end;
  const b = 3 * start - 6 * control1 + 3 * control2;
  const c = -3 * start + 3 * control1;
  const quadratic = 3 * a;
  const linear = 2 * b;
  if (Math.abs(quadratic) < 1e-9) {
    if (Math.abs(linear) < 1e-9) return [];
    const root = -c / linear;
    return root > 0 && root < 1 ? [root] : [];
  }
  const discriminant = linear * linear - 4 * quadratic * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [
    (-linear + root) / (2 * quadratic),
    (-linear - root) / (2 * quadratic),
  ].filter((value) => value > 0 && value < 1);
}

function cubicBoundsPoints(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
): Point[] {
  const parameters = new Set([
    0,
    1,
    ...cubicExtremaParameters(start.x, control1.x, control2.x, end.x),
    ...cubicExtremaParameters(start.y, control1.y, control2.y, end.y),
  ]);
  return [...parameters].map((t) => ({
    x: cubicCoordinate(start.x, control1.x, control2.x, end.x, t),
    y: cubicCoordinate(start.y, control1.y, control2.y, end.y, t),
  }));
}

function renderedElementBounds(element: BoardElement): Bounds {
  if (isShapeElement(element)) {
    const stroke =
      element.strokeColor === 'transparent' ? 0 : element.strokeWidth / 2;
    return expandBounds(normalizeBounds(elementBounds(element)), stroke);
  }
  if (isFreehandElement(element)) {
    const points = element.points.map(({ x, y }) => ({
      x: element.x + x,
      y: element.y + y,
    }));
    const bounds = boundsForPoints(points) ?? normalizeBounds(element);
    const stroke =
      element.strokeColor === 'transparent' ? 0 : element.strokeWidth / 2;
    return expandBounds(bounds, stroke);
  }
  if (isLinearElement(element)) {
    const points: Point[] = [];
    if (element.type === 'arrow') {
      const start = { x: element.x, y: element.y };
      const end = {
        x: element.x + element.width,
        y: element.y + element.height,
      };
      points.push(
        start,
        end,
        ...vectorArrowheadPoints(element, end, {
          x: element.width,
          y: element.height,
        }),
      );
    } else {
      const geometry = linePathGeometry(element);
      if (geometry.kind === 'straight') {
        points.push(geometry.start, geometry.end);
      } else {
        for (const segment of geometry.segments) {
          points.push(
            ...cubicBoundsPoints(
              segment.start,
              segment.control1,
              segment.control2,
              segment.end,
            ),
          );
        }
        if (geometry.segments.length === 0) points.push(geometry.start);
      }
      const first =
        geometry.kind === 'bezier' ? geometry.segments[0] : undefined;
      const last =
        geometry.kind === 'bezier' ? geometry.segments.at(-1) : undefined;
      const end = geometry.kind === 'straight' ? geometry.end : last?.end;
      if (element.arrowheads === 'both') {
        const direction =
          first === undefined
            ? {
                x: geometry.start.x - (end?.x ?? geometry.start.x),
                y: geometry.start.y - (end?.y ?? geometry.start.y),
              }
            : {
                x: first.start.x - first.control1.x,
                y: first.start.y - first.control1.y,
              };
        points.push(
          ...vectorArrowheadPoints(element, geometry.start, direction),
        );
      }
      if (
        (element.arrowheads === 'end' || element.arrowheads === 'both') &&
        end !== undefined
      ) {
        const direction =
          last === undefined
            ? { x: end.x - geometry.start.x, y: end.y - geometry.start.y }
            : {
                x: last.end.x - last.control2.x,
                y: last.end.y - last.control2.y,
              };
        points.push(...vectorArrowheadPoints(element, end, direction));
      }
    }
    const stroke =
      element.strokeColor === 'transparent' ? 0 : element.strokeWidth / 2;
    return expandBounds(
      boundsForPoints(points) ?? normalizeBounds(element),
      stroke,
    );
  }
  if (element.type === 'equation') {
    return {
      x: element.x,
      y: element.y,
      width: Math.max(1, element.width + 4),
      height: Math.max(1, element.height + 4),
    };
  }
  return normalizeBounds(element);
}

function exportBounds(
  elements: readonly BoardElement[],
  padding: BoardExportPadding,
): Bounds {
  if (elements.length === 0) return { x: 0, y: 0, width: 640, height: 360 };
  const rendered = elements.map(renderedElementBounds);
  const minX = Math.min(...rendered.map(({ x }) => x));
  const minY = Math.min(...rendered.map(({ y }) => y));
  const maxX = Math.max(...rendered.map(({ x, width }) => x + width));
  const maxY = Math.max(...rendered.map(({ y, height }) => y + height));
  const safe = (value: number) =>
    Number.isFinite(value) ? Math.max(0, value) : 0;
  const top = safe(padding.top);
  const right = safe(padding.right);
  const bottom = safe(padding.bottom);
  const left = safe(padding.left);
  return {
    x: minX - left,
    y: minY - top,
    width: Math.max(1, maxX - minX + left + right),
    height: Math.max(1, maxY - minY + top + bottom),
  };
}

function textAsTex(value: string): string {
  return stripTextColors(value).replace(/[\\{}$&#_^%~]/g, (character) => {
    if (character === '\\') return String.raw`\textbackslash{}`;
    if (character === '~') return String.raw`\textasciitilde{}`;
    if (character === '^') return String.raw`\textasciicircum{}`;
    return `\\${character}`;
  });
}

function mixedSourceAsTex(source: string): string {
  const rows = source.split('\n').map((row) =>
    parseMixedText(row)
      .map((segment) =>
        segment.kind === 'math'
          ? `{${segment.latex}}`
          : `\\text{${textAsTex(segment.source)}}`,
      )
      .join(''),
  );
  return rows.length === 1
    ? (rows[0] ?? '')
    : String.raw`\begin{gathered}${rows.join(String.raw`\\`)}\end{gathered}`;
}

async function rasterEquationSvg(
  element: Extract<BoardElement, { type: 'equation' }>,
): Promise<string> {
  const { convertLatexToHtml } = await import('../../math/mathjaxEngine');
  const rendered = await convertLatexToHtml(
    mixedSourceAsTex(sanitizeMathForStaticRender(element.source)),
  );
  if (rendered.includes('data-mjx-error')) {
    throw new Error('A mathematics block could not be prepared for PNG export');
  }
  const svg = rendered.match(/<svg\b[\s\S]*<\/svg>/)?.[0];
  if (svg === undefined) {
    throw new Error('A mathematics block could not be prepared for PNG export');
  }
  const positioned = svg
    .replace(/\s(?:width|height|style)="[^"]*"/g, '')
    .replace(
      '<svg',
      `<svg x="${svgNumber(element.x)}" y="${svgNumber(element.y)}" width="${svgNumber(Math.max(1, element.width))}" height="${svgNumber(Math.max(1, element.height))}" style="color:${escapeXml(element.strokeColor)};overflow:visible"`,
    );
  return `<g opacity="${svgNumber(element.opacity)}">${positioned}</g>`;
}

function exportFilename(title: string, extension: BoardExportFormat): string {
  const stem =
    title
      .trim()
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'chalkboard';
  return `${stem}.${extension}`;
}

interface BoardSvgRenderOptions {
  embedFontResources?: boolean;
  rasterSafe?: boolean;
}

/** Builds standalone SVG markup with fonts, images, vectors, and equations embedded. */
export async function createBoardSvg(
  input: BoardExportInput,
  options: BoardSvgRenderOptions = {},
): Promise<string> {
  const { embedFontResources = true, rasterSafe = false } = options;
  // Project per-theme colors before anything measures or draws, so bounds and
  // markup agree with the theme being exported.
  const theme = input.theme ?? 'light';
  const themed = themedElements(input.elements, theme);
  const selected =
    input.options.scope === 'selection'
      ? themed.filter(({ id }) => input.selectedIds.has(id))
      : [...themed];
  if (selected.length === 0)
    throw new Error(
      input.options.scope === 'selection'
        ? 'Select at least one object to export'
        : 'Add at least one object to the board before exporting',
    );
  const bounds = exportBounds(selected, input.options.padding);
  // Chromium taints a canvas for any SVG foreignObject. PNG export therefore
  // flattens rendered mathematics to ordinary SVG text and geometry first;
  // those vectors can safely carry the same embedded font faces as portable SVG.
  const resources =
    embedFontResources ||
    (rasterSafe && input.equationVectorMarkup !== undefined)
      ? await embeddedFonts(input.fontChoice)
      : '';
  const content: string[] = [];
  for (const element of selected) {
    const vectorMarkup = vectorElementSvgMarkup(element);
    if (vectorMarkup !== '') content.push(vectorMarkup);
    else if (element.type === 'image') {
      const source = await dataUrl(element.source);
      content.push(
        `<image href="${escapeXml(source)}" x="${svgNumber(element.x)}" y="${svgNumber(element.y)}" width="${svgNumber(element.width)}" height="${svgNumber(element.height)}" opacity="${svgNumber(element.opacity)}" preserveAspectRatio="none"/>`,
      );
    } else if (element.type === 'equation') {
      if (rasterSafe) {
        content.push(
          input.equationVectorMarkup?.get(element.id) ??
            (await rasterEquationSvg(element)),
        );
      } else {
        const markup = input.equationMarkup?.get(element.id);
        if (markup === undefined)
          throw new Error(
            'Wait for all mathematics to finish rendering before exporting',
          );
        content.push(
          `<foreignObject x="${svgNumber(element.x)}" y="${svgNumber(element.y)}" width="${svgNumber(Math.max(1, element.width + 4))}" height="${svgNumber(Math.max(1, element.height + 4))}" opacity="${svgNumber(element.opacity)}"><div xmlns="http://www.w3.org/1999/xhtml" class="chalkboard-export-equation" style="color:${escapeXml(element.strokeColor)};font-size:${svgNumber(element.fontSize)}px;line-height:${svgNumber(element.lineSpacing ?? 1.2)}">${markup}</div></foreignObject>`,
        );
      }
    }
  }
  const css = `${resources}\n${staticCss}\n.chalkboard-export-equation{width:max-content;font-family:KaTeX_Main,Excalifont,sans-serif;font-synthesis:none}.chalkboard-export-equation .ML__text{font-family:KaTeX_Main,Excalifont,sans-serif}.mixed-text-line-break{display:block;height:0}.mixed-text-line-break::after{content:'\\a';white-space:pre}.mixed-text-literal-dollar{font-size:0}.mixed-text-literal-dollar::after{content:'$';font-size:1rem}.mixed-text-literal-brace-left{font-size:0}.mixed-text-literal-brace-left::after{content:'{';font-size:1rem}.mixed-text-literal-brace-right{font-size:0}.mixed-text-literal-brace-right::after{content:'}';font-size:1rem}.mixed-text-literal-percent{font-size:0}.mixed-text-literal-percent::after{content:'%';font-size:1rem}.mixed-text-literal-backslash{font-size:0}.mixed-text-literal-backslash::after{content:'\\\\';font-size:1rem}.mixed-text-color-marker{display:none}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgNumber(bounds.width)}" height="${svgNumber(bounds.height)}" viewBox="${svgNumber(bounds.x)} ${svgNumber(bounds.y)} ${svgNumber(bounds.width)} ${svgNumber(bounds.height)}"><title>${escapeXml(input.title)}</title><style>${css.replace(/<\/style/gi, '<\\/style')}</style>${input.options.background ? `<rect x="${svgNumber(bounds.x)}" y="${svgNumber(bounds.y)}" width="${svgNumber(bounds.width)}" height="${svgNumber(bounds.height)}" fill="${theme === 'dark' ? EXPORT_PAPER_DARK : EXPORT_PAPER_LIGHT}"/>` : ''}${content.join('')}</svg>`;
}

async function svgToPng(svg: string, scale: number): Promise<Blob> {
  const source = URL.createObjectURL(
    new Blob([svg], { type: 'image/svg+xml' }),
  );
  try {
    const image = new Image();
    image.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error('The browser could not rasterize this board'));
      image.src = source;
    });
    const canvas = document.createElement('canvas');
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    if (width > 32_767 || height > 32_767 || width * height > 64_000_000) {
      throw new Error(
        'This PNG would be too large for the browser. Choose a lower resolution or export SVG.',
      );
    }
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null)
      throw new Error('PNG export is unavailable in this browser');
    context.scale(scale, scale);
    context.drawImage(image, 0, 0);
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob === null
            ? reject(new Error('PNG encoding failed'))
            : resolve(blob),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(source);
  }
}

/** Creates and downloads the requested SVG or rasterized PNG representation. */
export async function exportBoard(
  input: BoardExportInput,
): Promise<BoardExportResult> {
  const svg = await createBoardSvg(input, {
    embedFontResources: input.options.format === 'svg',
    // Both formats flatten mathematics to ordinary SVG text and geometry. PNG
    // needs it because Chromium taints a canvas containing foreignObject; SVG
    // needs it because nothing outside a browser draws foreignObject at all,
    // so equations silently disappeared from a file opened anywhere else.
    rasterSafe: true,
  });
  const blob =
    input.options.format === 'svg'
      ? new Blob([svg], { type: 'image/svg+xml' })
      : await svgToPng(svg, input.options.scale);
  return { blob, filename: exportFilename(input.title, input.options.format) };
}
