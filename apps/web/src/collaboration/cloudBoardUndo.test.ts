/** Proves one gesture is one undo step, and that a peer's work is never undone. */
import type { BoardElement } from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  createCloudBoardUndoManager,
  readCloudBoard,
  updateCloudBoard,
  writeCloudBoard,
} from './cloudBoardModel';

function shape(width: number): BoardElement {
  return {
    backgroundColor: 'transparent',
    cornerRadius: 0,
    createdBy: 'author',
    height: 40,
    id: 'shape-1',
    opacity: 1,
    rotation: 0,
    shapeKind: 'rectangle',
    strokeColor: '#111827',
    strokeWidth: 2,
    type: 'shape',
    width,
    x: 10,
    y: 20,
  } as BoardElement;
}

describe('cloud board undo', () => {
  it('treats a whole drag as one undo step', () => {
    const document = new Y.Doc();
    writeCloudBoard(document, [shape(100)], 'Board');
    const undoManager = createCloudBoardUndoManager(document);

    // A drag publishes a revision per frame. Captured separately, the first
    // undo moved the shape a pixel or two: invisible, and read as undo doing
    // nothing at all.
    let previous = [shape(100)];
    for (const width of [104, 112, 121, 133, 140]) {
      const next = [shape(width)];
      updateCloudBoard(document, previous, next, 'Board');
      previous = next;
    }
    expect(readCloudBoard(document).elements[0]?.width).toBe(140);
    expect(undoManager.undoStack.length).toBe(1);

    undoManager.undo();
    expect(readCloudBoard(document).elements[0]?.width).toBe(100);
  });

  it('leaves a collaborator revision alone', () => {
    const document = new Y.Doc();
    writeCloudBoard(document, [shape(100)], 'Board');
    const undoManager = createCloudBoardUndoManager(document);
    updateCloudBoard(document, [shape(100)], [shape(160)], 'Board');

    // Arriving from the network rather than from this editor, so it carries no
    // local origin and is not this reader's to take back.
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(document));
    writeCloudBoard(remote, [shape(200)], 'Board');
    Y.applyUpdate(document, Y.encodeStateAsUpdate(remote), 'remote-peer');

    undoManager.undo();
    expect(readCloudBoard(document).elements[0]?.width).not.toBe(160);
  });
});
