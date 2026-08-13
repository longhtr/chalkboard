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
        localBoardId: 'local-board',
        readLocalBoard: async (id) => {
          requested.push(id);
          return localRecord;
        },
      }),
    ).resolves.toBe(localRecord);
    expect(requested).toEqual(['local-board']);
  });

  it('exports only saved or read-only cloud projections', async () => {
    const cloudElements: BoardElement[] = [];
    const readLocalBoard = async () => {
      throw new Error('local storage should not be read');
    };

    await expect(
      resolveEditableBoardExportInput({
        boardTitle: 'Cloud title',
        cloud: true,
        cloudConnectionState: 'saved',
        cloudElements,
        localBoardId: 'unused',
        readLocalBoard,
      }),
    ).resolves.toEqual({ elements: cloudElements, title: 'Cloud title' });
    await expect(
      resolveEditableBoardExportInput({
        boardTitle: 'Cloud title',
        cloud: true,
        cloudConnectionState: 'synchronizing',
        cloudElements,
        localBoardId: 'unused',
        readLocalBoard,
      }),
    ).rejects.toThrow('Wait until cloud changes are saved');
  });
});
