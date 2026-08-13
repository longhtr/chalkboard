/** Proves local-to-cloud identity/asset transfer, durable initialization, bounded concurrency, and rollback. */
import { describe, expect, it, vi } from 'vitest';

import type { BoardElement } from '@chalkboard/shared';

import type { Board } from '../../account/api';
import { requiredTestValue } from '../../test/assertions';
import type { LocalBoardRecord } from '../local/boardStorage';
import {
  copyLocalBoardToCloud,
  initializeCloudBoardSnapshot,
} from './localToCloud';

const imageSource =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const equation: BoardElement = {
  backgroundColor: 'transparent',
  createdBy: 'local',
  fontSize: 30,
  height: 40,
  id: 'local-equation',
  lineSpacing: 1.2,
  opacity: 1,
  rotation: 0,
  source: String.raw`Cloud $x+1$`,
  strokeColor: '#111827',
  strokeWidth: 2,
  type: 'equation',
  width: 160,
  x: 0,
  y: 0,
};

const image: BoardElement = {
  backgroundColor: 'transparent',
  createdBy: 'local',
  height: 80,
  id: 'local-image',
  name: 'pixel.png',
  opacity: 1,
  rotation: 0,
  source: imageSource,
  strokeColor: 'transparent',
  strokeWidth: 0,
  type: 'image',
  width: 80,
  x: 180,
  y: 0,
};

const source: LocalBoardRecord = {
  createdAt: 1,
  elements: [equation, image, { ...image, id: 'second-local-image' }],
  mixedContentByElementId: {},
  title: 'Cloud copy',
  updatedAt: 2,
};

const destination: Board = {
  id: 'cloud-destination',
  role: 'owner',
  title: 'Cloud copy',
  updatedAt: new Date(0).toISOString(),
};

describe('local-to-cloud copy', () => {
  it('uploads unique assets, regenerates identity, and initializes one snapshot', async () => {
    const uploadAsset = vi
      .fn()
      .mockResolvedValue({ url: '/api/boards/cloud-destination/assets/asset' });
    const initializeBoard = vi.fn().mockResolvedValue(undefined);
    const original = structuredClone(source);

    await expect(
      copyLocalBoardToCloud(source, 'cloud-user', {
        createBoard: vi.fn().mockResolvedValue(destination),
        initializeBoard,
        removeBoard: vi.fn().mockResolvedValue(undefined),
        uploadAsset,
      }),
    ).resolves.toEqual(destination);

    expect(uploadAsset).toHaveBeenCalledOnce();
    expect(uploadAsset).toHaveBeenCalledWith(destination.id, {
      name: 'pixel.png',
      source: imageSource,
    });
    expect(initializeBoard).toHaveBeenCalledOnce();
    const initialized = requiredTestValue(
      initializeBoard.mock.calls[0],
      'cloud destination initialization',
    )[1] as BoardElement[];
    expect(initialized).toHaveLength(3);
    expect(initialized.map(({ id }) => id)).not.toContain('local-equation');
    expect(initialized.map(({ createdBy }) => createdBy)).toEqual([
      'cloud-user',
      'cloud-user',
      'cloud-user',
    ]);
    expect(initialized.filter((element) => element.type === 'image')).toEqual([
      expect.objectContaining({
        source: '/api/boards/cloud-destination/assets/asset',
      }),
      expect.objectContaining({
        source: '/api/boards/cloud-destination/assets/asset',
      }),
    ]);
    expect(source).toEqual(original);
  });

  it('removes a failed destination without changing the local source', async () => {
    const removeBoard = vi.fn().mockResolvedValue(undefined);
    const original = structuredClone(source);

    await expect(
      copyLocalBoardToCloud(source, 'cloud-user', {
        createBoard: vi.fn().mockResolvedValue(destination),
        initializeBoard: vi.fn().mockRejectedValue(new Error('write failed')),
        removeBoard,
        uploadAsset: vi.fn().mockResolvedValue({ url: '/asset' }),
      }),
    ).rejects.toThrow('write failed');

    expect(removeBoard).toHaveBeenCalledWith(destination.id);
    expect(source).toEqual(original);
  });

  it('reports when failed-destination cleanup also fails', async () => {
    await expect(
      copyLocalBoardToCloud(source, 'cloud-user', {
        createBoard: vi.fn().mockResolvedValue(destination),
        initializeBoard: vi.fn().mockRejectedValue(new Error('write failed')),
        removeBoard: vi.fn().mockRejectedValue(new Error('cleanup failed')),
        uploadAsset: vi.fn().mockResolvedValue({ url: '/asset' }),
      }),
    ).rejects.toThrow(
      'Cloud board copy failed and its incomplete destination could not be removed',
    );
  });

  it('rejects an initial Yjs update above the collaboration payload bound', async () => {
    const oversized = {
      ...equation,
      source: `text $${'x'.repeat(950_000)}$`,
    };
    const socketFactory = vi.fn();

    await expect(
      initializeCloudBoardSnapshot(
        '00000000-0000-4000-8000-000000000000',
        [oversized],
        'Oversized',
        socketFactory,
      ),
    ).rejects.toThrow('too large');
    expect(socketFactory).not.toHaveBeenCalled();
  });
});
