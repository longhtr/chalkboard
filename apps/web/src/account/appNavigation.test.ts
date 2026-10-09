/** Proves the last-opened board is remembered per account, not shared between them. */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  forgetBoard,
  loadLastBoard,
  loadLastCloudBoard,
  rememberBoard,
  rememberedBoardId,
  type RememberedBoard,
} from './appNavigation';

const STORAGE_KEY = 'chalkboard:last-cloud-board';

function cloud(id: string): RememberedBoard {
  return {
    kind: 'cloud',
    selection: { id, role: 'owner', title: `Board ${id}` },
  };
}

function local(id: string): RememberedBoard {
  return { id, kind: 'local' };
}

describe('remembered boards', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('keeps each account on its own board', () => {
    rememberBoard('account-a', cloud('board-a'));
    rememberBoard('account-b', cloud('board-b'));

    expect(loadLastCloudBoard('account-a')?.id).toBe('board-a');
    expect(loadLastCloudBoard('account-b')?.id).toBe('board-b');
  });

  it('answers for the last signed-in account before a session is known', () => {
    rememberBoard('account-a', cloud('board-a'));
    rememberBoard('account-b', cloud('board-b'));

    // Startup runs before the session resolves.
    expect(loadLastCloudBoard()?.id).toBe('board-b');
  });

  it('offers nothing to an account that has opened no board', () => {
    rememberBoard('account-a', cloud('board-a'));

    expect(loadLastBoard('account-b')).toBeNull();
    expect(loadLastCloudBoard('account-b')).toBeNull();
  });

  it('remembers a local board as readily as a cloud one', () => {
    rememberBoard('account-a', cloud('in-cloud'));
    rememberBoard('account-a', local('on-device'));

    expect(loadLastBoard('account-a')).toEqual(local('on-device'));
    // The most recent cloud board is still reachable underneath it.
    expect(loadLastCloudBoard('account-a')?.id).toBe('in-cloud');
  });

  it('falls back to the previous board when one stops opening', () => {
    rememberBoard('account-a', cloud('older'));
    rememberBoard('account-a', cloud('newer'));

    expect(loadLastCloudBoard('account-a')?.id).toBe('newer');
    expect(forgetBoard('account-a', 'newer')).toEqual(cloud('older'));
    expect(loadLastCloudBoard('account-a')?.id).toBe('older');
  });

  it('falls back from an unreachable cloud board to a local one', () => {
    rememberBoard('account-a', local('on-device'));
    rememberBoard('account-a', cloud('revoked'));

    expect(forgetBoard('account-a', 'revoked')).toEqual(local('on-device'));
  });

  it('reports no fallback once every remembered board is gone', () => {
    rememberBoard('account-a', cloud('only'));

    expect(forgetBoard('account-a', 'only')).toBeNull();
    expect(loadLastBoard('account-a')).toBeNull();
  });

  it('leaves another account untouched when one forgets a board', () => {
    rememberBoard('account-a', cloud('shared-id'));
    rememberBoard('account-b', cloud('shared-id'));

    forgetBoard('account-a', 'shared-id');

    expect(loadLastBoard('account-a')).toBeNull();
    expect(loadLastCloudBoard('account-b')?.id).toBe('shared-id');
  });

  it('moves a reopened board back to the front without duplicating it', () => {
    rememberBoard('account-a', cloud('first'));
    rememberBoard('account-a', cloud('second'));
    rememberBoard('account-a', cloud('first'));

    expect(loadLastCloudBoard('account-a')?.id).toBe('first');
    expect(forgetBoard('account-a', 'first')).toEqual(cloud('second'));
    // Only one entry for the reopened board, so the list is now empty.
    expect(forgetBoard('account-a', 'second')).toBeNull();
  });

  it('caps how many boards an account keeps as fallbacks', () => {
    for (let index = 0; index < 8; index += 1) {
      rememberBoard('account-a', cloud(`board-${index}`));
    }
    let remaining = 0;
    let current = loadLastBoard('account-a');
    while (current !== null) {
      remaining += 1;
      current = forgetBoard('account-a', rememberedBoardId(current));
    }
    expect(remaining).toBe(5);
  });

  it('discards the shared entry written before boards were per account', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ id: 'legacy', role: 'owner', title: 'Legacy' }),
    );

    // It belonged to no known account, so nobody inherits it.
    expect(loadLastBoard()).toBeNull();
    expect(loadLastBoard('account-a')).toBeNull();
  });

  it('survives unparsable storage', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');

    expect(loadLastBoard('account-a')).toBeNull();
    rememberBoard('account-a', cloud('fresh'));
    expect(loadLastCloudBoard('account-a')?.id).toBe('fresh');
  });
});
