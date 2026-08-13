/**
 * Preserves board order while composing planned canvas, SVG, text, image, and
 * equation layers under the same camera transform.
 */
import type { Camera } from '@chalkboard/shared';
import { useMemo } from 'react';

import { MathElement } from '../../math/MathElement';
import { BoardImage } from './BoardImage';
import type { CanvasSize } from '../interaction/rendering';
import { LayerCanvas } from './LayerCanvas';
import { LayerSvg } from './LayerSvg';
import { planWorkspaceLayerRendering } from '../interaction/layerRendering';
import type { WorkspaceContentLayer } from '../interaction/contentLayers';

const DENSE_EQUATION_DETAIL_THRESHOLD = 100;
const MAX_DETAILED_VISIBLE_EQUATIONS = 25;

interface LayeredContentProps {
  camera: Camera;
  canvasSize: CanvasSize;
  editingEquationId: string | undefined;
  isEquationEditorReady: boolean;
  layers: readonly WorkspaceContentLayer[];
  selectedIds: ReadonlySet<string>;
  viewportReady: boolean;
  onMeasureEquation(id: string, width: number, height: number): void;
}

export function LayeredContent({
  camera,
  canvasSize,
  editingEquationId,
  isEquationEditorReady,
  layers,
  onMeasureEquation,
  selectedIds,
  viewportReady,
}: LayeredContentProps) {
  const requestedPixelRatio = window.devicePixelRatio || 1;
  const renderingPlan = useMemo(
    () =>
      planWorkspaceLayerRendering(
        layers,
        camera,
        canvasSize,
        requestedPixelRatio,
      ),
    [camera, canvasSize, layers, requestedPixelRatio],
  );
  const visibleEquations = viewportReady
    ? layers.filter(
        (
          layer,
        ): layer is Extract<WorkspaceContentLayer, { kind: 'equation' }> =>
          layer.kind === 'equation' && layer.element.source !== '',
      )
    : [];
  const equationIndexById = new Map(
    visibleEquations.map((layer, index) => [layer.element.id, index]),
  );

  return (
    <div className="content-layer-stack">
      {layers.map((layer) => {
        if (layer.kind === 'canvas') {
          const plan = renderingPlan.layers.get(layer.key);
          if (plan === undefined) return null;
          return plan.mode === 'canvas' ? (
            <LayerCanvas
              crop={plan.crop}
              elements={layer.elements}
              key={layer.key}
              order={layer.order}
              requestedPixelRatio={plan.requestedPixelRatio}
            />
          ) : (
            <LayerSvg
              crop={plan.crop}
              elements={layer.elements}
              key={layer.key}
              order={layer.order}
            />
          );
        }
        if (layer.kind === 'image') {
          return (
            <BoardImage
              camera={camera}
              element={layer.element}
              key={layer.element.id}
              layer={layer.order}
            />
          );
        }
        const index = equationIndexById.get(layer.element.id);
        if (index === undefined) return null;
        return (
          <MathElement
            camera={camera}
            element={layer.element}
            isEditing={
              isEquationEditorReady && editingEquationId === layer.element.id
            }
            key={layer.element.id}
            layer={layer.order}
            onMeasure={onMeasureEquation}
            simplified={
              visibleEquations.length > DENSE_EQUATION_DETAIL_THRESHOLD &&
              index <
                visibleEquations.length - MAX_DETAILED_VISIBLE_EQUATIONS &&
              !selectedIds.has(layer.element.id) &&
              editingEquationId !== layer.element.id
            }
          />
        );
      })}
    </div>
  );
}
