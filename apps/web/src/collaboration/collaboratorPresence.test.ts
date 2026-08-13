/**
 * Locks who counts as a collaborator. Yjs Awareness issues a client id per tab,
 * so without filtering, one person with two tabs open is reported as two people
 * — including to themselves.
 */
import { describe, expect, it } from 'vitest';

import { distinctCollaborators, projectCollaborators } from './useCloudBoard';

function state(
  entries: Array<[number, string, string]>,
): ReadonlyMap<number, Record<string, unknown>> {
  return new Map(
    entries.map(([clientId, name, id]) => [
      clientId,
      { user: { color: 'hsl(200 62% 52%)', id, name } },
    ]),
  );
}

describe('projectCollaborators', () => {
  it('omits every tab belonging to the local account', () => {
    const states = state([
      [1, 'Ada', 'user-ada'],
      [2, 'Ada', 'user-ada'],
      [3, 'Ada', 'user-ada'],
    ]);

    expect(projectCollaborators(states, 1, 'user-ada')).toEqual([]);
  });

  it('still reports other people who have several tabs open', () => {
    const states = state([
      [1, 'Ada', 'user-ada'],
      [2, 'Grace', 'user-grace'],
      [3, 'Grace', 'user-grace'],
    ]);

    const projected = projectCollaborators(states, 1, 'user-ada');

    expect(projected.map(({ clientId }) => clientId)).toEqual([2, 3]);
    // Two tabs are two cursors, but one person in the participant list.
    expect(distinctCollaborators(projected)).toHaveLength(1);
  });

  it('keeps peers when the viewer is anonymous', () => {
    const states = state([
      [1, 'Ada', 'user-ada'],
      [2, 'Grace', 'user-grace'],
    ]);

    expect(projectCollaborators(states, 9, null)).toHaveLength(2);
  });

  it('ignores presence without a usable name or colour', () => {
    const states = new Map<number, Record<string, unknown>>([
      [2, { user: { color: 'hsl(1 1% 1%)' } }],
      [3, { user: { name: 'Nameless' } }],
      [4, {}],
    ]);

    expect(projectCollaborators(states, 1, 'user-ada')).toEqual([]);
  });

  it('carries cursors and selections through for real peers', () => {
    const states = new Map<number, Record<string, unknown>>([
      [
        2,
        {
          cursor: { x: 12, y: 34 },
          selection: ['element-a', 7, 'element-b'],
          user: { color: 'hsl(200 62% 52%)', id: 'user-grace', name: 'Grace' },
        },
      ],
    ]);

    expect(projectCollaborators(states, 1, 'user-ada')).toEqual([
      {
        clientId: 2,
        color: 'hsl(200 62% 52%)',
        cursor: { x: 12, y: 34 },
        name: 'Grace',
        selection: ['element-a', 'element-b'],
        userId: 'user-grace',
      },
    ]);
  });
});
