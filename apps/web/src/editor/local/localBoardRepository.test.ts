/** Exercises every public local-board operation and verifies source preservation when compound operations fail. */
import 'fake-indexeddb/auto';

import { describe, expect, it, vi } from 'vitest';

import type { BoardElement } from '@chalkboard/shared';

import { requiredTestValue } from '../../test/assertions';
import { createBoardArchive } from '../portability/boardArchive';
import { localBoardRepository } from './localBoardRepository';

const equation: BoardElement = {
  backgroundColor: 'transparent',
  createdBy: 'account-user-id',
  fontSize: 30,
  height: 40,
  id: 'portable-equation',
  lineSpacing: 1.2,
  opacity: 1,
  rotation: 0,
  source: String.raw`Portable $x+1$`,
  strokeColor: '#1f2937',
  strokeWidth: 2,
  type: 'equation',
  width: 180,
  x: 0,
  y: 0,
};

describe('LocalBoardRepository editable import', () => {
  it('validates first, regenerates identity, and commits one new board', async () => {
    const archive = await createBoardArchive({
      elements: [equation],
      font: 'classic',
      title: 'Imported portable board',
    });

    const imported = await localBoardRepository.importArchive(archive.bytes);
    const stored = requiredTestValue(
      await localBoardRepository.read(imported.board.id),
      'imported local board',
    );

    expect(imported).toMatchObject({
      board: { title: 'Imported portable board' },
      font: 'classic',
    });
    expect(imported.board.id).not.toBe('local');
    expect(stored.elements).toEqual([
      expect.objectContaining({
        createdBy: 'local',
        id: expect.not.stringMatching(/^portable-equation$/u),
        source: equation.source,
      }),
    ]);
    const importedElementId = requiredTestValue(
      stored.elements[0]?.id,
      'imported element identity',
    );
    expect(Object.keys(stored.mixedContentByElementId)).toEqual([
      importedElementId,
    ]);
  });

  it('does not leave staged metadata when the atomic import write aborts', async () => {
    const archive = await createBoardArchive({
      elements: [equation],
      font: 'classic',
      title: 'Quota import',
    });
    const before = await localBoardRepository.list();
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (
          this.name === 'boards' &&
          (value as { title?: unknown }).title === 'Quota import'
        ) {
          throw new DOMException(
            'Storage quota exceeded',
            'QuotaExceededError',
          );
        }
        return key === undefined
          ? originalPut.call(this, value)
          : originalPut.call(this, value, key);
      });

    try {
      await expect(
        localBoardRepository.importArchive(archive.bytes),
      ).rejects.toMatchObject({ name: 'QuotaExceededError' });
    } finally {
      put.mockRestore();
    }
    expect(await localBoardRepository.list()).toEqual(before);
  });

  it('cancels before staging and leaves the board library unchanged', async () => {
    const archive = await createBoardArchive({
      elements: [equation],
      font: 'classic',
      title: 'Cancelled import',
    });
    const before = await localBoardRepository.list();
    const controller = new AbortController();
    controller.abort();

    await expect(
      localBoardRepository.importArchive(archive.bytes, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await localBoardRepository.list()).toEqual(before);
  });

  it('does not create a board when archive validation fails', async () => {
    const before = await localBoardRepository.list();

    await expect(
      localBoardRepository.importArchive(new Uint8Array([1, 2, 3])),
    ).rejects.toThrow();

    expect(await localBoardRepository.list()).toEqual(before);
  });
});
