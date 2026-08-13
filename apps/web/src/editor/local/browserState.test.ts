/** Covers valid, legacy, malformed, stale, and oversized browser-state records plus exact clear semantics. */
import type { EquationElement, ShapeElement } from '@chalkboard/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_BOARD_ELEMENTS,
  MAX_OBJECT_CLIPBOARD_CHARACTERS,
} from '../model/limits';
import { encodeBoardSnapshot } from '../model/boardSerialization';
import { requiredTestValue } from '../../test/assertions';
import {
  LOCAL_DOCUMENT_CACHE_KEY,
  LOCAL_PENDING_DOCUMENT_KEY,
  LOCAL_PENDING_TITLE_KEY,
  LOCAL_TITLE_CACHE_KEY,
} from './boardStorage';
import {
  applyPendingLocalBoardPatch,
  cachePendingLocalBoardPatch,
  localPendingBoardPatchKey,
} from './localBoardPatchRecovery';
import {
  applyPendingLocalEquationEdit,
  cachePendingLocalEquationEdit,
  localPendingEquationEditKey,
} from './localEquationRecovery';
import {
  caretPositionsKey,
  hasPendingLocalBoardRecovery,
  loadCaretPositions,
  loadInitialElements,
  loadInitialTitle,
  LOCAL_CARET_POSITIONS_KEY,
  OBJECT_CLIPBOARD_PREFIX,
  parseObjectClipboard,
  serializeObjectClipboard,
  shouldHydrateFromIndexedDb,
  storageFailureMessage,
} from './browserState';

const equation: EquationElement = {
  backgroundColor: 'transparent',
  createdBy: 'test',
  fontSize: 30,
  height: 40,
  id: 'equation',
  lineSpacing: 1.2,
  opacity: 1,
  rotation: 0,
  source: 'Before',
  strokeColor: '#111827',
  strokeStyle: 'solid',
  strokeWidth: 2,
  type: 'equation',
  width: 120,
  x: 10,
  y: 20,
};

const rectangle: ShapeElement = {
  backgroundColor: 'transparent',
  cornerRadius: 0,
  createdBy: 'test',
  height: 50,
  id: 'rectangle',
  opacity: 1,
  rotation: 0,
  shapeKind: 'rectangle',
  strokeColor: '#111827',
  strokeStyle: 'solid',
  strokeWidth: 2,
  type: 'shape',
  width: 100,
  x: 10,
  y: 20,
};

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/local');
});

afterEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('workspace persistence bootstrap', () => {
  it('imports a snapshot, caches it, and removes only snapshot hash fields', () => {
    const parameters = new URLSearchParams({
      board: encodeBoardSnapshot([rectangle]),
      keep: 'value',
      title: 'Imported board',
    });
    window.history.replaceState(null, '', `/local?mode=test#${parameters}`);

    expect(loadInitialElements()).toEqual([rectangle]);
    expect(
      JSON.parse(
        requiredTestValue(
          localStorage.getItem(LOCAL_DOCUMENT_CACHE_KEY),
          'cached imported document',
        ),
      ),
    ).toEqual([rectangle]);
    expect(localStorage.getItem(LOCAL_TITLE_CACHE_KEY)).toBe('Imported board');
    expect(window.location.pathname).toBe('/local');
    expect(window.location.search).toBe('?mode=test');
    expect(window.location.hash).toBe('#keep=value');
  });

  it('uses cached elements provisionally while reconciling IndexedDB authority', () => {
    expect(shouldHydrateFromIndexedDb()).toBe(true);
    localStorage.setItem(LOCAL_DOCUMENT_CACHE_KEY, JSON.stringify([rectangle]));
    expect(shouldHydrateFromIndexedDb()).toBe(true);
    expect(loadInitialElements()).toEqual([rectangle]);

    localStorage.removeItem(LOCAL_DOCUMENT_CACHE_KEY);
    window.history.replaceState(null, '', '/local#board=invalid');
    expect(shouldHydrateFromIndexedDb()).toBe(false);
  });

  it('prioritizes a pending crash-recovery snapshot without treating it as durable', () => {
    localStorage.setItem(LOCAL_DOCUMENT_CACHE_KEY, JSON.stringify([]));
    localStorage.setItem(
      `${LOCAL_PENDING_DOCUMENT_KEY}:local`,
      JSON.stringify([rectangle]),
    );
    localStorage.setItem(`${LOCAL_PENDING_TITLE_KEY}:local`, 'Pending title');
    localStorage.setItem(LOCAL_TITLE_CACHE_KEY, 'Durable title');

    expect(hasPendingLocalBoardRecovery()).toBe(true);
    expect(shouldHydrateFromIndexedDb()).toBe(false);
    expect(loadInitialElements()).toEqual([rectangle]);
    expect(loadInitialTitle()).toBe('Pending title');
  });

  it('recovers a compact semantic element patch over cache or IndexedDB', () => {
    const moved = { ...rectangle, x: 80 };
    localStorage.setItem(
      LOCAL_DOCUMENT_CACHE_KEY,
      JSON.stringify([rectangle, equation]),
    );
    expect(
      cachePendingLocalBoardPatch(
        [rectangle, equation],
        [moved, equation],
        'local',
      ),
    ).toBe(true);

    expect(hasPendingLocalBoardRecovery()).toBe(true);
    expect(shouldHydrateFromIndexedDb()).toBe(true);
    expect(loadInitialElements()).toEqual([moved, equation]);

    localStorage.removeItem(LOCAL_DOCUMENT_CACHE_KEY);
    expect(
      localStorage.getItem(localPendingBoardPatchKey('local')),
    ).not.toBeNull();
    expect(shouldHydrateFromIndexedDb()).toBe(true);
    expect(applyPendingLocalBoardPatch([rectangle, equation], 'local')).toEqual(
      [moved, equation],
    );
  });

  it('recovers a compact active equation edit over a cached board', () => {
    localStorage.setItem(
      LOCAL_DOCUMENT_CACHE_KEY,
      JSON.stringify([rectangle, equation]),
    );
    cachePendingLocalEquationEdit(
      {
        baseSource: equation.source,
        deleted: false,
        element: { ...equation, source: 'Recovered', width: 180 },
        isNew: false,
      },
      'local',
    );

    expect(hasPendingLocalBoardRecovery()).toBe(true);
    expect(shouldHydrateFromIndexedDb()).toBe(true);
    expect(loadInitialElements()).toEqual([
      rectangle,
      { ...equation, source: 'Recovered', width: 180 },
    ]);
  });

  it('hydrates IndexedDB before applying a compact edit when no full cache exists', () => {
    cachePendingLocalEquationEdit(
      {
        baseSource: equation.source,
        deleted: false,
        element: { ...equation, source: 'Recovered' },
        isNew: false,
      },
      'local',
    );

    expect(
      localStorage.getItem(localPendingEquationEditKey('local')),
    ).not.toBeNull();
    expect(hasPendingLocalBoardRecovery()).toBe(true);
    expect(shouldHydrateFromIndexedDb()).toBe(true);
    expect(loadInitialElements()).toEqual([]);
    expect(applyPendingLocalEquationEdit([equation], 'local')).toEqual([
      { ...equation, source: 'Recovered' },
    ]);
  });

  it('does not resurrect a stale or explicitly deleted equation edit', () => {
    cachePendingLocalEquationEdit(
      {
        baseSource: equation.source,
        deleted: false,
        element: { ...equation, source: 'Stale edit' },
        isNew: false,
      },
      'local',
    );
    expect(
      applyPendingLocalEquationEdit(
        [{ ...equation, source: 'Newer durable source' }],
        'local',
      ),
    ).toEqual([{ ...equation, source: 'Newer durable source' }]);

    cachePendingLocalEquationEdit(
      {
        baseSource: equation.source,
        deleted: true,
        element: equation,
        isNew: false,
      },
      'local',
    );
    expect(applyPendingLocalEquationEdit([equation], 'local')).toEqual([]);
  });

  it('discards malformed compact equation recovery without blocking startup', () => {
    const key = localPendingEquationEditKey('local');
    localStorage.setItem(key, '{');
    localStorage.setItem(LOCAL_DOCUMENT_CACHE_KEY, JSON.stringify([rectangle]));

    expect(hasPendingLocalBoardRecovery()).toBe(true);
    expect(loadInitialElements()).toEqual([rectangle]);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('loads valid caret positions and ignores malformed values', () => {
    localStorage.setItem(
      LOCAL_CARET_POSITIONS_KEY,
      JSON.stringify({ first: 3, negative: -1, fractional: 1.5 }),
    );
    expect([...loadCaretPositions()]).toEqual([['first', 3]]);

    localStorage.setItem(LOCAL_CARET_POSITIONS_KEY, '{');
    expect(loadCaretPositions().size).toBe(0);

    localStorage.setItem(
      caretPositionsKey('board-one'),
      JSON.stringify({ first: 7 }),
    );
    localStorage.setItem(
      caretPositionsKey('board-two'),
      JSON.stringify({ second: 9 }),
    );
    expect([...loadCaretPositions('board-one')]).toEqual([['first', 7]]);
    expect([...loadCaretPositions('board-two')]).toEqual([['second', 9]]);
  });

  it('decodes only valid Chalkboard object clipboard payloads', () => {
    expect(
      parseObjectClipboard(
        `${OBJECT_CLIPBOARD_PREFIX}${JSON.stringify([rectangle])}`,
      ),
    ).toEqual([rectangle]);
    expect(serializeObjectClipboard([rectangle])).toBe(
      `${OBJECT_CLIPBOARD_PREFIX}${JSON.stringify([rectangle])}`,
    );
    expect(parseObjectClipboard(JSON.stringify([rectangle]))).toBeNull();
    expect(parseObjectClipboard(`${OBJECT_CLIPBOARD_PREFIX}{`)).toBeNull();
    expect(
      parseObjectClipboard(
        `${OBJECT_CLIPBOARD_PREFIX}${' '.repeat(
          MAX_OBJECT_CLIPBOARD_CHARACTERS + 1,
        )}`,
      ),
    ).toBeNull();
  });

  it('describes recoverable storage failures without exposing error details', () => {
    expect(storageFailureMessage({ name: 'QuotaExceededError' })).toContain(
      'storage is full',
    );
    expect(storageFailureMessage(new Error('blocked'))).toContain(
      'storage is unavailable',
    );
  });

  it('rejects object clipboards above the board element boundary', () => {
    const oversized = Array.from(
      { length: MAX_BOARD_ELEMENTS + 1 },
      (_, index) => ({ ...rectangle, id: `clipboard-${index}` }),
    );

    expect(serializeObjectClipboard(oversized)).toBeNull();
    expect(
      parseObjectClipboard(
        `${OBJECT_CLIPBOARD_PREFIX}${JSON.stringify(oversized)}`,
      ),
    ).toBeNull();
  });
});
