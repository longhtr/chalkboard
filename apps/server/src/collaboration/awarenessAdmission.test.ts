/**
 * Builds raw Awareness frames to prove decode-before-apply behavior, ownership,
 * size/client limits, removal, replacement, and malformed-frame rejection.
 */
import { describe, expect, it } from 'vitest';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';

import {
  CollaborationAwarenessAdmission,
  CollaborationAwarenessAdmissionError,
  type CollaborationAwarenessLimits,
} from './awarenessAdmission.js';
import { awarenessUpdate } from './awarenessTestProtocol.js';

function awareness(): awarenessProtocol.Awareness {
  const value = new awarenessProtocol.Awareness(new Y.Doc());
  value.setLocalState(null);
  return value;
}

function limits(overrides: Partial<CollaborationAwarenessLimits> = {}) {
  return {
    clientsPerConnection: 2,
    historicalClientsPerRoom: 4,
    roomBytes: 1_024,
    roomClients: 2,
    updateBytes: 1_024,
    ...overrides,
  };
}

describe('collaboration awareness admission', () => {
  it('accepts exact update-byte and connection-client boundaries', () => {
    const owner = {};
    const value = awareness();
    const update = awarenessUpdate([
      { clientId: 1, clock: 1, state: { cursor: [1, 2] } },
      { clientId: 2, clock: 1, state: { cursor: [3, 4] } },
    ]);
    const admission = new CollaborationAwarenessAdmission<object>(
      limits({ updateBytes: update.byteLength }),
    );
    const plan = admission.inspect(update, new Set(), new Map(), owner, value);
    awarenessProtocol.applyAwarenessUpdate(value, update, owner);
    admission.commit(plan, value);

    expect([...value.getStates().keys()].sort()).toEqual([1, 2]);
    expect(() =>
      admission.inspect(
        awarenessUpdate([{ clientId: 3, clock: 1, state: { cursor: [5, 6] } }]),
        new Set([1, 2]),
        new Map([
          [1, owner],
          [2, owner],
        ]),
        owner,
        value,
      ),
    ).toThrow('too many awareness clients');
    value.destroy();
  });

  it('admits the 1,000 selected-ID workload within the default byte cap', () => {
    const owner = {};
    const value = awareness();
    const update = awarenessUpdate([
      {
        clientId: 3,
        clock: 1,
        state: {
          selectedIds: Array.from(
            { length: 1_000 },
            (_, index) =>
              `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          ),
        },
      },
    ]);
    const admission = new CollaborationAwarenessAdmission<object>();

    expect(update.byteLength).toBeLessThanOrEqual(64 * 1_024);
    expect(() =>
      admission.inspect(update, new Set(), new Map(), owner, value),
    ).not.toThrow();
    value.destroy();
  });

  it('rejects an update one byte beyond its exact byte boundary', () => {
    const owner = {};
    const value = awareness();
    const update = awarenessUpdate([
      { clientId: 1, clock: 1, state: { value: 'bounded' } },
    ]);
    const admission = new CollaborationAwarenessAdmission<object>(
      limits({ updateBytes: update.byteLength - 1 }),
    );

    expect(() =>
      admission.inspect(update, new Set(), new Map(), owner, value),
    ).toThrow(CollaborationAwarenessAdmissionError);
    value.destroy();
  });

  it('bounds aggregate room awareness bytes', () => {
    const firstOwner = {};
    const secondOwner = {};
    const value = awareness();
    const first = awarenessUpdate([
      { clientId: 1, clock: 1, state: { value: 'first' } },
    ]);
    const second = awarenessUpdate([
      { clientId: 2, clock: 1, state: { value: 'second' } },
    ]);
    const admission = new CollaborationAwarenessAdmission<object>(
      limits({ roomBytes: first.byteLength + second.byteLength - 1 }),
    );
    const plan = admission.inspect(
      first,
      new Set(),
      new Map(),
      firstOwner,
      value,
    );
    awarenessProtocol.applyAwarenessUpdate(value, first, firstOwner);
    admission.commit(plan, value);

    expect(() =>
      admission.inspect(
        second,
        new Set(),
        new Map([[1, firstOwner]]),
        secondOwner,
        value,
      ),
    ).toThrow('byte limit');
    value.destroy();
  });

  it('prevents one connection from updating or removing another owner', () => {
    const firstOwner = {};
    const secondOwner = {};
    const value = awareness();
    const admission = new CollaborationAwarenessAdmission<object>(limits());
    const owners = new Map([[7, firstOwner]]);

    for (const state of [{ cursor: [1, 2] }, null]) {
      expect(() =>
        admission.inspect(
          awarenessUpdate([{ clientId: 7, clock: 2, state }]),
          new Set(),
          owners,
          secondOwner,
          value,
        ),
      ).toThrow('another connection');
    }
    value.destroy();
  });

  it('bounds historical client identifiers after owned state removal', () => {
    const owner = {};
    const value = awareness();
    const admission = new CollaborationAwarenessAdmission<object>(
      limits({ historicalClientsPerRoom: 2 }),
    );
    const add = awarenessUpdate([
      { clientId: 7, clock: 1, state: { cursor: [1, 2] } },
    ]);
    let plan = admission.inspect(add, new Set(), new Map(), owner, value);
    awarenessProtocol.applyAwarenessUpdate(value, add, owner);
    admission.commit(plan, value);
    const remove = awarenessUpdate([{ clientId: 7, clock: 2, state: null }]);
    plan = admission.inspect(
      remove,
      new Set([7]),
      new Map([[7, owner]]),
      owner,
      value,
    );
    awarenessProtocol.applyAwarenessUpdate(value, remove, owner);
    admission.commit(plan, value);

    expect(() =>
      admission.inspect(
        awarenessUpdate([{ clientId: 8, clock: 1, state: { cursor: [] } }]),
        new Set(),
        new Map(),
        owner,
        value,
      ),
    ).toThrow('historical awareness clients');
    value.destroy();
  });

  // A browser hides presence belonging to its own account, so an unbound
  // identifier would let a member erase their cursor, selection, and avatar
  // from one specific person's view.
  describe('published presence identity', () => {
    const presence = (id: unknown) =>
      awarenessUpdate([
        {
          clientId: 1,
          clock: 1,
          state: {
            cursor: [1, 2],
            user: { color: '#2f8fbf', id, name: 'Ada' },
          },
        },
      ]);

    it('refuses presence claiming another account', () => {
      const value = awareness();
      const admission = new CollaborationAwarenessAdmission<object>(limits());

      expect(() =>
        admission.inspect(
          presence('user-grace'),
          new Set(),
          new Map(),
          {},
          value,
          'user-ada',
        ),
      ).toThrow(CollaborationAwarenessAdmissionError);
      expect(value.getStates().size).toBe(0);
      value.destroy();
    });

    it.each([
      ['the connection account', 'user-ada'],
      ['no account at all', undefined],
    ])('admits presence publishing %s', (_label, id) => {
      const owner = {};
      const value = awareness();
      const admission = new CollaborationAwarenessAdmission<object>(limits());
      const update = presence(id);

      const plan = admission.inspect(
        update,
        new Set(),
        new Map(),
        owner,
        value,
        'user-ada',
      );
      awarenessProtocol.applyAwarenessUpdate(value, update, owner);
      admission.commit(plan, value);

      expect([...value.getStates().keys()]).toEqual([1]);
      value.destroy();
    });

    it('refuses a non-string identifier rather than ignoring it', () => {
      const value = awareness();
      const admission = new CollaborationAwarenessAdmission<object>(limits());

      expect(() =>
        admission.inspect(
          presence(null),
          new Set(),
          new Map(),
          {},
          value,
          'user-ada',
        ),
      ).toThrow('claims another account');
      value.destroy();
    });

    it('enforces nothing when no account was authenticated', () => {
      const owner = {};
      const value = awareness();
      const admission = new CollaborationAwarenessAdmission<object>(limits());
      const update = presence('user-grace');

      const plan = admission.inspect(
        update,
        new Set(),
        new Map(),
        owner,
        value,
      );
      awarenessProtocol.applyAwarenessUpdate(value, update, owner);
      admission.commit(plan, value);

      expect([...value.getStates().keys()]).toEqual([1]);
      value.destroy();
    });
  });
});
