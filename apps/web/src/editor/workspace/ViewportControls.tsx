/** Zoom controls expose the same bounded camera commands used by wheel and keyboard input. */
import type { Camera } from '@chalkboard/shared';

import { Icon } from '../../components/Icon';
import type { CanvasSize } from '../interaction/rendering';

interface ZoomControlsProps {
  camera: Camera;
  canvasSize: CanvasSize;
  onReset(): void;
  onZoom(amount: number, anchor: { x: number; y: number }): void;
}

export function ZoomControls({
  camera,
  canvasSize,
  onReset,
  onZoom,
}: ZoomControlsProps) {
  const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
  return (
    <div className="zoom-controls" aria-label="Zoom controls">
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => onZoom(-0.1, center)}
      >
        −
      </button>
      <button type="button" className="zoom-value" onClick={onReset}>
        {Math.round(camera.zoom * 100)}%
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        onClick={() => onZoom(0.1, center)}
      >
        +
      </button>
    </div>
  );
}

interface HistoryControlsProps {
  canRedo: boolean;
  canUndo: boolean;
  onRedo(): void;
  onUndo(): void;
}

export function HistoryControls({
  canRedo,
  canUndo,
  onRedo,
  onUndo,
}: HistoryControlsProps) {
  return (
    <div className="history-controls" aria-label="History controls">
      <button
        type="button"
        aria-label="Undo"
        data-keep-math-editor-open
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Icon name="undo" size={17} />
      </button>
      <button
        type="button"
        aria-label="Redo"
        data-keep-math-editor-open
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Icon name="redo" size={17} />
      </button>
    </div>
  );
}
