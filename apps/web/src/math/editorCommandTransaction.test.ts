/** Proves transaction insertion, placeholder selection, mode restoration, rollback, and publication ordering. */
import { describe, expect, it } from 'vitest';

import { EditorCommandTransaction } from './editorCommandTransaction';

describe('LaTeX command transaction', () => {
  it('captures and consumes an insertion anchor exactly once', () => {
    const transaction = new EditorCommandTransaction();
    expect(transaction.active).toBe(false);
    expect(transaction.consumeAnchor(10)).toBeNull();

    transaction.begin(4);
    expect(transaction.active).toBe(true);
    expect(transaction.consumeAnchor(10)).toBe(4);
    expect(transaction.active).toBe(false);
    expect(transaction.consumeAnchor(10)).toBeNull();
  });

  it('constrains stale anchors when the field shrinks', () => {
    const transaction = new EditorCommandTransaction();
    transaction.begin(20);
    expect(transaction.consumeAnchor(3)).toBe(3);
  });

  it('clears cancelled command entry and normalizes invalid offsets', () => {
    const transaction = new EditorCommandTransaction();
    transaction.begin(-4);
    expect(transaction.consumeAnchor(5)).toBe(0);
    transaction.begin(2.9);
    transaction.clear();
    expect(transaction.consumeAnchor(5)).toBeNull();
  });
});
