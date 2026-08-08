/**
 * Converts data URLs, blobs, and board-owned image records across browser realms.
 * Object URLs created for reads are tracked and revoked by the owning workflow.
 */
import {
  isImageElement,
  type BoardElement,
  type ImageElement,
} from '@chalkboard/shared';

import { IMAGE_BOARD_INDEX, requestResult } from './boardDatabase';
import { LEGACY_LOCAL_BOARD_ID } from './localBoardCache';
const LOCAL_IMAGE_PREFIX = 'local-image:';

/** Board-scoped immutable image blob stored separately from element JSON. */
export interface StoredImageRecord {
  blob: Blob;
  boardId?: string;
  elementId?: string;
  id: string;
}

/** Persisted board element whose local image source is an IndexedDB key. */
export type StoredBoardElement =
  | Exclude<BoardElement, ImageElement>
  | (Omit<ImageElement, 'source'> & { imageId: string });

/** Builds the deterministic image-record key for a board element. */
export function storedLocalImageId(boardId: string, elementId: string): string {
  return `${LOCAL_IMAGE_PREFIX}${boardId}:${elementId}`;
}

/** Decodes a base64 image data URL into immutable binary content. */
export function blobFromImageDataUrl(source: string): Blob {
  const match = source.match(/^data:(image\/[\w.+-]+);base64,(.*)$/is);
  if (match === null) throw new Error('Image source is not a base64 data URL');
  const [, mediaType = 'application/octet-stream', encoded = ''] = match;
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mediaType });
}

/** Encodes same- or cross-realm image blobs into compatibility data URLs. */
export async function imageDataUrlFromBlob(blob: Blob): Promise<string> {
  // Browser and fake IndexedDB realms can disagree about Blob prototypes. Use
  // the structural modern path when available, then retain FileReader fallback.
  const crossRealmBlob = blob as unknown as {
    arrayBuffer?: () => Promise<ArrayBuffer>;
    type?: string;
  };
  if (typeof crossRealmBlob.arrayBuffer === 'function') {
    const bytes = new Uint8Array(await crossRealmBlob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(offset, offset + chunkSize),
      );
    }
    return `data:${crossRealmBlob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read the stored image'));
    });
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('Could not read the stored image')),
    );
    reader.readAsDataURL(blob);
  });
}

/** Replaces image sources with deterministic keys and returns blobs to persist. */
export function storageElements(elements: BoardElement[]): {
  elements: StoredBoardElement[];
  images: ImageElement[];
} {
  const images: ImageElement[] = [];
  const storedElements = elements.map((element): StoredBoardElement => {
    if (!isImageElement(element)) return element;
    images.push(element);
    const { source: _source, ...stored } = element;
    void _source;
    return { ...stored, imageId: element.id };
  });
  return { elements: storedElements, images };
}

/** Builds one versioned board record plus separate immutable image records. */
export function prepareBoardForStorage(
  elements: BoardElement[],
  boardId = LEGACY_LOCAL_BOARD_ID,
): {
  elements: StoredBoardElement[];
  images: StoredImageRecord[];
} {
  const prepared = storageElements(elements);
  return {
    elements: prepared.elements,
    images: prepared.images.map((element) => ({
      blob: blobFromImageDataUrl(element.source),
      boardId,
      elementId: element.id,
      id: storedLocalImageId(boardId, element.id),
    })),
  };
}

/** Reads every image record belonging to one local board transaction. */
export function storedImagesForBoard(
  images: IDBObjectStore,
  boardId: string,
): Promise<StoredImageRecord[]> {
  if (boardId !== LEGACY_LOCAL_BOARD_ID) {
    return requestResult(
      images.index(IMAGE_BOARD_INDEX).getAll(boardId) as IDBRequest<
        StoredImageRecord[]
      >,
    );
  }
  return requestResult(images.getAll() as IDBRequest<StoredImageRecord[]>).then(
    (records) =>
      records.filter(
        (image) =>
          image.boardId === undefined ||
          image.boardId === LEGACY_LOCAL_BOARD_ID,
      ),
  );
}
