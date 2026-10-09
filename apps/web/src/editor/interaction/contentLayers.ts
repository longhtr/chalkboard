/**
 * Splits board order into contiguous canvas, SVG, and DOM layers. Grouping never
 * reorders elements; a new layer begins only when the required renderer changes.
 */
import {
  isEquationElement,
  isImageElement,
  type BoardElement,
  type EquationElement,
  type ImageElement,
} from '@chalkboard/shared';

interface CanvasContentLayer {
  elements: BoardElement[];
  key: string;
  kind: 'canvas';
  order: number;
}

interface EquationContentLayer {
  element: EquationElement;
  kind: 'equation';
  order: number;
}

interface ImageContentLayer {
  element: ImageElement;
  kind: 'image';
  order: number;
}

/** Ordered renderer-specific layer consumed by the workspace presentation. */
export type WorkspaceContentLayer =
  CanvasContentLayer | EquationContentLayer | ImageContentLayer;

/** Groups consecutive vector objects while retaining the board's bottom-to-top order. */
export function groupContentLayers(
  elements: readonly BoardElement[],
): WorkspaceContentLayer[] {
  const layers: WorkspaceContentLayer[] = [];
  let canvasLayer: CanvasContentLayer | null = null;

  elements.forEach((element, index) => {
    const order = index + 1;
    if (isImageElement(element)) {
      canvasLayer = null;
      layers.push({ element, kind: 'image', order });
      return;
    }
    if (isEquationElement(element)) {
      canvasLayer = null;
      layers.push({ element, kind: 'equation', order });
      return;
    }
    if (canvasLayer === null) {
      canvasLayer = {
        elements: [element],
        key: `canvas:${element.id}`,
        kind: 'canvas',
        order,
      };
      layers.push(canvasLayer);
      return;
    }
    canvasLayer.elements.push(element);
  });

  return layers;
}
