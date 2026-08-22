/** Locks the phone keyboard’s task tabs, essential controls, and mobile-only installation. */
import type { VirtualKeyboardLayout } from 'mathlive';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configureMobileMathKeyboard,
  MOBILE_MATH_KEYBOARD_LAYOUTS,
} from './mobileMathKeyboard';

const originalKeyboardDescriptor = Object.getOwnPropertyDescriptor(
  window,
  'mathVirtualKeyboard',
);
const originalMatchMedia = window.matchMedia;

const hasKey = (row: ReturnType<typeof rows>[number], label: string): boolean =>
  row.some(
    (keycap) =>
      keycap === label ||
      (typeof keycap === 'object' && keycap.label === label),
  );

function rows(layout: VirtualKeyboardLayout) {
  if (!('layers' in layout)) throw new Error('Expected layered keyboard');
  const layer = layout.layers[0];
  if (typeof layer === 'string' || layer?.rows === undefined) {
    throw new Error('Expected keyboard rows');
  }
  return layer.rows;
}

afterEach(() => {
  if (originalKeyboardDescriptor === undefined) {
    Reflect.deleteProperty(window, 'mathVirtualKeyboard');
  } else {
    Object.defineProperty(
      window,
      'mathVirtualKeyboard',
      originalKeyboardDescriptor,
    );
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  });
});

describe('mobile math keyboard', () => {
  it('organizes phone input into four concise task tabs', () => {
    expect(
      MOBILE_MATH_KEYBOARD_LAYOUTS.map(({ id, label }) => ({ id, label })),
    ).toEqual([
      { id: 'chalkboard-numbers', label: '123' },
      { id: 'chalkboard-letters', label: 'abc' },
      { id: 'chalkboard-functions', label: 'f(x)' },
      { id: 'chalkboard-greek', label: 'αβ' },
    ]);
    expect(
      MOBILE_MATH_KEYBOARD_LAYOUTS.map((entry) => rows(entry).length),
    ).toEqual([4, 4, 4, 4]);

    const writingKeys = rows(MOBILE_MATH_KEYBOARD_LAYOUTS[1]!).flat();
    expect(
      writingKeys.some(
        (keycap) => typeof keycap === 'object' && keycap.key === '\\',
      ),
    ).toBe(true);
    expect(hasKey(writingKeys, 'space')).toBe(true);
  });

  it('keeps movement, return, deletion, and dismissal directly available', () => {
    for (const keyboardLayout of MOBILE_MATH_KEYBOARD_LAYOUTS) {
      const flattened = rows(keyboardLayout).flat();
      expect(flattened).toContain('[left]');
      expect(flattened).toContain('[right]');
      expect(hasKey(flattened, '[return]')).toBe(true);
      expect(flattened).toContain('[hide-keyboard]');
      expect(hasKey(flattened, '[backspace]')).toBe(true);
    }
  });

  it('installs the custom layout only at phone widths', () => {
    const keyboard = {
      editToolbar: 'default',
      layouts: ['default'],
    };
    Object.defineProperty(window, 'mathVirtualKeyboard', {
      configurable: true,
      value: keyboard,
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });

    configureMobileMathKeyboard();
    expect(keyboard.layouts).toEqual(['default']);

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    configureMobileMathKeyboard();
    expect(keyboard.layouts).toBe(MOBILE_MATH_KEYBOARD_LAYOUTS);
    expect(keyboard.editToolbar).toBe('none');

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });
    configureMobileMathKeyboard();
    expect(keyboard.layouts).toEqual(['default']);
    expect(keyboard.editToolbar).toBe('default');
  });
});
