/**
 * Duplicates an authorized cloud board into an independent one owned by the
 * caller.
 *
 * Composed from the two transfers that already existed rather than a new server
 * route: the download half of the cloud-to-local copy, then the upload half of
 * the local-to-cloud copy. Quota accounting, demo/normal partitioning, and
 * rollback therefore behave exactly as they do for either copy alone, because
 * the same board-create and asset-upload endpoints do the work.
 *
 * Images round-trip through the browser rather than being copied server side,
 * so a heavy board moves its bytes twice. That is the cost of not adding a
 * server-side asset copy, and it is why the transfer is bounded.
 */
import type { BoardElement } from '@chalkboard/shared';

import type { Board } from '../../account/api';
import { CLOUD_ASSET_TRANSFER_CONCURRENCY } from './cloudAssets';
import { localImageSource, readCloudBoardSnapshot } from './cloudToLocal';
import { copyLocalBoardToCloud } from './localToCloud';
import { copiedBoardTitle } from '../model/boardTitle';
import { MAX_BOARD_ELEMENTS } from '../model/limits';
import { mapConcurrently } from '../portability/mapConcurrently';

interface CloudBoardSnapshot {
  elements: BoardElement[];
  title: string;
}

export interface CloudToCloudDependencies {
  copyToCloud(
    source: { elements: readonly BoardElement[]; title: string },
    creatorId: string,
  ): Promise<Board>;
  loadImage(source: string): Promise<string>;
  readSnapshot(boardId: string): Promise<CloudBoardSnapshot>;
}

const defaultDependencies: CloudToCloudDependencies = {
  copyToCloud: (source, creatorId) => copyLocalBoardToCloud(source, creatorId),
  loadImage: localImageSource,
  readSnapshot: readCloudBoardSnapshot,
};

/**
 * Creates an independent cloud copy. The upload half regenerates element
 * identities and rolls its destination back on failure, so a partial duplicate
 * is never left behind.
 */
export async function duplicateCloudBoard(
  /**
   * Both fields are needed. The title is taken from the board record rather
   * than the synchronized document, because a board created through the API and
   * never opened still carries the default document title, which would name the
   * copy after nothing the reader recognizes.
   */
  source: { id: string; title: string },
  creatorId: string,
  dependencies: CloudToCloudDependencies = defaultDependencies,
): Promise<Board> {
  const snapshot = await dependencies.readSnapshot(source.id);
  if (snapshot.elements.length > MAX_BOARD_ELEMENTS) {
    throw new RangeError(
      `Boards with more than ${MAX_BOARD_ELEMENTS.toLocaleString('en-US')} objects cannot be duplicated`,
    );
  }

  // Cloud images are authorized URLs, and the upload half expects content it
  // can send. Materializing them first keeps the destination independent of the
  // source board, so deleting the original never empties the copy.
  const uniqueImageSources = [
    ...new Set(
      snapshot.elements.flatMap((element) =>
        element.type === 'image' ? [element.source] : [],
      ),
    ),
  ];
  const loadedImages = await mapConcurrently(
    uniqueImageSources,
    CLOUD_ASSET_TRANSFER_CONCURRENCY,
    async (source) => [source, await dependencies.loadImage(source)] as const,
  );
  const imageSources = new Map(loadedImages);
  const elements: BoardElement[] = snapshot.elements.map((element) => {
    if (element.type !== 'image') return element;
    const source = imageSources.get(element.source);
    if (source === undefined) {
      throw new Error('Duplicated image transfer is missing its source');
    }
    return { ...element, source };
  });

  return dependencies.copyToCloud(
    { elements, title: copiedBoardTitle(source.title) },
    creatorId,
  );
}
