/** Uses a controllable XMLHttpRequest to prove bytes, headers, progress, decoded references, and failures. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requiredTestValue } from '../../test/assertions';
import { uploadCloudAsset } from './cloudAssets';

class FakeRequest extends EventTarget {
  readonly headers = new Map<string, string>();
  readonly upload = new EventTarget();
  method = '';
  responseText = '';
  sent: Blob | null = null;
  status = 0;
  url = '';
  withCredentials = false;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  send(content: Blob) {
    this.sent = content;
    this.upload.dispatchEvent(
      new ProgressEvent('progress', {
        lengthComputable: true,
        loaded: content.size,
        total: content.size,
      }),
    );
    this.dispatchEvent(new Event('load'));
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }
}

const image = {
  name: 'Café pixel.png',
  source: 'data:image/png;base64,aW1hZ2U=',
};

afterEach(() => vi.restoreAllMocks());

describe('uploadCloudAsset', () => {
  it('uploads binary image bytes and returns the board-scoped reference', async () => {
    const request = new FakeRequest();
    request.status = 201;
    request.responseText = JSON.stringify({
      asset: {
        height: 1,
        id: 'asset-id',
        mediaType: 'image/png',
        name: image.name,
        url: '/api/boards/board-id/assets/asset-id',
        width: 1,
      },
    });
    const progress: number[] = [];

    await expect(
      uploadCloudAsset('board id', image, {
        onProgress: (value) => progress.push(value),
        requestFactory: () => request as unknown as XMLHttpRequest,
      }),
    ).resolves.toMatchObject({ id: 'asset-id' });
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/api/boards/board%20id/assets');
    expect(request.withCredentials).toBe(true);
    expect(request.headers.get('Content-Type')).toBe('image/png');
    expect(request.headers.get('X-File-Name')).toBe(
      encodeURIComponent(image.name),
    );
    expect(
      await requiredTestValue(request.sent, 'uploaded image blob').text(),
    ).toBe('image');
    expect(progress).toEqual([0, 1, 1]);
  });

  it('returns actionable server and offline failures', async () => {
    const rejected = new FakeRequest();
    rejected.status = 400;
    rejected.responseText = JSON.stringify({ error: 'Unsafe image' });
    await expect(
      uploadCloudAsset('board', image, {
        requestFactory: () => rejected as unknown as XMLHttpRequest,
      }),
    ).rejects.toThrow('Unsafe image');

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const offline = uploadCloudAsset('board', image);
    await expect(offline).rejects.toThrow('waiting for a connection');
    await expect(offline).rejects.toMatchObject({ offline: true });
  });
});
