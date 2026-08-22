/** Minimal authorized cloud-board identity passed from application routing into the editor. */
import type { BoardRole } from '@chalkboard/shared';

/** Stable cloud-board identity carried between navigation and the editor. */
export interface CloudBoardSelection {
  id: string;
  role: BoardRole;
  title: string;
}
