/** Renders one world-space image and reports decode failure without mutating its board record. */
import {
  worldToScreen,
  type Camera,
  type ImageElement,
} from '@chalkboard/shared';
import type { CSSProperties } from 'react';

interface BoardImageProps {
  camera: Camera;
  element: ImageElement;
  layer?: number;
}

export function BoardImage({ camera, element, layer }: BoardImageProps) {
  const position = worldToScreen(element, camera);
  return (
    <img
      alt={element.name || 'Imported image'}
      className="board-image-element"
      draggable={false}
      src={element.source}
      style={
        {
          height: element.height,
          left: position.x,
          opacity: element.opacity,
          top: position.y,
          zIndex: layer,
          transform: `scale(${camera.zoom}) rotate(${element.rotation}deg)`,
          width: element.width,
        } as CSSProperties
      }
    />
  );
}
