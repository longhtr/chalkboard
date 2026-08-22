/** Converts active/static equation markup into sanitized, positioned, font-consistent SVG export groups. */
import {
  isEquationElement,
  type BoardElement,
  type EquationElement,
} from '@chalkboard/shared';

import { staticMathMarkup } from '../../math/staticMathMarkup';
import { decorateStaticMathMarkup } from '../../math/staticMathDecoration';
import { isMathOnlyMixedSource } from '../../math/mixedMath';
import { escapeXml } from './vectorSvgMarkup';

/** Builds sanitized static DOM markup for every equation, independent of viewport DOM. */
export function equationMarkupForExport(
  elements: readonly BoardElement[],
): Map<string, string> {
  const markup = new Map<string, string>();
  for (const element of elements) {
    if (!isEquationElement(element)) continue;
    const container = document.createElement('div');
    container.innerHTML = staticMathMarkup(element.source, {
      baseColor: element.strokeColor,
      isMathOnly: isMathOnlyMixedSource(element.source),
      lineSpacing: element.lineSpacing,
    });
    decorateStaticMathMarkup(container, {
      baseColor: element.strokeColor,
      hasTextColors: element.source.includes('\\textcolor{'),
    });
    markup.set(element.id, container.innerHTML);
  }
  return markup;
}

function transparent(color: string): boolean {
  return color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
}

interface RectangleMarkupOptions {
  bounds: DOMRect;
  color: string;
  height?: number;
  rootBounds: DOMRect;
  width?: number;
  xOffset?: number;
  yOffset?: number;
}

function rectangleMarkup({
  bounds,
  color,
  height = bounds.height,
  rootBounds,
  width = bounds.width,
  xOffset = 0,
  yOffset = 0,
}: RectangleMarkupOptions): string {
  if (width <= 0 || height <= 0 || transparent(color)) return '';
  return `<rect x="${bounds.left - rootBounds.left + xOffset}" y="${bounds.top - rootBounds.top + yOffset}" width="${width}" height="${height}" fill="${escapeXml(color)}"/>`;
}

function decorationMarkup(element: HTMLElement, rootBounds: DOMRect): string {
  const bounds = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const content: string[] = [];
  if (!transparent(style.backgroundColor)) {
    content.push(
      rectangleMarkup({
        bounds,
        color: style.backgroundColor,
        rootBounds,
      }),
    );
  }
  for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
    const width = Number.parseFloat(style[`border${side}Width`]);
    const color = style[`border${side}Color`];
    if (
      width <= 0 ||
      style[`border${side}Style`] === 'none' ||
      transparent(color)
    ) {
      continue;
    }
    if (side === 'Top' || side === 'Bottom') {
      content.push(
        rectangleMarkup({
          bounds,
          color,
          height: width,
          rootBounds,
          width: bounds.width,
          yOffset: side === 'Bottom' ? bounds.height - width : 0,
        }),
      );
    } else {
      content.push(
        rectangleMarkup({
          bounds,
          color,
          height: bounds.height,
          rootBounds,
          width,
          xOffset: side === 'Right' ? bounds.width - width : 0,
        }),
      );
    }
  }
  const pseudo = element.matches('.ML__sqrt-line')
    ? getComputedStyle(element, '::before')
    : element.matches('.ML__frac-line, .overline-line, .underline-line')
      ? getComputedStyle(element, '::after')
      : null;
  if (pseudo !== null && !transparent(pseudo.backgroundColor)) {
    const height = Math.max(
      1,
      Number.parseFloat(pseudo.minHeight) ||
        Number.parseFloat(style.fontSize) * 0.04,
    );
    content.push(
      rectangleMarkup({
        bounds,
        color: pseudo.backgroundColor,
        height,
        rootBounds,
        width: bounds.width,
        yOffset: Number.parseFloat(pseudo.marginTop) || 0,
      }),
    );
  }
  return content.join('');
}

const LITERAL_SENTINEL_CHARACTERS: ReadonlyArray<readonly [string, string]> = [
  ['mixed-text-literal-dollar', '$'],
  ['mixed-text-literal-backslash', '\\'],
  ['mixed-text-literal-brace-left', '{'],
  ['mixed-text-literal-brace-right', '}'],
  ['mixed-text-literal-percent', '%'],
];

/** Returns a delimiter's computed vertical scale for equivalent SVG text. */
function delimiterVerticalScale(parent: HTMLElement): number {
  const delimiter = parent.closest<HTMLElement>('[data-excalifont-delim]');
  if (delimiter === null) return 1;
  const match = /^matrix\(([^)]+)\)$/u.exec(
    getComputedStyle(delimiter).transform,
  );
  if (match === null) return 1;
  const values = match[1]?.split(',').map((value) => Number(value.trim()));
  const scale = values?.[3];
  return scale !== undefined && Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function textMarkup(node: Node, rootBounds: DOMRect): string {
  const parent = node.parentElement;
  if (
    parent === null ||
    parent.closest('.ML__sr-only') !== null ||
    parent.closest('svg') !== null ||
    parent.classList.contains('mixed-text-line-break') ||
    parent.classList.contains('mixed-text-color-marker')
  ) {
    return '';
  }
  // Each literal sentinel draws its character through `::after`, so the export
  // has to read the character from the class rather than from the text node,
  // which holds only the invisible sentinel.
  const literal =
    LITERAL_SENTINEL_CHARACTERS.find(([className]) =>
      parent.classList.contains(className),
    )?.[1] ?? null;
  const style = getComputedStyle(parent, literal === null ? null : '::after');
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    Number.parseFloat(style.opacity) === 0 ||
    Number.parseFloat(style.fontSize) === 0
  ) {
    return '';
  }
  const value = literal ?? node.textContent;
  if (value === null || value === '') return '';
  let bounds: DOMRect;
  if (literal === null) {
    const range = document.createRange();
    range.selectNodeContents(node);
    bounds = range.getBoundingClientRect();
    range.detach();
  } else {
    bounds = parent.getBoundingClientRect();
  }
  if (bounds.width <= 0 || bounds.height <= 0) return '';
  const x = bounds.left - rootBounds.left;
  const y = bounds.top - rootBounds.top;
  // A CSS transform is not part of the font metrics copied below. Position the
  // SVG run at the already-transformed top edge, then apply the same vertical
  // scale from that origin. Without this, live absolute-value and norm bars
  // became short again in both portable SVG and the PNG rasterized from it.
  const scaleY = delimiterVerticalScale(parent);
  const transformed = Math.abs(scaleY - 1) > 0.000_001;
  const transform = transformed
    ? ` transform="translate(0 ${y}) scale(1 ${scaleY})"`
    : '';
  return `<text x="${x}" y="${transformed ? 0 : y}"${transform} fill="${escapeXml(style.color)}" font-family="${escapeXml(style.fontFamily)}" font-size="${escapeXml(style.fontSize)}" font-style="${escapeXml(style.fontStyle)}" font-weight="${escapeXml(style.fontWeight)}" dominant-baseline="text-before-edge" textLength="${bounds.width}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${escapeXml(value)}</text>`;
}

function embeddedSvgMarkup(svg: SVGSVGElement, rootBounds: DOMRect): string {
  const bounds = svg.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return '';
  const clone = svg.cloneNode(true);
  if (!(clone instanceof SVGSVGElement)) {
    throw new Error('Equation SVG clone did not preserve its root element');
  }
  clone.setAttribute('x', String(bounds.left - rootBounds.left));
  clone.setAttribute('y', String(bounds.top - rootBounds.top));
  clone.setAttribute('width', String(bounds.width));
  clone.setAttribute('height', String(bounds.height));
  clone.style.color = getComputedStyle(svg).color;
  return new XMLSerializer().serializeToString(clone);
}

function createStagingElement(
  element: EquationElement,
  markup: string,
): { content: HTMLElement; host: HTMLElement } {
  const host = document.createElement('div');
  host.className = 'math-element';
  host.style.color = element.strokeColor;
  host.style.fontSize = `${element.fontSize}px`;
  host.style.left = '-100000px';
  host.style.lineHeight = String(element.lineSpacing ?? 1.2);
  host.style.setProperty(
    '--mixed-line-spacing',
    `${element.lineSpacing ?? 1.2}em`,
  );
  host.style.opacity = '1';
  host.style.pointerEvents = 'none';
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.transform = 'none';
  host.style.width = 'max-content';
  const content = document.createElement('div');
  content.className = isMathOnlyMixedSource(element.source)
    ? 'math-element__content'
    : 'mixed-text-element__content';
  content.style.color = element.strokeColor;
  content.innerHTML = markup;
  decorateStaticMathMarkup(content, {
    baseColor: element.strokeColor,
    hasTextColors: element.source.includes('\\textcolor{'),
  });
  host.append(content);
  document.body.append(host);
  return { content, host };
}

/** Measures staged equation DOM and converts visible content to positioned SVG groups. */
export function equationVectorMarkupForExport(
  elements: readonly BoardElement[],
  equationMarkup: ReadonlyMap<string, string>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const element of elements) {
    if (!isEquationElement(element)) continue;
    const markup = equationMarkup.get(element.id);
    if (markup === undefined) continue;
    const { content, host } = createStagingElement(element, markup);
    try {
      const rootBounds = content.getBoundingClientRect();
      const decorations = [...content.querySelectorAll<HTMLElement>('*')]
        .map((candidate) => decorationMarkup(candidate, rootBounds))
        .join('');
      const embeddedSvg = [...content.querySelectorAll<SVGSVGElement>('svg')]
        .map((svg) => embeddedSvgMarkup(svg, rootBounds))
        .join('');
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      const text: string[] = [];
      let node = walker.nextNode();
      while (node !== null) {
        text.push(textMarkup(node, rootBounds));
        node = walker.nextNode();
      }
      result.set(
        element.id,
        `<g transform="translate(${element.x} ${element.y})" opacity="${element.opacity}">${decorations}${embeddedSvg}${text.join('')}</g>`,
      );
    } finally {
      host.remove();
    }
  }
  return result;
}
