/** Proves canonical publication, line-break preservation, dimension changes, and duplicate suppression. */
import { describe, expect, it } from 'vitest';

import { EditorPublicationController } from './editorPublication';

function controller() {
  return new EditorPublicationController({
    height: 28,
    source: 'First\nSecond',
    width: 100,
  });
}

describe('active editor publication controller', () => {
  it('suppresses identical publications while accepting source or size changes', () => {
    const publication = controller();

    expect(publication.accept('First\nSecond', 100, 28)).toBe(false);
    expect(publication.accept('First\nSecond', 101, 28)).toBe(true);
    expect(publication.accept('First\nSecond!', 101, 28)).toBe(true);
    expect(publication.source).toBe('First\nSecond!');
  });

  it('keeps an explicitly synchronized remote source without publishing it', () => {
    const publication = controller();

    publication.synchronizeSource('Remote');

    expect(publication.source).toBe('Remote');
    expect(publication.accept('Remote', 100, 28)).toBe(false);
  });

  it('preserves silently flattened rows but accepts a rendered-view edit', () => {
    const publication = controller();
    expect(
      publication.stableSource({
        currentSource: 'FirstSecond',
        renderedEntrySource: 'FirstSecond',
        renderedViewEdited: false,
        sourceView: false,
      }),
    ).toBe('First\nSecond');
    expect(
      publication.stableSource({
        currentSource: 'FirstSecond!',
        renderedEntrySource: 'FirstSecond',
        renderedViewEdited: true,
        sourceView: false,
      }),
    ).toBe('FirstSecond!');
    expect(
      publication.stableSource({
        currentSource: 'ignored',
        renderedEntrySource: null,
        renderedViewEdited: true,
        sourceView: true,
      }),
    ).toBe('First\nSecond');
  });
});
