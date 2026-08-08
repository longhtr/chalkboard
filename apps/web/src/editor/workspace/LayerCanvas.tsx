/** Owns one bounded canvas layer whose backing store and world transform come from layer planning. */
import type { BoardElement } from '@chalkboard/shared';
import { useEffect, useRef, type CSSProperties } from 'react';

import { drawElements } from '../interaction/rendering';
import type { WorkspaceLayerCrop } from '../interaction/layerRendering';

interface LayerCanvasProps {
  crop: WorkspaceLayerCrop;
  elements: readonly BoardElement[];
  order: number;
  requestedPixelRatio: number;
}

export function LayerCanvas({
  crop,
  elements,
  order,
  requestedPixelRatio,
}: LayerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas !== null) {
      drawElements(canvas, {
        camera: crop.camera,
        elements,
        requestedPixelRatio,
        size: { height: crop.height, width: crop.width },
      });
    }
  }, [crop, elements, requestedPixelRatio]);

  return (
    <canvas
      aria-hidden="true"
      className="content-layer content-layer-run"
      ref={canvasRef}
      style={
        {
          height: crop.height,
          left: crop.left,
          top: crop.top,
          width: crop.width,
          zIndex: order,
        } as CSSProperties
      }
    />
  );
}
