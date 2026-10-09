/** Proves export dispatch, filenames, archive asset collection, cancellation, progress, and URL cleanup. */
import type { BoardElement } from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import type { LocalBoardRecord } from '../local/boardStorage';
import { resolveEditableBoardExportInput } from './workspaceExport';

const localRecord: LocalBoardRecord = {
  createdAt: 1,
  elements: [],
  mixedContentByElementId: {},
  title: 'Durable local title',
  updatedAt: 2,
};

describe('workspace export orchestration', () => {
  it('reads the authoritative local record for editable exports', async () => {
    const requested: string[] = [];

    await expect(
      resolveEditableBoardExportInput({
        boardTitle: 'Projected title',
        cloud: false,
        cloudConnectionState: 'saved',
        cloudElements: [],
        hasPendingWork: false,
        localBoardId: 'local-board',
        readLocalBoard: async (id) => {
          requested.push(id);
          return localRecord;
        },
      }),
    ).resolves.toBe(localRecord);
    expect(requested).toEqual(['local-board']);
  });

  it('refuses a cloud export only while work is still unsaved', async () => {
    const cloudElements: BoardElement[] = [];
    const readLocalBoard = async () => {
      throw new Error('local storage should not be read');
    };
    const projection = { elements: cloudElements, title: 'Cloud title' };

    await expect(
      resolveEditableBoardExportInput({
        boardTitle: 'Cloud title',
        cloud: true,
        cloudConnectionState: 'saved',
        cloudElements,
        hasPendingWork: false,
        localBoardId: 'unused',
        readLocalBoard,
      }),
    ).resolves.toEqual(projection);
    await expect(
      resolveEditableBoardExportInput({
        boardTitle: 'Cloud title',
        cloud: true,
        cloudConnectionState: 'synchronizing',
        cloudElements,
        hasPendingWork: true,
        localBoardId: 'unused',
        readLocalBoard,
      }),
    ).rejects.toThrow('Wait until cloud changes are saved');
  });

  it('exports an untouched connected board that has nothing outstanding', async () => {
    const cloudElements: BoardElement[] = [];

    await expect(
      resolveEditableBoardExportInput({
        boardTitle: 'Cloud title',
        cloud: true,
        cloudConnectionState: 'connected',
        cloudElements,
        hasPendingWork: false,
        localBoardId: 'unused',
        readLocalBoard: async () => {
          throw new Error('local storage should not be read');
        },
      }),
    ).resolves.toEqual({ elements: cloudElements, title: 'Cloud title' });
  });

  it('still exports a read-only board, which has nothing to save', async () => {
    const cloudElements: BoardElement[] = [];

    await expect(
      resolveEditableBoardExportInput({
        boardTitle: 'Cloud title',
        cloud: true,
        cloudConnectionState: 'read-only',
        cloudElements,
        hasPendingWork: true,
        localBoardId: 'unused',
        readLocalBoard: async () => {
          throw new Error('local storage should not be read');
        },
      }),
    ).resolves.toEqual({ elements: cloudElements, title: 'Cloud title' });
  });
});
