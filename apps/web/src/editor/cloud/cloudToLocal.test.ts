/** Proves cloud-to-local identity regeneration, asset transfer/deduplication, bounded work, and rollback. */
import type { BoardElement } from '@chalkboard/shared';
import { describe, expect, it, vi } from 'vitest';

import { requiredTestValue } from '../../test/assertions';
import { copyCloudBoardToLocal } from './cloudToLocal';

const equation: BoardElement = {
  backgroundColor: 'transparent',
  createdBy: 'cloud-user',
  fontSize: 30,
  height: 40,
  id: 'cloud-equation',
  lineSpacing: 1.2,
  opacity: 1,
  rotation: 0,
  source: 'Cloud text',
  strokeColor: '#111827',
  strokeWidth: 2,
  type: 'equation',
  width: 160,
  x: 0,
  y: 0,
};

const image: BoardElement = {
  backgroundColor: 'transparent',
  createdBy: 'cloud-user',
  height: 80,
  id: 'cloud-image',
  name: 'pixel.png',
  opacity: 1,
  rotation: 0,
  source: '/api/boards/cloud/assets/image',
  strokeColor: 'transparent',
  strokeWidth: 0,
  type: 'image',
  width: 80,
  x: 180,
  y: 0,
};

const created = {
  createdAt: 10,
  id: 'local-copy',
  title: 'Cloud board',
  updatedAt: 10,
};

describe('cloud-to-local copy', () => {
  it('downloads unique images and writes a local board with new identities', async () => {
    const loadImage = vi
      .fn()
      .mockResolvedValue('data:image/png;base64,aW1hZ2U=');
    const write = vi.fn().mockResolvedValue(undefined);

    await expect(
      copyCloudBoardToLocal('cloud-board', {
        create: vi.fn().mockResolvedValue(created),
        deletePermanently: vi.fn().mockResolvedValue(undefined),
        loadImage,
        readSnapshot: vi.fn().mockResolvedValue({
          elements: [equation, image, { ...image, id: 'cloud-image-two' }],
          title: 'Cloud board',
        }),
        write,
      }),
    ).resolves.toEqual(created);

    expect(loadImage).toHaveBeenCalledOnce();
    expect(loadImage).toHaveBeenCalledWith(image.source);
    expect(write).toHaveBeenCalledOnce();
    const record = requiredTestValue(
      write.mock.calls[0],
      'local destination write',
    )[1] as { elements: BoardElement[] };
    expect(record.elements.map(({ id }) => id)).not.toContain('cloud-equation');
    expect(record.elements.map(({ createdBy }) => createdBy)).toEqual([
      'local',
      'local',
      'local',
    ]);
    expect(
      record.elements.filter((element) => element.type === 'image'),
    ).toEqual([
      expect.objectContaining({ source: 'data:image/png;base64,aW1hZ2U=' }),
      expect.objectContaining({ source: 'data:image/png;base64,aW1hZ2U=' }),
    ]);
  });

  it('removes a failed local destination', async () => {
    const deletePermanently = vi.fn().mockResolvedValue(undefined);
    await expect(
      copyCloudBoardToLocal('cloud-board', {
        create: vi.fn().mockResolvedValue(created),
        deletePermanently,
        loadImage: vi.fn(),
        readSnapshot: vi.fn().mockResolvedValue({
          elements: [equation],
          title: 'Cloud board',
        }),
        write: vi.fn().mockRejectedValue(new Error('write failed')),
      }),
    ).rejects.toThrow('write failed');
    expect(deletePermanently).toHaveBeenCalledWith(created.id);
  });

  it('reports when failed-destination cleanup also fails', async () => {
    await expect(
      copyCloudBoardToLocal('cloud-board', {
        create: vi.fn().mockResolvedValue(created),
        deletePermanently: vi
          .fn()
          .mockRejectedValue(new Error('cleanup failed')),
        loadImage: vi.fn(),
        readSnapshot: vi.fn().mockResolvedValue({
          elements: [equation],
          title: 'Cloud source',
        }),
        write: vi.fn().mockRejectedValue(new Error('write failed')),
      }),
    ).rejects.toThrow(
      'Local board copy failed and its incomplete destination could not be removed',
    );
  });
});
