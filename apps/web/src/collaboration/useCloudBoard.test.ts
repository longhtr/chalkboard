/**
 * Drives a controllable WebSocket/Yjs client through sync, local publication,
 * ordered acknowledgements, presence, read-only access, reconnect, and teardown.
 */
import type { BoardElement } from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import cloudBoardV0 from '../test/fixtures/cloud-board-v0.json';
import { requiredTestValue } from '../test/assertions';
import {
  applyOfflineBoardDiff,
  applyPendingCloudUpdates,
  createCloudBoardUndoManager,
  isCloudBoardSchemaSupported,
  readCloudBoard,
  updateCloudBoard,
  writeCloudBoard,
} from './cloudBoardModel';

function equation(
  id: string,
  source: string,
): Extract<BoardElement, { type: 'equation' }> {
  return {
    backgroundColor: 'transparent',
    createdBy: 'test',
    fontSize: 25,
    height: 40,
    id,
    lineSpacing: 1.2,
    opacity: 1,
    rotation: 0,
    source,
    strokeColor: '#111827',
    strokeWidth: 2,
    type: 'equation',
    width: 180,
    x: 10,
    y: 20,
  };
}

function shuffled<T>(values: T[], seed: number): T[] {
  const result = [...values];
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    const currentValue = requiredTestValue(
      result[index],
      'current shuffle value',
    );
    const targetValue = requiredTestValue(
      result[target],
      'target shuffle value',
    );
    [result[index], result[target]] = [targetValue, currentValue];
  }
  return result;
}

function rectangle(id: string, x: number): BoardElement {
  return {
    backgroundColor: 'transparent',
    cornerRadius: 0,
    createdBy: 'test',
    height: 80,
    id,
    opacity: 1,
    rotation: 0,
    shapeKind: 'rectangle',
    strokeColor: '#111827',
    strokeStyle: 'solid',
    strokeWidth: 2,
    type: 'shape',
    width: 120,
    x,
    y: 20,
  };
}

describe('cloud board Yjs model', () => {
  it('round-trips ordered elements and replaces deleted records', () => {
    const document = new Y.Doc();
    const first = rectangle('first', 10);
    const second = rectangle('second', 200);

    writeCloudBoard(document, [first, second], 'Geometry');
    expect(readCloudBoard(document)).toEqual({
      elements: [first, second],
      title: 'Geometry',
    });

    writeCloudBoard(document, [{ ...second, x: 240 }], 'Geometry II');
    expect(readCloudBoard(document)).toEqual({
      elements: [{ ...second, x: 240 }],
      title: 'Geometry II',
    });
  });

  it('normalizes cloud titles at the collaborative boundary', () => {
    const document = new Y.Doc();
    writeCloudBoard(document, [], `  ${'x'.repeat(200)}  `);

    expect(readCloudBoard(document).title).toBe('x'.repeat(160));
    updateCloudBoard(document, [], [], '   ');
    expect(readCloudBoard(document).title).toBe('Untitled board');
  });

  it('updates only changed identities when order remains stable', () => {
    const document = new Y.Doc();
    const first = rectangle('first', 10);
    const second = rectangle('second', 200);
    const baseline = [first, second];
    writeCloudBoard(document, baseline, 'Before');

    const edited = { ...second, x: 240 };
    expect(updateCloudBoard(document, baseline, [first, edited], 'After')).toBe(
      true,
    );
    expect(readCloudBoard(document)).toEqual({
      elements: [first, edited],
      title: 'After',
    });
  });

  it('stores equation rows and spans as nested Yjs records', () => {
    const document = new Y.Doc();
    const value = equation('mixed', 'Hello $x^2$');

    writeCloudBoard(document, [value], 'Mixed');

    expect(readCloudBoard(document).elements).toEqual([value]);
    const record = document
      .getMap<Y.Map<unknown>>('element-records-v2')
      .get('mixed');
    expect(document.getMap('board').get('schema-version')).toBe(1);
    const equationRecord = requiredTestValue(record, 'stored equation record');
    expect(equationRecord.get('source')).toBeUndefined();
    expect(equationRecord.get('mixedContent-v3')).toBeInstanceOf(Y.Map);
  });

  it('does not mutate unsupported board or nested-content schemas', () => {
    const futureBoard = new Y.Doc();
    futureBoard.getMap('board').set('schema-version', 2);
    futureBoard.getMap('board').set('future-field', 'preserve');
    const boardUpdates: Uint8Array[] = [];
    futureBoard.on('update', (update) => boardUpdates.push(update));

    expect(isCloudBoardSchemaSupported(futureBoard)).toBe(false);
    expect(
      writeCloudBoard(futureBoard, [rectangle('blocked', 20)], 'Blocked'),
    ).toBe(false);
    expect(
      applyOfflineBoardDiff(
        futureBoard,
        { elements: [], title: 'Before' },
        { elements: [rectangle('offline', 40)], title: 'After' },
      ),
    ).toBe(false);
    const blockedPending = [new Uint8Array([1, 2, 3])];
    expect(applyPendingCloudUpdates(futureBoard, blockedPending)).toEqual(
      blockedPending,
    );
    expect(boardUpdates).toEqual([]);
    expect(futureBoard.getMap('board').toJSON()).toEqual({
      'future-field': 'preserve',
      'schema-version': 2,
    });

    const futureMixedContent = new Y.Doc();
    writeCloudBoard(
      futureMixedContent,
      [equation('future-equation', 'Future')],
      'Future',
    );
    const record = requiredTestValue(
      futureMixedContent
        .getMap<Y.Map<unknown>>('element-records-v2')
        .get('future-equation'),
      'future equation record',
    );
    const mixedRoot = record.get('mixedContent-v3');
    if (!(mixedRoot instanceof Y.Map)) throw new Error('Missing mixed root');
    mixedRoot.set('version', 2);
    mixedRoot.set('future-field', 'preserve');
    const mixedUpdates: Uint8Array[] = [];
    futureMixedContent.on('update', (update) => mixedUpdates.push(update));

    expect(isCloudBoardSchemaSupported(futureMixedContent)).toBe(false);
    expect(
      writeCloudBoard(
        futureMixedContent,
        [equation('future-equation', 'Overwritten')],
        'Overwritten',
      ),
    ).toBe(false);
    expect(mixedUpdates).toEqual([]);
    expect(mixedRoot.toJSON()).toMatchObject({
      'future-field': 'preserve',
      version: 2,
    });
  });

  it('merges concurrent character edits within an equation text span', () => {
    const first = new Y.Doc();
    writeCloudBoard(first, [equation('shared-equation', 'Hello ')], 'Shared');
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    writeCloudBoard(first, [equation('shared-equation', 'Hello A')], 'Shared');
    writeCloudBoard(second, [equation('shared-equation', 'Hello B')], 'Shared');
    const firstUpdate = Y.encodeStateAsUpdate(
      first,
      Y.encodeStateVector(second),
    );
    const secondUpdate = Y.encodeStateAsUpdate(
      second,
      Y.encodeStateVector(first),
    );
    Y.applyUpdate(first, secondUpdate);
    Y.applyUpdate(second, firstUpdate);

    expect(readCloudBoard(first)).toEqual(readCloudBoard(second));
    const source = requiredTestValue(
      readCloudBoard(first).elements[0],
      'converged equation',
    );
    if (source.type !== 'equation') throw new Error('Expected an equation');
    expect(source.source).toContain('A');
    expect(source.source).toContain('B');
  });

  it('migrates the retained v0 cloud map fixture without resurrecting deletions', () => {
    const document = new Y.Doc();
    document.getMap('board').set('title', cloudBoardV0.title);
    const legacyElements = document.getMap<string>('elements');
    for (const { id, value } of cloudBoardV0.elements) {
      legacyElements.set(id, JSON.stringify(value));
    }
    document.getArray<string>('element-order').insert(0, cloudBoardV0.order);

    const loaded = readCloudBoard(document);
    expect(loaded.title).toBe('Retained cloud v0 board');
    expect(loaded.elements.map(({ id }) => id)).toEqual([
      'legacy-cloud-rectangle',
      'legacy-cloud-equation',
    ]);
    expect(loaded.elements[0]).toMatchObject({
      shapeKind: 'rectangle',
      type: 'shape',
    });
    expect(loaded.elements[1]).toMatchObject({
      lineSpacing: 1.2,
      source: '$x^2+y^2$',
      type: 'equation',
    });

    expect(writeCloudBoard(document, loaded.elements, loaded.title)).toBe(true);
    expect(document.getMap('elements').size).toBe(0);
    expect(document.getArray('element-order').length).toBe(0);
    expect(document.getMap('element-records-v2').size).toBe(2);

    expect(
      writeCloudBoard(
        document,
        [requiredTestValue(loaded.elements[0], 'loaded cloud element')],
        loaded.title,
      ),
    ).toBe(true);
    expect(readCloudBoard(document).elements.map(({ id }) => id)).toEqual([
      'legacy-cloud-rectangle',
    ]);
  });

  it('reads legacy equation sources and migrates them on the next write', () => {
    const document = new Y.Doc();
    const value = equation('legacy-equation', 'Legacy $x$');
    writeCloudBoard(document, [value], 'Legacy');
    const record = document
      .getMap<Y.Map<unknown>>('element-records-v2')
      .get(value.id);
    if (record === undefined) throw new Error('Missing equation record');
    record.delete('mixedContent-v3');
    record.set('source', value.source);

    expect(readCloudBoard(document).elements).toEqual([value]);
    writeCloudBoard(document, readCloudBoard(document).elements, 'Legacy');
    expect(record.get('source')).toBeUndefined();
    expect(record.get('mixedContent-v3')).toBeInstanceOf(Y.Map);
  });

  it('merges concurrent edits to independent element properties', () => {
    const first = new Y.Doc();
    writeCloudBoard(first, [rectangle('shared', 10)], 'Shared');
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    writeCloudBoard(first, [{ ...rectangle('shared', 10), x: 80 }], 'Shared');
    writeCloudBoard(second, [{ ...rectangle('shared', 10), y: 140 }], 'Shared');
    const firstUpdate = Y.encodeStateAsUpdate(
      first,
      Y.encodeStateVector(second),
    );
    const secondUpdate = Y.encodeStateAsUpdate(
      second,
      Y.encodeStateVector(first),
    );
    Y.applyUpdate(first, secondUpdate);
    Y.applyUpdate(second, firstUpdate);

    expect(readCloudBoard(first)).toEqual(readCloudBoard(second));
    expect(readCloudBoard(first).elements[0]).toMatchObject({ x: 80, y: 140 });
  });

  it('converges across generated independent and conflicting property edits', () => {
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const first = new Y.Doc();
      writeCloudBoard(first, [rectangle('generated', 0)], 'Generated');
      const second = new Y.Doc();
      Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
      const base = rectangle('generated', 0);
      writeCloudBoard(
        first,
        [
          {
            ...base,
            strokeColor: iteration % 2 === 0 ? '#514dc5' : '#111827',
            width: 120 + iteration,
            x: iteration,
          },
        ],
        'Generated',
      );
      writeCloudBoard(
        second,
        [
          {
            ...base,
            strokeColor: iteration % 3 === 0 ? '#0f766e' : '#111827',
            height: 80 + iteration,
            y: iteration * 2,
          },
        ],
        'Generated',
      );
      const firstUpdate = Y.encodeStateAsUpdate(
        first,
        Y.encodeStateVector(second),
      );
      const secondUpdate = Y.encodeStateAsUpdate(
        second,
        Y.encodeStateVector(first),
      );
      Y.applyUpdate(first, secondUpdate);
      Y.applyUpdate(second, firstUpdate);

      const firstResult = readCloudBoard(first);
      expect(firstResult).toEqual(readCloudBoard(second));
      expect(firstResult.elements[0]).toMatchObject({
        height: 80 + iteration,
        width: 120 + iteration,
        x: iteration,
        y: iteration * 2,
      });
    }
  });

  it('converges generated concurrent reorder, delete, and property campaigns', () => {
    for (let iteration = 0; iteration < 75; iteration += 1) {
      const elements = Array.from({ length: 8 }, (_, index) =>
        rectangle(`element-${index}`, index * 20),
      );
      const baseline = new Y.Doc();
      writeCloudBoard(baseline, elements, 'Generated campaign');
      const first = new Y.Doc();
      const second = new Y.Doc();
      const baselineUpdate = Y.encodeStateAsUpdate(baseline);
      Y.applyUpdate(first, baselineUpdate);
      Y.applyUpdate(second, baselineUpdate);
      const firstDeleted = new Set(
        elements
          .filter((_, index) => (index + iteration) % 7 === 0)
          .map(({ id }) => id),
      );
      const secondDeleted = new Set(
        elements
          .filter((_, index) => (index + iteration * 2) % 9 === 0)
          .map(({ id }) => id),
      );
      writeCloudBoard(
        first,
        shuffled(
          elements
            .filter(({ id }) => !firstDeleted.has(id))
            .map((element, index) => ({
              ...element,
              x: 1_000 + iteration * 10 + index,
            })),
          iteration + 1,
        ),
        'Generated campaign',
      );
      writeCloudBoard(
        second,
        shuffled(
          elements
            .filter(({ id }) => !secondDeleted.has(id))
            .map((element, index) => ({
              ...element,
              y: 2_000 + iteration * 10 + index,
            })),
          iteration + 10_000,
        ),
        'Generated campaign',
      );
      const firstUpdate = Y.encodeStateAsUpdate(
        first,
        Y.encodeStateVector(second),
      );
      const secondUpdate = Y.encodeStateAsUpdate(
        second,
        Y.encodeStateVector(first),
      );
      Y.applyUpdate(first, secondUpdate, 'remote');
      Y.applyUpdate(second, firstUpdate, 'remote');

      const firstResult = readCloudBoard(first);
      expect(firstResult).toEqual(readCloudBoard(second));
      expect(new Set(firstResult.elements.map(({ id }) => id)).size).toBe(
        firstResult.elements.length,
      );
      for (const element of firstResult.elements) {
        expect(
          firstDeleted.has(element.id) || secondDeleted.has(element.id),
        ).toBe(false);
        expect(element.x).toBeGreaterThanOrEqual(1_000);
        expect(element.y).toBeGreaterThanOrEqual(2_000);
      }
      expect(firstResult.elements).toHaveLength(
        elements.filter(
          ({ id }) => !firstDeleted.has(id) && !secondDeleted.has(id),
        ).length,
      );
    }
  });

  it('merges two clients’ raw offline updates after reconnect', () => {
    const baseline = new Y.Doc();
    writeCloudBoard(
      baseline,
      [equation('offline-equation', 'Shared ')],
      'Offline',
    );
    const first = new Y.Doc();
    const second = new Y.Doc();
    const server = new Y.Doc();
    const baselineUpdate = Y.encodeStateAsUpdate(baseline);
    Y.applyUpdate(first, baselineUpdate);
    Y.applyUpdate(second, baselineUpdate);
    Y.applyUpdate(server, baselineUpdate);
    writeCloudBoard(
      first,
      [
        equation('offline-equation', 'Shared A'),
        rectangle('first-offline-addition', 100),
      ],
      'Offline',
    );
    writeCloudBoard(
      second,
      [
        equation('offline-equation', 'Shared B'),
        rectangle('second-offline-addition', 200),
      ],
      'Offline',
    );
    const firstPending = Y.encodeStateAsUpdate(
      first,
      Y.encodeStateVector(baseline),
    );
    const secondPending = Y.encodeStateAsUpdate(
      second,
      Y.encodeStateVector(baseline),
    );

    expect(applyPendingCloudUpdates(server, [firstPending])).toHaveLength(1);
    expect(applyPendingCloudUpdates(server, [secondPending])).toHaveLength(1);
    const recovered = readCloudBoard(server);
    expect(recovered.elements.map(({ id }) => id).sort()).toEqual([
      'first-offline-addition',
      'offline-equation',
      'second-offline-addition',
    ]);
    const recoveredEquation = requiredTestValue(
      recovered.elements.find(({ id }) => id === 'offline-equation'),
      'recovered equation',
    );
    if (recoveredEquation.type !== 'equation') {
      throw new Error('Expected the recovered element to be an equation');
    }
    expect(recoveredEquation.source).toContain('A');
    expect(recoveredEquation.source).toContain('B');
  });

  it('replays pending Yjs updates once while preserving remote work', () => {
    const baseline = new Y.Doc();
    writeCloudBoard(baseline, [rectangle('shared', 10)], 'Shared');
    const offline = new Y.Doc();
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(baseline));
    const pendingUpdates: Uint8Array[] = [];
    offline.on('update', (update) => pendingUpdates.push(update));
    writeCloudBoard(offline, [rectangle('shared', 90)], 'Shared');

    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(baseline));
    writeCloudBoard(
      server,
      [rectangle('shared', 10), rectangle('remote', 300)],
      'Shared',
    );
    const replayed = applyPendingCloudUpdates(server, pendingUpdates);

    expect(replayed).toHaveLength(1);
    expect(readCloudBoard(server).elements).toEqual([
      rectangle('shared', 90),
      rectangle('remote', 300),
    ]);
    expect(applyPendingCloudUpdates(server, replayed)).toEqual([]);
  });

  it('undoes only local transactions while preserving accepted remote work', () => {
    const first = new Y.Doc();
    writeCloudBoard(first, [rectangle('shared', 10)], 'Shared');
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const undo = createCloudBoardUndoManager(first);

    writeCloudBoard(first, [rectangle('shared', 80)], 'Shared');
    writeCloudBoard(
      second,
      [rectangle('shared', 10), rectangle('remote', 300)],
      'Shared',
    );
    Y.applyUpdate(
      first,
      Y.encodeStateAsUpdate(second, Y.encodeStateVector(first)),
      'remote',
    );

    undo.undo();
    expect(readCloudBoard(first).elements).toEqual([
      rectangle('shared', 10),
      rectangle('remote', 300),
    ]);
    undo.redo();
    expect(readCloudBoard(first).elements).toEqual([
      rectangle('shared', 80),
      rectangle('remote', 300),
    ]);
  });

  it('undoes and redoes nested equation text locally', () => {
    const document = new Y.Doc();
    writeCloudBoard(document, [equation('undo-equation', 'Before')], 'Shared');
    const undo = createCloudBoardUndoManager(document);

    writeCloudBoard(
      document,
      [equation('undo-equation', 'Before after')],
      'Shared',
    );
    undo.undo();
    expect(readCloudBoard(document).elements).toEqual([
      equation('undo-equation', 'Before'),
    ]);
    undo.redo();
    expect(readCloudBoard(document).elements).toEqual([
      equation('undo-equation', 'Before after'),
    ]);
  });

  it('preserves remote additions while applying an offline property diff', () => {
    const baseline = { elements: [rectangle('shared', 10)], title: 'Shared' };
    const server = new Y.Doc();
    writeCloudBoard(server, baseline.elements, baseline.title);
    writeCloudBoard(
      server,
      [
        { ...rectangle('shared', 10), y: 160 },
        rectangle('remote-addition', 300),
      ],
      'Shared',
    );

    applyOfflineBoardDiff(server, baseline, {
      elements: [{ ...rectangle('shared', 10), x: 90 }],
      title: 'Shared',
    });

    expect(readCloudBoard(server).elements).toEqual([
      { ...rectangle('shared', 10), x: 90, y: 160 },
      rectangle('remote-addition', 300),
    ]);
  });

  it('converges through Yjs updates and ignores malformed element payloads', () => {
    const source = new Y.Doc();
    writeCloudBoard(source, [rectangle('valid', 10)], 'Shared');
    source.getMap<string>('elements').set('malformed', '{not json');

    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(source));

    expect(readCloudBoard(replica)).toEqual({
      elements: [rectangle('valid', 10)],
      title: 'Shared',
    });
  });
});
