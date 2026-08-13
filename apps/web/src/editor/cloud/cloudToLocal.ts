/**
 * Copies an authorized cloud board into one independent local transaction.
 * Assets download with bounded concurrency, all identities regenerate, and a
 * failure leaves no partial destination.
 */
import {
  COLLABORATION_MESSAGE_SYNC,
  type BoardElement,
} from '@chalkboard/shared';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import {
  isCloudBoardSchemaSupported,
  readCloudBoard,
} from '../../collaboration/cloudBoardModel';
import { collaborationSocketUrl } from '../../collaboration/collaborationSocketUrl';
import { CLOUD_ASSET_TRANSFER_CONCURRENCY } from './cloudAssets';
import { imageDataUrlFromBlob } from '../local/localBoardImageStorage';
import {
  localBoardRepository,
  type LocalBoardSummary,
} from '../local/localBoardRepository';
import { mapConcurrently } from '../portability/mapConcurrently';

const CLOUD_SNAPSHOT_TIMEOUT_MS = 30_000;

/** Reads one authorized cloud board's current content over a temporary socket. */
export function readCloudBoardSnapshot(
  boardId: string,
  socketFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
): Promise<{ elements: BoardElement[]; title: string }> {
  const document = new Y.Doc();
  return new Promise((resolve, reject) => {
    const socket = socketFactory(collaborationSocketUrl(boardId));
    socket.binaryType = 'arraybuffer';
    let settled = false;
    const timeout = window.setTimeout(
      () => finish(new Error('Cloud board download timed out')),
      CLOUD_SNAPSHOT_TIMEOUT_MS,
    );
    const finish = (
      error?: Error,
      snapshot?: { elements: BoardElement[]; title: string },
    ) => {
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
      if (error !== undefined) reject(error);
      else if (snapshot !== undefined) resolve(snapshot);
      else reject(new Error('Cloud board download returned no content'));
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
          throw new Error('Cloud board download received a non-binary message');
        }
        const message = new Uint8Array(event.data);
        const decoder = decoding.createDecoder(message);
        if (decoding.readVarUint(decoder) !== COLLABORATION_MESSAGE_SYNC)
          return;
        const syncType = decoding.readVarUint(decoding.clone(decoder));
        const response = encoding.createEncoder();
        encoding.writeVarUint(response, COLLABORATION_MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, response, document, socket);
        if (
          encoding.length(response) > 1 &&
          socket.readyState === WebSocket.OPEN
        ) {
          socket.send(encoding.toUint8Array(response));
        }
        if (
          syncType !== syncProtocol.messageYjsSyncStep2 &&
          syncType !== syncProtocol.messageYjsUpdate
        ) {
          return;
        }
        if (!isCloudBoardSchemaSupported(document)) {
          finish(new Error('Cloud board schema is incompatible'));
          return;
        }
        finish(undefined, readCloudBoard(document));
      } catch {
        finish(new Error('Cloud board synchronization returned invalid data'));
      }
    });
    socket.addEventListener('error', () => {
      finish(new Error('Cloud board download could not connect'));
    });
    socket.addEventListener('close', () => {
      if (!settled) finish(new Error('Cloud board download was interrupted'));
    });
  });
}

/** Materializes a cloud asset URL as a self-contained data URL. */
export async function localImageSource(source: string): Promise<string> {
  if (source.startsWith('data:')) return source;
  const response = await fetch(source, { credentials: 'same-origin' });
  if (!response.ok)
    throw new Error('A cloud board image could not be downloaded');
  return imageDataUrlFromBlob(await response.blob());
}

interface CloudToLocalDependencies {
  create(title: string): Promise<LocalBoardSummary>;
  deletePermanently(boardId: string): Promise<void>;
  loadImage(source: string): Promise<string>;
  readSnapshot(
    boardId: string,
  ): Promise<{ elements: BoardElement[]; title: string }>;
  write(
    boardId: string,
    record: {
      createdAt: number;
      elements: BoardElement[];
      title: string;
      updatedAt: number;
    },
  ): Promise<void>;
}

const defaultDependencies: CloudToLocalDependencies = {
  create: (title) => localBoardRepository.create(title),
  deletePermanently: (boardId) =>
    localBoardRepository.deletePermanently(boardId),
  loadImage: localImageSource,
  readSnapshot: readCloudBoardSnapshot,
  write: async (boardId, record) => {
    await localBoardRepository.write(boardId, record);
  },
};

/** Creates an independent local board and rolls it back if any transfer step fails. */
export async function copyCloudBoardToLocal(
  boardId: string,
  dependencies: CloudToLocalDependencies = defaultDependencies,
): Promise<LocalBoardSummary> {
  const snapshot = await dependencies.readSnapshot(boardId);
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
    const copied = {
      ...element,
      createdBy: 'local' as const,
      id: crypto.randomUUID(),
    };
    if (element.type !== 'image') return copied;
    const source = imageSources.get(element.source);
    if (source === undefined) {
      throw new Error('Downloaded image transfer is missing its local source');
    }
    return { ...copied, source };
  });
  const created = await dependencies.create(snapshot.title);
  try {
    await dependencies.write(created.id, {
      createdAt: created.createdAt,
      elements,
      title: snapshot.title,
      updatedAt: Math.max(Date.now(), created.updatedAt + 1),
    });
    return created;
  } catch (error) {
    try {
      await dependencies.deletePermanently(created.id);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Local board copy failed and its incomplete destination could not be removed',
        { cause: cleanupError },
      );
    }
    throw error;
  }
}
