/** Projects ephemeral collaborator cursors and selections through the camera without persistence. */
import {
  selectionBounds,
  worldToScreen,
  type BoardElement,
  type Camera,
} from '@chalkboard/shared';

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
        const bounds = selectionBounds(selected);
        if (bounds === null) return [];
        const point = worldToScreen(bounds, camera);
        return (
          <span
            className="collaborator-selection"
            key={`selection-${collaborator.clientId}`}
            title={`${collaborator.name}'s selection`}
            style={{
              borderColor: collaborator.color,
              height: bounds.height * camera.zoom,
              transform: `translate(${point.x}px, ${point.y}px)`,
              width: bounds.width * camera.zoom,
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
            <span className="collaborator-cursor-pointer">◆</span>
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
