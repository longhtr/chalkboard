/** Regenerates board, element, and owned-image identities for an independent local copy. */
import type { BoardElement } from '@chalkboard/shared';

import { MAX_BOARD_ELEMENTS } from '../model/limits';
import { copiedBoardTitle } from '../model/boardTitle';

interface LocalBoardDuplicateSource {
  elements: readonly BoardElement[];
  title: string;
}

interface PreparedLocalBoardDuplicate {
  id: string;
  record: {
    createdAt: number;
    elements: BoardElement[];
    title: string;
    updatedAt: number;
  };
}

/** Builds independent board/element/image identities while preserving visible content. */
export function prepareLocalBoardDuplicate(
  source: LocalBoardDuplicateSource,
  timestamp: number,
  createId: () => string,
): PreparedLocalBoardDuplicate {
  if (source.elements.length > MAX_BOARD_ELEMENTS) {
    throw new RangeError(
      `Boards with more than ${MAX_BOARD_ELEMENTS.toLocaleString('en-US')} objects cannot be duplicated`,
    );
  }
  const id = createId();
  return {
    id,
    record: {
      createdAt: timestamp,
      elements: source.elements.map((element) => ({
        ...element,
        id: createId(),
      })),
      title: copiedBoardTitle(source.title),
      updatedAt: timestamp,
    },
  };
}
