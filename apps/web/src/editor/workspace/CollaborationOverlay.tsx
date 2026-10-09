/** Projects ephemeral collaborator cursors and selections through the camera without persistence. */
import {
  worldToScreen,
  type BoardElement,
  type Camera,
} from '@chalkboard/shared';

import { selectionFrame } from '../interaction/interactionGeometry';
import type { CloudCollaborator } from '../../collaboration/useCloudBoard';

interface CollaborationOverlayProps {
  camera: Camera;
  collaborators: CloudCollaborator[];
  elements: BoardElement[];
}

export function CollaborationOverlay({
  camera,
  collaborators,
  elements,
}: CollaborationOverlayProps) {
  return (
    <>
      {collaborators.flatMap((collaborator) => {
        const selected = elements.filter((element) =>
          collaborator.selection.includes(element.id),
        );
        // The same frame the person selecting sees, so a turned object is
        // outlined by a turned box rather than by the upright rectangle that
        // merely encloses it. One element turns with itself; a group is
        // enclosed upright, exactly as it is for its own selector.
        const frame = selectionFrame(selected);
        if (frame === null) return [];
        const point = worldToScreen(frame.bounds, camera);
        const width = frame.bounds.width * camera.zoom;
        const height = frame.bounds.height * camera.zoom;
        // The overlay's transform origin is its top-left corner, which is what
        // makes `translate` place it. A turn has to happen about the middle
        // instead, so the box is walked to its centre, turned, and walked back.
        const transform =
          frame.rotation === 0
            ? `translate(${point.x}px, ${point.y}px)`
            : `translate(${point.x}px, ${point.y}px) translate(${width / 2}px, ${height / 2}px) rotate(${frame.rotation}deg) translate(${-width / 2}px, ${-height / 2}px)`;
        return (
          <span
            className="collaborator-selection"
            key={`selection-${collaborator.clientId}`}
            title={`${collaborator.name}'s selection`}
            style={{
              borderColor: collaborator.color,
              height,
              transform,
              width,
            }}
          />
        );
      })}
      {collaborators.flatMap((collaborator) => {
        if (collaborator.cursor === undefined) return [];
        const point = worldToScreen(collaborator.cursor, camera);
        return (
          <span
            className="collaborator-cursor"
            key={`cursor-${collaborator.clientId}`}
            style={{
              color: collaborator.color,
              transform: `translate(${point.x}px, ${point.y}px)`,
            }}
          >
            <svg
              aria-hidden="true"
              className="collaborator-cursor-pointer"
              viewBox="0 0 15 15"
            >
              <path d="M1 1 7 14 14 7Z" />
            </svg>
            <span
              className="collaborator-cursor-name"
              style={{ background: collaborator.color }}
            >
              {collaborator.name}
            </span>
          </span>
        );
      })}
    </>
  );
}
