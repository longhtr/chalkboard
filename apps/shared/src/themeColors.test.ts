/** Proves per-theme color resolution, derivation, and backward compatibility. */
import { describe, expect, it } from 'vitest';

import {
  backgroundColorField,
  deriveThemeColor,
  resolveBackgroundColor,
  resolveStrokeColor,
  strokeColorField,
  TRANSPARENT_FILL,
} from './themeColors';

describe('resolveStrokeColor', () => {
  it('returns the stored light color under the light theme', () => {
    expect(
      resolveStrokeColor(
        { strokeColor: '#1f2937', strokeColorDark: '#e6e6ea' },
        'light',
      ),
    ).toBe('#1f2937');
  });

  it('returns the stored dark color under the dark theme', () => {
    expect(
      resolveStrokeColor(
        { strokeColor: '#1f2937', strokeColorDark: '#e6e6ea' },
        'dark',
      ),
    ).toBe('#e6e6ea');
  });

  // A board authored before per-theme colors has no dark value; it must still
  // draw legibly rather than rendering near-black ink on near-black paper.
  it('derives a light-enough dark color when none is stored', () => {
    const derived = resolveStrokeColor({ strokeColor: '#1f2937' }, 'dark');
    expect(derived).not.toBe('#1f2937');
    const lightness = Number.parseInt(derived.slice(1, 3), 16) / 255;
    expect(lightness).toBeGreaterThan(0.5);
  });
});

describe('resolveBackgroundColor', () => {
  it('keeps transparent fills transparent in both themes', () => {
    const style = { backgroundColor: TRANSPARENT_FILL };
    expect(resolveBackgroundColor(style, 'light')).toBe(TRANSPARENT_FILL);
    expect(resolveBackgroundColor(style, 'dark')).toBe(TRANSPARENT_FILL);
  });

  it('prefers a stored dark fill over derivation', () => {
    expect(
      resolveBackgroundColor(
        { backgroundColor: '#e9ecef', backgroundColorDark: '#2a2933' },
        'dark',
      ),
    ).toBe('#2a2933');
  });

  it('allows an explicit dark fill when the light fill is transparent', () => {
    expect(
      resolveBackgroundColor(
        { backgroundColor: TRANSPARENT_FILL, backgroundColorDark: '#5c3130' },
        'dark',
      ),
    ).toBe('#5c3130');
  });

  it('allows an explicit transparent dark fill when the light fill is solid', () => {
    expect(
      resolveBackgroundColor(
        {
          backgroundColor: '#ffc9c9',
          backgroundColorDark: TRANSPARENT_FILL,
        },
        'dark',
      ),
    ).toBe(TRANSPARENT_FILL);
  });
});

describe('deriveThemeColor', () => {
  it('preserves hue so a red stays a red', () => {
    const dark = deriveThemeColor('#e03131', 'dark');
    const [red, green, blue] = [1, 3, 5].map((offset) =>
      Number.parseInt(dark.slice(offset, offset + 2), 16),
    ) as [number, number, number];
    expect(red).toBeGreaterThan(green);
    expect(red).toBeGreaterThan(blue);
  });

  // Flipping lightness alone leaves a mid-tone almost unchanged, which would
  // read as un-adapted against the opposite paper.
  it('lifts mid-lightness colors clear of the dark floor', () => {
    const dark = deriveThemeColor('#e03131', 'dark');
    expect(dark).not.toBe('#e03131');
    const maximum = Math.max(
      ...[1, 3, 5].map((offset) =>
        Number.parseInt(dark.slice(offset, offset + 2), 16),
      ),
    );
    expect(maximum / 255).toBeGreaterThan(0.55);
  });

  it('returns non-hexadecimal values untouched', () => {
    expect(deriveThemeColor(TRANSPARENT_FILL, 'dark')).toBe(TRANSPARENT_FILL);
  });

  it('accepts short hexadecimal form', () => {
    expect(deriveThemeColor('#fff', 'dark')).toMatch(/^#[\da-f]{6}$/);
  });
});

describe('color field selection', () => {
  it('routes edits to the field for the theme being edited', () => {
    expect(strokeColorField('light')).toBe('strokeColor');
    expect(strokeColorField('dark')).toBe('strokeColorDark');
    expect(backgroundColorField('light')).toBe('backgroundColor');
    expect(backgroundColorField('dark')).toBe('backgroundColorDark');
  });
});
