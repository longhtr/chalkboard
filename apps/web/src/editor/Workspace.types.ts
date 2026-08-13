/** Public application-to-editor boundary; board content itself stays private to `Workspace`. */
import type { ReactNode } from 'react';

import type { CloudBoardSelection } from '../cloudBoardSelection';

/** Local/cloud identity and application-shell callbacks for the editor root. */
export interface WorkspaceProps {
  /** True only after the server authorizes the selected cloud-board route. */
  cloudAccessConfirmed?: boolean;
  cloudBoard?: CloudBoardSelection | null;
  currentUser?: { displayName: string; id: string } | null;
  /**
   * Terminal board-invitation failure, shown beside the editor's other
   * transient notices so every one of them shares a single corner.
   */
  invitationError?: string;
  localBoardId?: string;
  onDismissInvitationError?: () => void;
  /** Shell-level notices rendered inside the one workspace status stack. */
  notices?: ReactNode;
  onCloudBoardTitleReconciled?: (boardId: string, title: string) => void;
  onCloudSessionExpired?: () => void;
  onCopyLocalBoardToCloud?: () => Promise<void>;
  onCreateCloudBoard?: () => Promise<void>;
  onCreateLocalBoard?: () => void;
  onImportLocalBoard?: (
    bytes: Uint8Array,
    signal?: AbortSignal,
  ) => Promise<void>;
  onLocalBoardUnavailable?: () => void;
  onManageCloudAccess?: () => void;
  onOpenAccount?: () => void;
  onOpenBoards?: () => void;
}
