/**
 * Proves structured mixed content round-trips through Yjs and reconciles in
 * place without losing row/span identity needed for collaboration and undo.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { MixedContentDocument } from './mixedContent';
import { requiredTestValue } from './testAssertions.js';
import {
  initializeYMixedContent,
  mixedContentFromYDoc,
  mixedContentRoot,
  reconcileYMixedContent,
  yMixedContentRows,
  yMixedContentSpans,
  yMixedContentText,
} from './yjsMixedContent';

const content: MixedContentDocument = {
  rows: [
    {
      spans: [
        {
          bold: false,
          color: '#1f2937',
          italic: false,
          kind: 'text',
          text: 'Hello ',
        },
        { kind: 'math', latex: 'x^2' },
      ],
    },
    { spans: [] },
  ],
  version: 1,
};

function firstText(document: Y.Doc): Y.Text {
  const rows = requiredTestValue(
    yMixedContentRows(mixedContentRoot(document)),
    'mixed-content rows',
  );
  const row = requiredTestValue(rows.get(0), 'first mixed-content row');
  const spans = requiredTestValue(yMixedContentSpans(row), 'first row spans');
  const span = requiredTestValue(spans.get(0), 'first text span');
  return requiredTestValue(yMixedContentText(span), 'first span text');
}

describe('Yjs mixed content', () => {
  it('round-trips structured rows and spans', () => {
    const document = new Y.Doc();
    initializeYMixedContent(document, content);

    expect(mixedContentFromYDoc(document)).toEqual(content);
  });

  it('reconciles source snapshots as character-level text operations', () => {
    const first = new Y.Doc();
    initializeYMixedContent(first, content);
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const mathSpan = requiredTestValue(
      requiredTestValue(content.rows[0], 'first content row').spans[1],
      'math span fixture',
    );
    const emptyRow = requiredTestValue(content.rows[1], 'empty row fixture');

    first.transact(() => {
      reconcileYMixedContent(first.getMap('./mixedContent'), {
        ...content,
        rows: [
          {
            spans: [
              {
                bold: false,
                color: '#1f2937',
                italic: false,
                kind: 'text',
                text: 'Hello A ',
              },
              mathSpan,
            ],
          },
          emptyRow,
        ],
      });
    }, 'first');
    second.transact(() => {
      reconcileYMixedContent(second.getMap('./mixedContent'), {
        ...content,
        rows: [
          {
            spans: [
              {
                bold: false,
                color: '#1f2937',
                italic: false,
                kind: 'text',
                text: 'Hello B ',
              },
              mathSpan,
            ],
          },
          emptyRow,
        ],
      });
    }, 'second');
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

    expect(mixedContentFromYDoc(first)).toEqual(mixedContentFromYDoc(second));
    expect(firstText(first).toString()).toContain('A');
    expect(firstText(first).toString()).toContain('B');
  });

  it('converges concurrent span edits and keeps undo local to its origin', () => {
    const first = new Y.Doc();
    initializeYMixedContent(first, content);
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const firstTextSpan = firstText(first);
    const secondTextSpan = firstText(second);
    const undo = new Y.UndoManager(firstTextSpan, {
      trackedOrigins: new Set(['local']),
    });
    const firstUpdates: Uint8Array[] = [];
    const secondUpdates: Uint8Array[] = [];
    first.on('update', (update) => firstUpdates.push(update));
    second.on('update', (update) => secondUpdates.push(update));

    first.transact(
      () => firstTextSpan.insert(firstTextSpan.length, '<A>'),
      'local',
    );
    second.transact(() => secondTextSpan.insert(0, '<B>'), 'second-local');
    for (const update of firstUpdates.splice(0)) Y.applyUpdate(second, update);
    for (const update of secondUpdates.splice(0)) Y.applyUpdate(first, update);

    expect(firstTextSpan.toString()).toBe(secondTextSpan.toString());
    expect(firstTextSpan.toString()).toContain('<A>');
    expect(firstTextSpan.toString()).toContain('<B>');

    undo.undo();
    for (const update of firstUpdates.splice(0)) Y.applyUpdate(second, update);
    expect(firstTextSpan.toString()).toBe(secondTextSpan.toString());
    expect(firstTextSpan.toString()).not.toContain('<A>');
    expect(firstTextSpan.toString()).toContain('<B>');
  });

  it('does not mutate an unsupported collaborative schema version', () => {
    const document = new Y.Doc();
    const root = mixedContentRoot(document);
    root.set('version', 2);
    root.set('future-field', 'preserve');

    expect(reconcileYMixedContent(root, content)).toBe(false);
    expect(root.toJSON()).toEqual({
      'future-field': 'preserve',
      version: 2,
    });
  });

  it('rejects malformed collaborative structures', () => {
    const document = new Y.Doc();
    const root = mixedContentRoot(document);
    root.set('version', 1);
    const rows = new Y.Array<Y.Map<unknown>>();
    rows.insert(0, [new Y.Map()]);
    root.set('rows', rows);

    expect(mixedContentFromYDoc(document)).toBeNull();
  });
});
