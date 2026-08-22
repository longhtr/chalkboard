/**
 * Progress-aware cloud image upload boundary. It validates the successful JSON
 * response before returning an immutable board-scoped asset reference.
 */
import { blobFromImageDataUrl } from '../local/localBoardImageStorage';

/** Bounds simultaneous image transfer work in either copy direction. */
export const CLOUD_ASSET_TRANSFER_CONCURRENCY = 4;

interface CloudAssetReference {
  height: number;
  id: string;
  mediaType: string;
  name: string;
  url: string;
  width: number;
}

interface CloudAssetUploadOptions {
  onProgress?: (progress: number) => void;
  requestFactory?: () => XMLHttpRequest;
}

class CloudAssetUploadError extends Error {
  readonly offline: boolean;

  constructor(message: string, options: { offline?: boolean } = {}) {
    super(message);
    this.offline = options.offline ?? false;
  }
}

type CloudAssetResponseObject = Record<string, unknown>;

function isCloudAssetResponseObject(
  value: unknown,
): value is CloudAssetResponseObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonObject(value: unknown): CloudAssetResponseObject | null {
  return isCloudAssetResponseObject(value) ? value : null;
}

function parsedResponse(
  request: XMLHttpRequest,
): CloudAssetResponseObject | null {
  try {
    return jsonObject(JSON.parse(request.responseText));
  } catch {
    return null;
  }
}

/** Uploads one data-URL image with progress and validates its asset response. */
export function uploadCloudAsset(
  boardId: string,
  image: { name: string; source: string },
  options: CloudAssetUploadOptions = {},
): Promise<CloudAssetReference> {
  const {
    onProgress = () => undefined,
    requestFactory = () => new XMLHttpRequest(),
  } = options;
  if (!navigator.onLine) {
    return Promise.reject(
      new CloudAssetUploadError(
        'Image upload is waiting for a connection. Reconnect and retry.',
        { offline: true },
      ),
    );
  }
  const content = blobFromImageDataUrl(image.source);
  return new Promise((resolve, reject) => {
    const request = requestFactory();
    request.open('POST', `/api/boards/${encodeURIComponent(boardId)}/assets`);
    request.withCredentials = true;
    request.setRequestHeader(
      'Content-Type',
      content.type || 'application/octet-stream',
    );
    request.setRequestHeader('X-File-Name', encodeURIComponent(image.name));
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    });
    request.addEventListener('load', () => {
      const response = parsedResponse(request);
      const asset = jsonObject(response?.asset);
      if (
        request.status === 201 &&
        typeof asset?.id === 'string' &&
        typeof asset.url === 'string' &&
        typeof asset.mediaType === 'string' &&
        typeof asset.name === 'string' &&
        typeof asset.width === 'number' &&
        typeof asset.height === 'number'
      ) {
        onProgress(1);
        resolve({
          height: asset.height,
          id: asset.id,
          mediaType: asset.mediaType,
          name: asset.name,
          url: asset.url,
          width: asset.width,
        });
        return;
      }
      reject(
        new CloudAssetUploadError(
          typeof response?.error === 'string'
            ? response.error
            : request.status === 403
              ? 'Edit access is required to upload this image.'
              : 'The image could not be uploaded. Try again.',
        ),
      );
    });
    request.addEventListener('error', () => {
      reject(
        new CloudAssetUploadError(
          'The image could not be uploaded. Check your connection and retry.',
          { offline: !navigator.onLine },
        ),
      );
    });
    request.addEventListener('abort', () => {
      reject(new CloudAssetUploadError('The image upload was cancelled.'));
    });
    onProgress(0);
    request.send(content);
  });
}
