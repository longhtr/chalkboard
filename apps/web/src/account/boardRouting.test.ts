/** Locks canonical route construction and rejects malformed, extra, or incorrectly encoded board paths. */
import { describe, expect, it } from 'vitest';

import {
  boardPath,
  isBoardSpecificPath,
  localBoardPath,
  readBoardRoute,
} from './boardRouting';

describe('board routing', () => {
  it('recognizes local, cloud, and default routes', () => {
    expect(readBoardRoute('/')).toEqual({ kind: 'default' });
    expect(readBoardRoute('/local')).toEqual({ boardId: null, kind: 'local' });
    expect(readBoardRoute('/local/')).toEqual({ boardId: null, kind: 'local' });
    expect(readBoardRoute('/local/board%20one')).toEqual({
      boardId: 'board one',
      kind: 'local',
    });
    expect(readBoardRoute('/boards/board-1')).toEqual({
      boardId: 'board-1',
      kind: 'cloud',
    });
    expect(readBoardRoute('/boards/board%20one/')).toEqual({
      boardId: 'board one',
      kind: 'cloud',
    });
    expect(readBoardRoute('/other')).toEqual({ kind: 'default' });
    expect(readBoardRoute('/boards/%')).toEqual({ kind: 'default' });
  });

  it('distinguishes explicit board routes from entry and compatibility paths', () => {
    expect(isBoardSpecificPath('/')).toBe(false);
    expect(isBoardSpecificPath('/other')).toBe(false);
    expect(isBoardSpecificPath('/local')).toBe(false);
    expect(isBoardSpecificPath('/local/board-one')).toBe(true);
    expect(isBoardSpecificPath('/boards/board-one')).toBe(true);
  });

  it('encodes local and cloud board paths', () => {
    expect(boardPath('board one/two')).toBe('/boards/board%20one%2Ftwo');
    expect(localBoardPath('board one/two')).toBe('/local/board%20one%2Ftwo');
  });
});
