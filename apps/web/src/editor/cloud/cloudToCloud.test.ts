/**
 * Locks the duplicate to a composition of the two transfers that already exist,
 * and to the independence that makes a copy worth having: its images must not
 * remain pointers into the board it came from.
 */
import type { BoardElement } from '@chalkboard/shared';
import { describe, expect, it, vi } from 'vitest';

import { duplicateCloudBoard } from './cloudToCloud';
import type { Board } from '../../account/api';

function imageElement(id: string, source: string): BoardElement {
  return {
    angle: 0,
    createdBy: 'someone-else',
    height: 10,
    id,
    name: 'picture.png',
    source,
    type: 'image',
    width: 10,
    x: 0,
    y: 0,
  } as unknown as BoardElement;
}

const destination: Board = {
  id: 'cloud-duplicate',
  role: 'owner',
  title: 'Board copy',
  updatedAt: new Date(0).toISOString(),
};

/**
 * Parameters are declared so the recorded calls stay typed; the duplicate's
 * whole contract is what it passes on to the upload half.
 */
function dependencies(elements: BoardElement[]) {
  return {
    copyToCloud: vi.fn(
      async (
        source: { elements: readonly BoardElement[]; title: string },
        creatorId: string,
      ) => {
        expect(creatorId).toBeTypeOf('string');
        expect(source.title).toBeTypeOf('string');
        return destination;
      },
    ),
    loadImage: vi.fn(
      async (source: string) => `data:image/png;base64,${source}`,
    ),
    // The document title is deliberately different from the record's, so a
    // copy named from the document would be caught here.
    readSnapshot: vi.fn(async (boardId: string) => {
      expect(boardId).toBeTypeOf('string');
      return { elements, title: 'Stale document title' };
    }),
  };
}

describe('duplicateCloudBoard', () => {
  it('materializes every image so the copy does not point at the original', async () => {
    const deps = dependencies([
      imageElement('one', 'https://example.test/asset-a'),
      imageElement('two', 'https://example.test/asset-b'),
      // Repeated source: downloaded once, not once per element.
      imageElement('three', 'https://example.test/asset-a'),
    ]);

    await expect(
      duplicateCloudBoard({ id: 'board-1', title: 'Board' }, 'me', deps),
    ).resolves.toEqual(destination);

    expect(deps.loadImage).toHaveBeenCalledTimes(2);
    const [source] = deps.copyToCloud.mock.calls[0] ?? [];
    expect(
      source?.elements.map((element) =>
        element.type === 'image' ? element.source : null,
      ),
    ).toEqual([
      'data:image/png;base64,https://example.test/asset-a',
      'data:image/png;base64,https://example.test/asset-b',
      'data:image/png;base64,https://example.test/asset-a',
    ]);
  });

  it('names the copy the way a duplicated device board is named', async () => {
    const deps = dependencies([]);

    await duplicateCloudBoard({ id: 'board-1', title: 'Board' }, 'me', deps);

    const [source, creatorId] = deps.copyToCloud.mock.calls[0] ?? [];
    expect(source?.title).toBe('Board copy');
    expect(creatorId).toBe('me');
  });

  it('creates nothing when the source cannot be read', async () => {
    const deps = dependencies([]);
    deps.readSnapshot.mockRejectedValue(new Error('download failed'));

    await expect(
      duplicateCloudBoard({ id: 'board-1', title: 'Board' }, 'me', deps),
    ).rejects.toThrow('download failed');
    expect(deps.copyToCloud).not.toHaveBeenCalled();
  });

  it('creates nothing when an image cannot be downloaded', async () => {
    const deps = dependencies([
      imageElement('one', 'https://example.test/asset-a'),
    ]);
    deps.loadImage.mockRejectedValue(new Error('image failed'));

    await expect(
      duplicateCloudBoard({ id: 'board-1', title: 'Board' }, 'me', deps),
    ).rejects.toThrow('image failed');
    expect(deps.copyToCloud).not.toHaveBeenCalled();
  });
});
