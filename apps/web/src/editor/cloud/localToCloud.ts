/**
 * Copies a local board into an independent cloud destination. It creates the
 * board, transfers assets, initializes Yjs, waits for durable acknowledgement,
 * and permanently removes the destination if any step fails.
 */
import {
  COLLABORATION_MESSAGE_ACKNOWLEDGEMENT,
  COLLABORATION_MESSAGE_SYNC,
  type BoardElement,
} from '@chalkboard/shared';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { decodeBoardResponse, requestApi, type Board } from '../../account/api';
import { writeCloudBoard } from '../../collaboration/cloudBoardModel';
import { collaborationSocketUrl } from '../../collaboration/collaborationSocketUrl';
import {
  CLOUD_ASSET_TRANSFER_CONCURRENCY,
  uploadCloudAsset,
} from './cloudAssets';
import { mapConcurrently } from '../portability/mapConcurrently';

const CLOUD_INITIALIZATION_TIMEOUT_MS = 30_000;
const MAX_INITIAL_CLOUD_UPDATE_BYTES = 900_000;

/** Opens one temporary socket and waits for durable acknowledgement of initial state. */
export function initializeCloudBoardSnapshot(
  boardId: string,
  elements: BoardElement[],
  title: string,
  socketFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
): Promise<void> {
  const document = new Y.Doc();
  if (!writeCloudBoard(document, elements, title)) {
    document.destroy();
    return Promise.reject(new Error('Cloud board schema is incompatible'));
  }
  const update = Y.encodeStateAsUpdate(document);
  if (update.length > MAX_INITIAL_CLOUD_UPDATE_BYTES) {
    document.destroy();
    return Promise.reject(
      new Error('This board is too large for one safe cloud initialization'),
    );
  }

  return new Promise((resolve, reject) => {
    const socket = socketFactory(collaborationSocketUrl(boardId));
    socket.binaryType = 'arraybuffer';
    let settled = false;
    const timeout = window.setTimeout(() => {
      finish(new Error('Cloud board initialization timed out'));
    }, CLOUD_INITIALIZATION_TIMEOUT_MS);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
      document.destroy();
      if (error === undefined) resolve();
      else reject(error);
    };
    socket.addEventListener('open', () => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, document);
      socket.send(encoding.toUint8Array(encoder));
    });
    socket.addEventListener('message', (event) => {
      try {
        if (!(event.data instanceof ArrayBuffer)) {
          throw new Error('Cloud board synchronization requires binary data');
        }
        const message = new Uint8Array(event.data);
        const decoder = decoding.createDecoder(message);
        const type = decoding.readVarUint(decoder);
        if (type === COLLABORATION_MESSAGE_ACKNOWLEDGEMENT) {
          if (decoding.readVarUint(decoder) > 0) finish();
          return;
        }
        if (type !== COLLABORATION_MESSAGE_SYNC) return;
        const response = encoding.createEncoder();
        encoding.writeVarUint(response, COLLABORATION_MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, response, document, socket);
        if (
          encoding.length(response) > 1 &&
          socket.readyState === WebSocket.OPEN
        ) {
          socket.send(encoding.toUint8Array(response));
        }
      } catch {
        finish(new Error('Cloud board synchronization returned invalid data'));
      }
    });
    socket.addEventListener('error', () => {
      finish(new Error('Cloud board initialization could not connect'));
    });
    socket.addEventListener('close', () => {
      if (!settled)
        finish(new Error('Cloud board initialization was interrupted'));
    });
  });
}

interface LocalToCloudDependencies {
  createBoard(title: string): Promise<Board>;
  initializeBoard(
    boardId: string,
    elements: BoardElement[],
    title: string,
  ): Promise<void>;
  removeBoard(boardId: string): Promise<void>;
  uploadAsset(
    boardId: string,
    image: { name: string; source: string },
  ): Promise<{ url: string }>;
}

const defaultDependencies: LocalToCloudDependencies = {
  async createBoard(title) {
    const result = await requestApi(
      '/api/boards',
      {
        body: JSON.stringify({ title }),
        method: 'POST',
      },
      decodeBoardResponse,
    );
    return result.board;
  },
  initializeBoard: initializeCloudBoardSnapshot,
  async removeBoard(boardId) {
    const path = `/api/boards/${encodeURIComponent(boardId)}`;
    await requestApi(path, { method: 'DELETE' });
    await requestApi(`${path}/permanent`, { method: 'DELETE' });
  },
  uploadAsset: uploadCloudAsset,
};

/** Creates an independent cloud board and rolls it back if any transfer step fails. */
export async function copyLocalBoardToCloud(
  /**
   * Any board content, wherever it was read from. Narrower than a stored local
   * record because only these two fields are transferred, which lets a cloud
   * snapshot be copied without pretending to be a device board.
   */
  source: { elements: readonly BoardElement[]; title: string },
  creatorId: string,
  dependencies: LocalToCloudDependencies = defaultDependencies,
): Promise<Board> {
  const destination = await dependencies.createBoard(source.title);
  try {
    const uniqueImages = [
      ...new Map(
        source.elements.flatMap((element) =>
          element.type === 'image'
            ? [[element.source, { name: element.name, source: element.source }]]
            : [],
        ),
      ).values(),
    ];
    const uploadedImages = await mapConcurrently(
      uniqueImages,
      CLOUD_ASSET_TRANSFER_CONCURRENCY,
      async (image) =>
        [
          image.source,
          (await dependencies.uploadAsset(destination.id, image)).url,
        ] as const,
    );
    const uploadedBySource = new Map(uploadedImages);
    const elements: BoardElement[] = source.elements.map((element) => {
      const copied = {
        ...element,
        createdBy: creatorId,
        id: crypto.randomUUID(),
      };
      if (element.type !== 'image') return copied;
      const uploadedSource = uploadedBySource.get(element.source);
      if (uploadedSource === undefined) {
        throw new Error('Uploaded image transfer is missing its cloud source');
      }
      return { ...copied, source: uploadedSource };
    });
    await dependencies.initializeBoard(destination.id, elements, source.title);
    return destination;
  } catch (error) {
    try {
      await dependencies.removeBoard(destination.id);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Cloud board copy failed and its incomplete destination could not be removed',
        { cause: cleanupError },
      );
    }
    throw error;
  }
}
