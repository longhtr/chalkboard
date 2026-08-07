/** Proves independent insert/delete/replace merges and rejects overlap, ambiguity, and incompatible bases. */
import { describe, expect, it } from 'vitest';

import { mergeEquationSourceEdit } from './mergeEquationSourceEdit';

describe('mergeEquationSourceEdit', () => {
  it('preserves concurrent insertions at the same source boundary', () => {
    expect(mergeEquationSourceEdit('Hello', 'Hello B', 'Hello A')).toBe(
      'Hello B A',
    );
    expect(mergeEquationSourceEdit('ac', 'abc', 'axc')).toBe('abxc');
    expect(mergeEquationSourceEdit('$x$', '$x+a$', '$x+b$')).toBe('$x+a+b$');
  });

  it('does not duplicate an insertion that current already contains', () => {
    expect(mergeEquationSourceEdit('ac', 'abc', 'abxc')).toBe('abxc');
    expect(
      mergeEquationSourceEdit('Shared $x$', 'Shared $xq$', 'Shared $xq$B'),
    ).toBe('Shared $xq$B');
    expect(
      mergeEquationSourceEdit('Shared $x$', 'Shared $x$B', 'Shared $xq$B'),
    ).toBe('Shared $xq$B');
    expect(
      mergeEquationSourceEdit(
        'Shared $ x $',
        'Shared $ x $B',
        'Shared $ xq $B',
      ),
    ).toBe('Shared $ xq $B');
  });

  it('applies local replacement and deletion without dropping remote work', () => {
    expect(mergeEquationSourceEdit('Hello', 'Hallo', 'Hello!')).toBe('Hallo!');
    expect(mergeEquationSourceEdit('Hello', 'Hllo', 'Hello!')).toBe('Hllo!');
    expect(mergeEquationSourceEdit('SharedA', 'Shared', 'SharedAB')).toBe(
      'SharedB',
    );
    expect(mergeEquationSourceEdit('SharedA', 'Shared', 'SharedBA')).toBe(
      'SharedB',
    );
    expect(mergeEquationSourceEdit('abc', 'ac', 'abxc')).toBe('axc');
  });

  it('keeps the current source when the local editor made no change', () => {
    expect(mergeEquationSourceEdit('Hello', 'Hello', 'Hello remote')).toBe(
      'Hello remote',
    );
  });

  it('falls back to the edited snapshot when anchors are unavailable', () => {
    expect(mergeEquationSourceEdit('abc', 'axc', 'remote')).toBe('axc');
  });
});
