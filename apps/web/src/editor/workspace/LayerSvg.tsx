/** Renders one bounded vector layer from escaped portable SVG element markup. */
import type { BoardElement } from '@chalkboard/shared';
import { memo, type CSSProperties } from 'react';

import { vectorElementsSvgMarkup } from '../portability/vectorSvgMarkup';
import type { WorkspaceLayerCrop } from '../interaction/layerRendering';

interface LayerSvgProps {
  crop: WorkspaceLayerCrop;
  elements: readonly BoardElement[];
  order: number;
}

const WorkspaceLayerSvgMarkup = memo(
  function WorkspaceLayerSvgMarkup({
    elements,
  }: {
    elements: readonly BoardElement[];
  }) {
    return (
      <g
        dangerouslySetInnerHTML={{
          __html: vectorElementsSvgMarkup(elements),
        }}
      />
    );
  },
  (previous, next) =>
    previous.elements.length === next.elements.length &&
    previous.elements.every(
      (element, index) => element === next.elements[index],
    ),
);

export function LayerSvg({ crop, elements, order }: LayerSvgProps) {
  const worldWidth = crop.width / crop.camera.zoom;
  const worldHeight = crop.height / crop.camera.zoom;
  const worldX = -crop.camera.x / crop.camera.zoom;
  const worldY = -crop.camera.y / crop.camera.zoom;

  return (
    <svg
      aria-hidden="true"
      className="content-layer content-layer-run"
      preserveAspectRatio="none"
      viewBox={`${worldX} ${worldY} ${worldWidth} ${worldHeight}`}
      style={
        {
          height: crop.height,
          left: crop.left,
          top: crop.top,
          width: crop.width,
          zIndex: order,
        } as CSSProperties
      }
    >
      <WorkspaceLayerSvgMarkup elements={elements} />
    </svg>
  );
}
