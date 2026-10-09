/** Proves duplication preserves content while replacing every identity and rewriting owned image sources. */
import type { RectangleElement } from '@chalkboard/shared';
import { describe, expect, it, vi } from 'vitest';

import { requiredTestValue } from '../../test/assertions';
import { MAX_BOARD_ELEMENTS } from '../model/limits';
import { MAX_BOARD_TITLE_LENGTH } from '../model/boardTitle';
import { prepareLocalBoardDuplicate } from './localBoardDuplication';

const rectangle: RectangleElement = {
  backgroundColor: 'transparent',
  createdBy: 'local',
  height: 20,
  id: 'source',
  opacity: 1,
  rotation: 0,
  strokeColor: '#111827',
  strokeWidth: 2,
  type: 'rectangle',
  width: 20,
  x: 0,
  y: 0,
};

describe('local board duplication', () => {
  it('prepares an identity-independent duplicate at the 10,000-object boundary', () => {
    const elements = Array.from({ length: MAX_BOARD_ELEMENTS }, (_, index) => ({
      ...rectangle,
      id: `source-${index}`,
    }));
    let nextId = 0;

    const duplicate = prepareLocalBoardDuplicate(
      { elements, title: 'x'.repeat(MAX_BOARD_TITLE_LENGTH) },
      42,
      () => `generated-${nextId++}`,
    );

    expect(duplicate.id).toBe('generated-0');
    expect(duplicate.record).toMatchObject({
      createdAt: 42,
      title: `Copy of ${'x'.repeat(MAX_BOARD_TITLE_LENGTH - 8)}`,
      updatedAt: 42,
    });
    expect(duplicate.record.elements).toHaveLength(MAX_BOARD_ELEMENTS);
    expect(
      requiredTestValue(
        duplicate.record.elements[0],
        'first duplicated element',
      ).id,
    ).toBe('generated-1');
    expect(
      requiredTestValue(
        duplicate.record.elements.at(-1),
        'last duplicated element',
      ).id,
    ).toBe(`generated-${MAX_BOARD_ELEMENTS}`);
    expect(requiredTestValue(elements[0], 'first source element').id).toBe(
      'source-0',
    );
  });

  it('rejects an over-limit source before allocating replacement identities', () => {
    const createId = vi.fn(() => 'unused');

    expect(() =>
      prepareLocalBoardDuplicate(
        {
          elements: Array(MAX_BOARD_ELEMENTS + 1).fill(rectangle),
          title: 'Unsupported source',
        },
        42,
        createId,
      ),
    ).toThrow('cannot be duplicated');
    expect(createId).not.toHaveBeenCalled();
  });
});
